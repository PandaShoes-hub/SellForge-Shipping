import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { isShopLicensed } from "../utils/license.server";

type Order = {
  id: string;
  name: string;
  customerName: string;
  note: string;
  total: string;
  totalNumber: number;
  createdAt: string;
  country: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const licensed = isShopLicensed(session.shop);

  if (!licensed) {
    return {
      licensed: false,
      shop: session.shop,
      orders: [] as Order[],
      accessError: false,
    };
  }

  try {
    const response = await admin.graphql(`
      #graphql
      query {
        orders(
          first: 100,
          sortKey: CREATED_AT,
          reverse: true,
          query: "status:open fulfillment_status:unfulfilled"
        ) {
          edges {
            node {
              id
              name
              note
              createdAt
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              shippingAddress {
                name
                countryCodeV2
              }
            }
          }
        }
      }
    `);

    const json = await response.json();

    const edges = json?.data?.orders?.edges ?? [];

    const orders: Order[] = edges.map((edge: any) => {
      const order = edge.node;
      const amount = Number(
        order.totalPriceSet?.shopMoney?.amount || 0,
      );

      const currency =
        order.totalPriceSet?.shopMoney?.currencyCode || "EUR";

      return {
        id: order.id,
        name: order.name,
        customerName:
          order.shippingAddress?.name || "Sem nome",
        note: order.note || "",
        totalNumber: amount,
        total: `${amount.toFixed(2)} ${currency}`,
        createdAt: new Date(
          order.createdAt,
        ).toLocaleDateString("pt-PT"),
        country:
          order.shippingAddress?.countryCodeV2 || "",
      };
    });

    return {
      licensed: true,
      shop: session.shop,
      orders,
      accessError: false,
    };
  } catch (error) {
    console.error(
      "Erro ao carregar encomendas Shopify:",
      error,
    );

    return {
      licensed: true,
      shop: session.shop,
      orders: [] as Order[],
      accessError: true,
    };
  }
};

