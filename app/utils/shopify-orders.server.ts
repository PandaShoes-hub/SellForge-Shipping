// Small requests keep order queries below Shopify's per-request input/cost limits.
// This is a request size, never a limit on the total number of orders exported.
export const SHOPIFY_ORDER_BATCH_SIZE = 100;

type GraphqlClient = {
  graphql: (
    query: string,
    options: { variables: Record<string, unknown>; signal?: AbortSignal },
  ) => Promise<{ json(): Promise<unknown> }>;
};

type GraphqlError = {
  message?: string;
  extensions?: { code?: string };
};

type GraphqlResult<T> = {
  data?: T;
  errors?: GraphqlError[];
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      throttleStatus?: {
        currentlyAvailable?: number;
        maximumAvailable?: number;
        restoreRate?: number;
      };
    };
  };
};

type ReadOptions = {
  signal?: AbortSignal;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

type OrderConnection<T> = {
  nodes?: T[];
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
};

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Pedido cancelado."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throttleDelay(result: GraphqlResult<unknown>): number {
  const cost = result.extensions?.cost;
  const required = cost?.requestedQueryCost;
  const available = cost?.throttleStatus?.currentlyAvailable;
  const rate = cost?.throttleStatus?.restoreRate;
  if (
    typeof required !== "number" || !Number.isFinite(required) || required <= 0 ||
    typeof available !== "number" || !Number.isFinite(available) || available < 0 ||
    typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0
  ) return 0;
  return required > available ? Math.ceil((required - available) / rate * 1000) + 50 : 0;
}

function isThrottled(result: GraphqlResult<unknown>): boolean {
  return Array.isArray(result.errors) && result.errors.length > 0 &&
    result.errors.every((error) => error.extensions?.code === "THROTTLED");
}

function thrownThrottle(error: unknown): GraphqlResult<never> | null {
  if (error instanceof Response && error.status === 429) {
    return { errors: [{ extensions: { code: "THROTTLED" } }] };
  }
  // Shopify's authenticated client throws GraphqlQueryError for HTTP-200
  // GraphQL errors. Its body contains errors.graphQLErrors and cost metadata.
  const body = (error as { body?: {
    errors?: { graphQLErrors?: GraphqlError[] };
    extensions?: GraphqlResult<never>["extensions"];
  } } | null)?.body;
  const result = { errors: body?.errors?.graphQLErrors, extensions: body?.extensions };
  return isThrottled(result) ? result : null;
}

function requester(client: GraphqlClient, options: ReadOptions) {
  let nextDelay = 0;
  const wait = options.wait ?? pause;
  return async <T>(query: string, variables: Record<string, unknown>): Promise<GraphqlResult<T>> => {
    for (let attempt = 0; ; attempt++) {
      options.signal?.throwIfAborted();
      if (nextDelay > 0) await wait(nextDelay, options.signal);
      nextDelay = 0;

      let result: GraphqlResult<T>;
      try {
        const response = await client.graphql(query, { variables, signal: options.signal });
        result = await response.json() as GraphqlResult<T>;
      } catch (error) {
        const throttled = thrownThrottle(error);
        if (!throttled) throw error;
        result = throttled;
      }
      if (!result || typeof result !== "object") {
        throw new Error("A Shopify devolveu uma resposta inválida.");
      }
      if (!isThrottled(result)) {
        nextDelay = throttleDelay(result);
        return result;
      }
      if (attempt >= 3) {
        throw new Error("A Shopify está temporariamente a limitar os pedidos. Aguarda e tenta novamente.");
      }
      nextDelay = Math.max(throttleDelay(result), 1000 * 2 ** attempt);
    }
  };
}

/** Read every page of the supplied orders connection; never return a partial list. */
export async function fetchAllOrders<T extends { id: string }>(
  client: GraphqlClient,
  query: string,
  options: ReadOptions = {},
): Promise<T[]> {
  const read = requester(client, options);
  const orders = new Map<string, T>();
  const cursors = new Set<string>();
  let after: string | null = null;
  for (;;) {
    const result: GraphqlResult<{ orders?: OrderConnection<T> }> =
      await read<{ orders?: OrderConnection<T> }>(query, { first: SHOPIFY_ORDER_BATCH_SIZE, after });
    if (result.errors?.length) {
      throw new Error("A Shopify devolveu um erro ao carregar a lista completa de encomendas.");
    }
    const connection = result.data?.orders;
    if (!Array.isArray(connection?.nodes) || typeof connection.pageInfo?.hasNextPage !== "boolean") {
      throw new Error("A Shopify não devolveu uma página de encomendas válida.");
    }
    for (const order of connection.nodes) {
      if (!order || typeof order.id !== "string" || !order.id) {
        throw new Error("A Shopify devolveu uma encomenda sem identificação.");
      }
      orders.set(order.id, order);
    }
    if (!connection.pageInfo.hasNextPage) return [...orders.values()];
    const cursor = connection.pageInfo.endCursor;
    if (!connection.nodes.length || typeof cursor !== "string" || !cursor || cursors.has(cursor)) {
      throw new Error("Não foi possível avançar para a próxima página de encomendas.");
    }
    cursors.add(cursor);
    after = cursor;
  }
}

/** Fetch all selected IDs in bounded calls; a failed batch prevents the download. */
export async function fetchOrderBatches<T>(
  client: GraphqlClient,
  query: string,
  orderIds: string[],
  options: ReadOptions = {},
): Promise<GraphqlResult<{ nodes: (T | null)[] }>> {
  const read = requester(client, options);
  const nodes: (T | null)[] = [];
  for (let offset = 0; offset < orderIds.length; offset += SHOPIFY_ORDER_BATCH_SIZE) {
    const ids = orderIds.slice(offset, offset + SHOPIFY_ORDER_BATCH_SIZE);
    const result = await read<{ nodes?: (T | null)[] }>(query, { ids });
    if (result.errors?.length) return { errors: result.errors };
    if (!Array.isArray(result.data?.nodes)) {
      throw new Error("A Shopify não devolveu as encomendas selecionadas.");
    }
    nodes.push(...result.data.nodes);
  }
  return { data: { nodes } };
}
