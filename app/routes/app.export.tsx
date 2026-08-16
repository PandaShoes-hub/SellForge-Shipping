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
              maxWidth: "720px",
              margin: "40px auto",
              padding: "34px",
              background: "#ffffff",
              border: "1px solid #e1e3e5",
              borderRadius: "16px",
              textAlign: "center",
            }}
          >
            <h2 style={{ marginTop: 0 }}>
              Licença inativa
            </h2>

            <p style={{ color: "#616161" }}>
              A loja <strong>{shop}</strong> não tem
              acesso ativo ao SellForge Shipping.
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
            maxWidth: "1050px",
            margin: "20px auto 50px",
            display: "grid",
            gap: "18px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "20px",
              flexWrap: "wrap",
            }}
          >
            <div>
              <Link
                to="/app"
                style={{
                  fontSize: "13px",
                  color: "#616161",
                  textDecoration: "none",
                }}
              >
                ← Voltar ao Dashboard
              </Link>

              <h1
                style={{
                  margin: "10px 0 4px",
                  fontSize: "30px",
                }}
              >
                Exportar encomendas
              </h1>

              <p
                style={{
                  color: "#616161",
                  margin: 0,
                }}
              >
                Selecione as encomendas pendentes e
                gere o ficheiro Excel da transportadora.
              </p>
            </div>

            <button
              type="button"
              onClick={exportSelected}
              disabled={
                selectedOrders.length === 0 ||
                loading
              }
              style={{
                minWidth: "170px",
                padding: "12px 18px",
                border: 0,
                borderRadius: "10px",
                fontWeight: 700,
                background:
                  selectedOrders.length === 0
                    ? "#e4e5e7"
                    : "#303030",
                color:
                  selectedOrders.length === 0
                    ? "#8c9196"
                    : "#ffffff",
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

          {accessError && (
            <div
              style={{
                padding: "15px 17px",
                background: "#fff5ea",
                border: "1px solid #f5c58b",
                borderRadius: "12px",
              }}
            >
              <strong>
                Não foi possível carregar as encomendas.
              </strong>

              <p
                style={{
                  margin: "5px 0 0",
                  color: "#616161",
                }}
              >
                Confirme as permissões da aplicação e
                tente novamente.
              </p>
            </div>
          )}

          {success && (
            <div
              style={{
                padding: "14px 17px",
                background: "#eaf7ed",
                border: "1px solid #b7dfbd",
                borderRadius: "12px",
                fontWeight: 600,
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
            {[
              {
                label: "Encomendas",
                value: orders.length,
              },
              {
                label: "Selecionadas",
                value: selectedOrders.length,
              },
              {
                label: "Valor selecionado",
                value: `${selectedTotal.toFixed(2)} €`,
              },
            ].map((card) => (
              <div
                key={card.label}
                style={{
                  background: "#ffffff",
                  border: "1px solid #e1e3e5",
                  borderRadius: "14px",
                  padding: "18px",
                }}
              >
                <div
                  style={{
                    color: "#616161",
                    fontSize: "13px",
                    marginBottom: "8px",
                  }}
                >
                  {card.label}
                </div>

                <strong
                  style={{
                    fontSize: "24px",
                  }}
                >
                  {card.value}
                </strong>
              </div>
            ))}
          </div>

          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e1e3e5",
              borderRadius: "14px",
              padding: "14px",
              display: "flex",
              gap: "12px",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <input
              value={search}
              onChange={(event) =>
                setSearch(event.currentTarget.value)
              }
              placeholder="Pesquisar encomenda, cliente ou nota..."
              style={{
                width: "100%",
                maxWidth: "560px",
                padding: "11px 13px",
                border: "1px solid #c9cccf",
                borderRadius: "9px",
                fontSize: "14px",
              }}
            />

            <button
              type="button"
              onClick={toggleAll}
              disabled={loading}
              style={{
                padding: "10px 14px",
                background: "#ffffff",
                border: "1px solid #c9cccf",
                borderRadius: "9px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Selecionar todas
            </button>
          </div>

          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e1e3e5",
              borderRadius: "14px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "48px 120px 1fr 130px 140px",
                gap: "12px",
                padding: "13px 16px",
                background: "#f6f6f7",
                fontWeight: 700,
                fontSize: "13px",
                color: "#4a4a4a",
              }}
            >
              <span />
              <span>Encomenda</span>
              <span>Cliente</span>
              <span>Data</span>
              <span style={{ textAlign: "right" }}>
                Total
              </span>
            </div>

            {filteredOrders.length === 0 ? (
              <div
                style={{
                  padding: "40px",
                  textAlign: "center",
                  color: "#616161",
                }}
              >
                {accessError
                  ? "Não foi possível carregar as encomendas."
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
                        "48px 120px 1fr 130px 140px",
                      gap: "12px",
                      padding: "15px 16px",
                      alignItems: "center",
                      borderTop: "1px solid #eeeeee",
                      background: selected
                        ? "#f1f8f4"
                        : "#ffffff",
                      cursor: loading
                        ? "not-allowed"
                        : "pointer",
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
                      <div
                        style={{
                          fontWeight: 600,
                        }}
                      >
                        {order.customerName}
                      </div>

                      <div
                        style={{
                          marginTop: "3px",
                          color: "#8c9196",
                          fontSize: "12px",
                        }}
                      >
                        {order.country || "País não definido"}
                      </div>

                      {order.note && (
                        <div
                          style={{
                            marginTop: "6px",
                            color: "#7a5c00",
                            fontSize: "12px",
                          }}
                        >
                          {order.note}
                        </div>
                      )}
                    </div>

                    <span>{order.createdAt}</span>

                    <strong
                      style={{
                        textAlign: "right",
                      }}
                    >
                      {order.total}
                    </strong>
                  </label>
                );
              })
            )}
          </div>
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