export default function ExportPage() {
  const {
    licensed,
    shop,
    orders,
    accessError,
  } = useLoaderData<typeof loader>();

  const [selectedOrders, setSelectedOrders] =
    useState<string[]>([]);

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const filteredOrders = useMemo(() => {
    const value = search.toLowerCase().trim();

    if (!value) return orders;

    return orders.filter(
      (order) =>
        order.name.toLowerCase().includes(value) ||
        order.customerName.toLowerCase().includes(value) ||
        order.note.toLowerCase().includes(value),
    );
  }, [orders, search]);

  const selectedTotal = useMemo(() => {
    return orders
      .filter((order) =>
        selectedOrders.includes(order.id),
      )
      .reduce(
        (sum, order) => sum + order.totalNumber,
        0,
      );
  }, [orders, selectedOrders]);

  function toggleOrder(orderId: string) {
    if (loading) return;

    setSelectedOrders((current) =>
      current.includes(orderId)
        ? current.filter((id) => id !== orderId)
        : [...current, orderId],
    );
  }

  function toggleAll() {
    if (loading) return;

    const visibleIds = filteredOrders.map(
      (order) => order.id,
    );

    const allSelected =
      visibleIds.length > 0 &&
      visibleIds.every((id) =>
        selectedOrders.includes(id),
      );

    if (allSelected) {
      setSelectedOrders((current) =>
        current.filter(
          (id) => !visibleIds.includes(id),
        ),
      );
    } else {
      setSelectedOrders((current) =>
        Array.from(
          new Set([...current, ...visibleIds]),
        ),
      );
    }
  }

  async function exportSelected() {
    if (selectedOrders.length === 0) return;

    setLoading(true);
    setSuccess(false);

    try {
      const response = await fetch(
        "/api/export-selected",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            orderIds: selectedOrders,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Erro ao exportar: ${response.status}`,
        );
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = "SELLFORGE_SHIPPING.xlsx";

      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(url);

      setSuccess(true);
    } catch (error) {
      console.error(
        "Erro ao exportar encomendas:",
        error,
      );
    } finally {
      setLoading(false);
    }
  }

  if (!licensed) {
    return (
      <s-page heading="SellForge Shipping">
        <s-section>
          <div
            style={{
              maxWidth: "700px",
              margin: "40px auto",
              padding: "30px",
              background: "white",
              border: "1px solid #dfe3e8",
              borderRadius: "14px",
              textAlign: "center",
            }}
          >
            <h2>Licença inativa</h2>

            <p>
              A loja <strong>{shop}</strong> não tem acesso
              ativo ao SellForge Shipping.
            </p>

            <Link to="/app">
              Voltar ao Dashboard
            </Link>
          </div>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="SellForge Export">
      <s-section>
        <div
          style={{
            maxWidth: "1000px",
            margin: "20px auto",
            display: "grid",
            gap: "18px",
          }}
        >
          <div>
            <Link to="/app">
              ← Voltar ao Dashboard
            </Link>

            <h1
              style={{
                marginBottom: "6px",
              }}
            >
              Exportar encomendas
            </h1>

            <p
              style={{
                color: "#666",
                marginTop: 0,
              }}
            >
              Selecione as encomendas pendentes e gere o
              ficheiro Excel da transportadora.
            </p>
          </div>

          {accessError && (
            <div
              style={{
                padding: "16px",
                background: "#fff4e5",
                border: "1px solid #f0c36d",
                borderRadius: "10px",
              }}
            >
              <strong>
                Não foi possível carregar as encomendas.
              </strong>

              <p
                style={{
                  marginBottom: 0,
                }}
              >
                A aplicação ainda não tem autorização para
                aceder aos dados de encomendas desta loja.
              </p>
            </div>
          )}

          {success && (
            <div
              style={{
                padding: "14px",
                background: "#e3f1df",
                borderRadius: "10px",
              }}
            >
              Excel exportado com sucesso.
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(3, minmax(0, 1fr))",
              gap: "12px",
            }}
          >
            <div
              style={{
                background: "white",
                border: "1px solid #dfe3e8",
                borderRadius: "12px",
                padding: "16px",
              }}
            >
              <span>Encomendas</span>
              <h2>{orders.length}</h2>
            </div>

            <div
              style={{
                background: "white",
                border: "1px solid #dfe3e8",
                borderRadius: "12px",
                padding: "16px",
              }}
            >
              <span>Selecionadas</span>
              <h2>{selectedOrders.length}</h2>
            </div>

            <div
              style={{
                background: "white",
                border: "1px solid #dfe3e8",
                borderRadius: "12px",
                padding: "16px",
              }}
            >
              <span>Valor</span>
              <h2>
                {selectedTotal.toFixed(2)} €
              </h2>
            </div>
          </div>

          <div
            style={{
              background: "white",
              border: "1px solid #dfe3e8",
              borderRadius: "12px",
              padding: "14px",
              display: "flex",
              gap: "12px",
              justifyContent: "space-between",
            }}
          >
            <input
              value={search}
              onChange={(event) =>
                setSearch(event.currentTarget.value)
              }
              placeholder="Pesquisar encomenda ou cliente..."
              style={{
                width: "100%",
                maxWidth: "500px",
                padding: "10px 12px",
                border: "1px solid #c9cccf",
                borderRadius: "8px",
              }}
            />

            <button
              type="button"
              onClick={toggleAll}
              disabled={loading}
            >
              Selecionar todas
            </button>
          </div>

          <div
            style={{
              background: "white",
              border: "1px solid #dfe3e8",
              borderRadius: "12px",
              overflow: "hidden",
            }}
          >
            {filteredOrders.length === 0 ? (
              <div
                style={{
                  padding: "30px",
                  textAlign: "center",
                  color: "#666",
                }}
              >
                {accessError
                  ? "Aguardando autorização de acesso às encomendas."
                  : "Não existem encomendas pendentes."}
              </div>
            ) : (
              filteredOrders.map((order) => {
                const selected =
                  selectedOrders.includes(order.id);

                return (
                  <label
                    key={order.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "40px 110px 1fr 120px 130px",
                      gap: "12px",
                      padding: "14px",
                      alignItems: "center",
                      borderTop:
                        "1px solid #eeeeee",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={loading}
                      onChange={() =>
                        toggleOrder(order.id)
                      }
                    />

                    <strong>{order.name}</strong>

                    <div>
                      <div>{order.customerName}</div>

                      <small>
                        {order.country || "Sem país"}
                      </small>
                    </div>

                    <span>{order.createdAt}</span>

                    <strong>
                      {order.total}
                    </strong>
                  </label>
                );
              })
            )}
          </div>

          <button
            type="button"
            onClick={exportSelected}
            disabled={
              selectedOrders.length === 0 ||
              loading
            }
            style={{
              padding: "12px 18px",
              border: 0,
              borderRadius: "9px",
              fontWeight: 700,
              cursor:
                selectedOrders.length === 0
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {loading
              ? "A exportar..."
              : `Exportar (${selectedOrders.length})`}
          </button>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (
  headersArgs,
) => {
  return boundary.headers(headersArgs);
};