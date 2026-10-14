/* eslint-env node, es2020 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { asModule } from "./helpers/module.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const helperSource = await readFile(path.join(root, "app/utils/shopify-orders.server.ts"), "utf8");
const helperUrl = asModule(helperSource, new Map(), "shopify-orders.server.ts");
const { fetchAllOrders, fetchOrderBatches } = await import(helperUrl);
const temporary = await mkdtemp(path.join(tmpdir(), "sellforge-pagination-tests-"));
after(() => rm(temporary, { recursive: true, force: true }));

const mockPath = path.join(temporary, "context.mjs");
await writeFile(mockPath, `
  export const state = { admin: null, license: null, loaderData: null, hooks: [], hookIndex: 0 };
  export const authenticate = { admin: async () => ({ admin: state.admin, session: { shop: "pagination.myshopify.com" } }) };
  export const getLicenseStatus = async () => state.license;
  export const registerLicenseAccess = async () => {};
  export const boundary = { headers: () => ({}) };
  export const Link = ({ children }) => children;
  export const useLoaderData = () => state.loaderData;
  export const useMemo = (callback) => callback();
  export const useState = (initial) => {
    const index = state.hookIndex++;
    if (!(index in state.hooks)) state.hooks[index] = initial;
    return [state.hooks[index], (next) => {
      state.hooks[index] = typeof next === "function" ? next(state.hooks[index]) : next;
    }];
  };
  export default { license: { update: async () => { throw new Error("Unexpected database write"); } } };
`);
const mockUrl = pathToFileURL(mockPath).href;
const { state } = await import(mockUrl);
const imports = new Map([
  ["react", mockUrl], ["react/jsx-runtime", import.meta.resolve("react/jsx-runtime")],
  ["react-router", mockUrl], ["@shopify/shopify-app-react-router/server", mockUrl],
  ["../shopify.server", mockUrl], ["../utils/license.server", mockUrl],
  ["../utils/shopify-orders.server", helperUrl], ["../db.server", mockUrl],
]);
const exportSource = await readFile(path.join(root, "app/routes/app.export.tsx"), "utf8");
const dashboardSource = await readFile(path.join(root, "app/routes/app._index.tsx"), "utf8");
const { loader: exportLoader, default: ExportPage } = await import(asModule(exportSource, imports));
const { loader: dashboardLoader } = await import(asModule(dashboardSource, imports));

function listedOrders(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `gid://shopify/Order/${30000 + index}`, name: `#LIST-${index}`,
    note: "Nota de teste", createdAt: "2026-10-14T08:00:00Z",
    currentTotalPriceSet: { shopMoney: { amount: "1.00", currencyCode: "EUR" } },
    shippingAddress: { name: `Cliente ${index}`, countryCodeV2: index % 2 ? "PT" : "ES" },
  }));
}

function pageClient(nodes, { failPage = 0 } = {}) {
  const calls = [];
  return {
    calls,
    graphql: async (query, { variables }) => {
      calls.push({ query, variables });
      if (calls.length === failPage) return Response.json({ errors: [{ message: "Page failure" }] });
      const start = variables.after ? Number(variables.after.slice(7)) : 0;
      const end = Math.min(start + variables.first, nodes.length);
      return Response.json({ data: { orders: {
        nodes: nodes.slice(start, end),
        pageInfo: { hasNextPage: end < nodes.length, endCursor: `cursor-${end}` },
      } } });
    },
  };
}

const license = { allowed: true, company: "Loja de teste", trilhosEnabled: true, nextlogEnabled: true };
function configure(client, settings = {}) {
  state.admin = client;
  state.license = { ...license, ...settings };
}

test("the export page loads all 1001 eligible orders through real cursor pagination", async () => {
  const nodes = listedOrders(1001);
  const client = pageClient(nodes);
  configure(client);
  const data = await exportLoader({ request: new Request("https://app.example.test/app/export?carrier=nextlog") });
  assert.equal(data.accessError, false);
  assert.equal(data.orders.length, 1001);
  assert.deepEqual(data.orders.map((item) => item.id), nodes.map((item) => item.id));
  assert.equal(client.calls[0].variables.after, null);
  assert.equal(client.calls[1].variables.after, "cursor-100");
  assert.ok(client.calls.every(({ variables }) => variables.first <= 100));
  assert.match(client.calls[0].query, /status:open fulfillment_status:unfulfilled/);
});

test("the dashboard count and value include every page instead of the first hundred", async () => {
  const client = pageClient(listedOrders(1001));
  configure(client);
  const data = await dashboardLoader({ request: new Request("https://app.example.test/app") });
  assert.equal(data.accessError, false);
  assert.equal(data.orderCount, 1001);
  assert.equal(data.valueLabel, "1001.00 EUR");
  assert.ok(client.calls.length > 1);
});

test("a failed later page cannot appear as a complete hundred-order list or dashboard", async (context) => {
  context.mock.method(console, "error", () => {});
  for (const loader of [exportLoader, dashboardLoader]) {
    configure(pageClient(listedOrders(251), { failPage: 2 }));
    const data = await loader({ request: new Request("https://app.example.test/app/export") });
    assert.equal(data.accessError, true);
    if (data.orders) assert.deepEqual(data.orders, []);
    else assert.equal(data.orderCount, 0);
  }
});

test("a disabled carrier is rejected before reading any order pages", async () => {
  const client = pageClient(listedOrders(101));
  configure(client, { nextlogEnabled: false });
  const data = await exportLoader({ request: new Request("https://app.example.test/app/export?carrier=nextlog") });
  assert.equal(data.carrierAllowed, false);
  assert.deepEqual(client.calls, []);
});

test("pagination removes duplicate order IDs and stops on an invalid repeating cursor", async () => {
  let calls = 0;
  const client = { graphql: async () => {
    calls++;
    return Response.json({ data: { orders: {
      nodes: [{ id: "one" }, { id: "one" }],
      pageInfo: { hasNextPage: calls === 1, endCursor: "cursor" },
    } } });
  } };
  assert.deepEqual(await fetchAllOrders(client, "query"), [{ id: "one" }]);
  calls = 0;
  const looping = { graphql: async () => {
    calls++;
    return Response.json({ data: { orders: {
      nodes: [{ id: `order-${calls}` }], pageInfo: { hasNextPage: true, endCursor: "same" },
    } } });
  } };
  await assert.rejects(fetchAllOrders(looping, "query"), /próxima página/);
  assert.equal(calls, 2);
});

test("missing page metadata fails rather than silently truncating the order list", async () => {
  const client = { graphql: async () => Response.json({ data: { orders: { nodes: [{ id: "one" }] } } }) };
  await assert.rejects(fetchAllOrders(client, "query"), /página de encomendas válida/);
});

test("large reads wait for the Shopify cost budget before the next batch", async () => {
  const waits = [];
  const events = [];
  const client = { graphql: async (_query, { variables }) => {
    events.push("request");
    return Response.json({ data: { nodes: variables.ids.map((id) => ({ id })) }, extensions: { cost: {
      requestedQueryCost: 401, throttleStatus: { currentlyAvailable: 100, maximumAvailable: 1000, restoreRate: 100 },
    } } });
  } };
  const ids = Array.from({ length: 101 }, (_, index) => `order-${index}`);
  const result = await fetchOrderBatches(client, "query", ids, { wait: async (milliseconds) => {
    waits.push(milliseconds); events.push("wait");
  } });
  assert.equal(result.data.nodes.length, 101);
  assert.deepEqual(events, ["request", "wait", "request"]);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 3010 && waits[0] < 4000);
});

test("returned and SDK-thrown Shopify throttle errors retry the same batch without duplicating rows", async () => {
  for (const kind of ["returned", "sdk", "http429"]) {
    let calls = 0;
    const waits = [];
    const client = { graphql: async (_query, { variables }) => {
      calls++;
      if (calls === 1) {
        if (kind === "http429") throw new Response("Too many requests", { status: 429 });
        const errors = [{ message: "Throttled", extensions: { code: "THROTTLED" } }];
        if (kind === "sdk") {
          const error = new Error("Throttled");
          error.body = { errors: { graphQLErrors: errors } };
          throw error;
        }
        return Response.json({ errors });
      }
      return Response.json({ data: { nodes: variables.ids.map((id) => ({ id })) } });
    } };
    const result = await fetchOrderBatches(client, "query", ["one", "two"], { wait: async (ms) => { waits.push(ms); } });
    assert.deepEqual(result.data.nodes, [{ id: "one" }, { id: "two" }]);
    assert.equal(calls, 2);
    assert.ok(waits[0] >= 1000);
  }
});

test("persistent throttling stops after bounded retries and does not return a partial export", async () => {
  let calls = 0;
  const client = { graphql: async () => {
    calls++;
    return Response.json({ errors: [{ extensions: { code: "THROTTLED" } }] });
  } };
  await assert.rejects(fetchOrderBatches(client, "query", ["one"], { wait: async () => {} }), /temporariamente a limitar/);
  assert.equal(calls, 4);
});

test("aborting a paused large export stops before requesting another batch", async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = { graphql: async (_query, { variables }) => {
    calls++;
    setTimeout(() => controller.abort(new Error("Export cancelled")), 0);
    return Response.json({ data: { nodes: variables.ids.map((id) => ({ id })) }, extensions: { cost: {
      requestedQueryCost: 401, throttleStatus: { currentlyAvailable: 0, restoreRate: 50 },
    } } });
  } };
  await assert.rejects(fetchOrderBatches(client, "query", Array.from({ length: 101 }, (_, i) => String(i)), {
    signal: controller.signal,
  }), /Export cancelled/);
  assert.equal(calls, 1);
});

function renderPage() {
  state.hookIndex = 0;
  return ExportPage();
}
function elements(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((node) => elements(node, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...elements(tree.props?.children, predicate)];
}
function textContent(tree) {
  if (Array.isArray(tree)) return tree.map(textContent).join("");
  if (tree && typeof tree === "object") return textContent(tree.props?.children);
  return tree == null || tree === false ? "" : String(tree);
}
function button(tree, text) {
  const found = elements(tree, (node) => node.type === "button" && textContent(node).startsWith(text))[0];
  assert.ok(found, text);
  return found;
}
function setPageOrders(carrier = "trilhos") {
  state.hooks = [];
  state.loaderData = { carrierAllowed: true, carrier, shop: "pagination.myshopify.com", accessError: false,
    orders: listedOrders(1001).map((order) => ({
      id: order.id, name: order.name, customerName: order.shippingAddress.name,
      note: order.note, totalNumber: 1, total: "1.00 EUR", createdAt: "14/10/2026", country: order.shippingAddress.countryCodeV2,
    })),
  };
}

test("select all covers all 1001 orders, with selection retained across screen pages and searches", () => {
  setPageOrders();
  let tree = renderPage();
  assert.equal(elements(tree, (node) => node.type === "input" && node.props.type === "checkbox").length, 100);
  button(tree, "Selecionar todas (1001)").props.onClick();
  tree = renderPage();
  assert.equal(textContent(button(tree, "Exportar")), "Exportar (1001)");
  button(tree, "Seguinte").props.onClick();
  tree = renderPage();
  const checkboxes = elements(tree, (node) => node.type === "input" && node.props.type === "checkbox");
  assert.ok(checkboxes.every((node) => node.props.checked));
  checkboxes[0].props.onChange();
  tree = renderPage();
  assert.equal(textContent(button(tree, "Exportar")), "Exportar (1000)");
  const search = elements(tree, (node) => node.type === "input" && node.props.placeholder)[0];
  search.props.onChange({ currentTarget: { value: "#LIST-1000" } });
  tree = renderPage();
  assert.equal(elements(tree, (node) => node.type === "input" && node.props.type === "checkbox").length, 1);
  button(tree, "Selecionar todas (1)").props.onClick();
  tree = renderPage();
  assert.equal(textContent(button(tree, "Exportar")), "Exportar (999)");
});

test("the export button sends every selected order, including orders off the displayed page", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  let payload;
  let endpoint;
  globalThis.document = { body: { appendChild: () => {} }, createElement: () => ({ click: () => {}, remove: () => {} }) };
  globalThis.fetch = async (url, options) => {
    endpoint = url; payload = JSON.parse(options.body);
    return new Response("test-workbook", { status: 200 });
  };
  try {
    for (const carrier of ["trilhos", "nextlog"]) {
      setPageOrders(carrier);
      let tree = renderPage();
      button(tree, "Selecionar todas").props.onClick();
      tree = renderPage();
      await button(tree, "Exportar").props.onClick();
      assert.equal(endpoint, carrier === "nextlog" ? "/api/export-nextlog" : "/api/export-selected");
      assert.equal(payload.carrier, carrier);
      assert.deepEqual(payload.orderIds, state.loaderData.orders.map((order) => order.id));
      assert.equal(payload.orderIds.length, 1001);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
