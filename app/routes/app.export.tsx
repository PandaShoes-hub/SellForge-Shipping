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

function countryLabel(country: string) {
  if (country === "ES") return "Espanha";
  if (country === "PT") return "Portugal";

  return country || "País não definido";
}

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
        order.note.toLowerCase().includes(value) ||
        countryLabel(order.country)
          .toLowerCase()
          .includes(value),
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
              borderRadius: "18px",
              textAlign: "center",
            }}
          >
            <h2>Licença inativa</h2>

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
    <s-page heading="SellForge Shipping">
      <s-section>
        <div
          style={{
            maxWidth: "1120px",
            margin: "24px auto 60px",
            display: "grid",
            gap: "20px",
          }}
        >
          {/* HEADER */}
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
                  color: "#18794e",
                  textDecoration: "none",
                  fontSize: "13px",
                  fontWeight: 600,
                }}
              >
                ← Voltar ao Dashboard
              </Link>

              <h1
                style={{
                  margin: "14px 0 5px",
                  fontSize: "31px",
                }}
              >
                Exportar encomendas
              </h1>

              <p
                style={{
                  margin: 0,
                  color: "#616161",
                }}
              >
                Selecione as encomendas pendentes e gere o
                ficheiro Excel da transportadora.
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
                minWidth: "165px",
                padding: "13px 19px",
                border: 0,
                borderRadius: "11px",
                background:
                  selectedOrders.length === 0
                    ? "#e3e5e4"
                    : "#092c22",
                color:
                  selectedOrders.length === 0
                    ? "#8c9196"
                    : "#ffffff",
                fontWeight: 800,
                cursor:
                  selectedOrders.length === 0
                    ? "not-allowed"
                    : "pointer",
                boxShadow:
                  selectedOrders.length === 0
                    ? "none"
                    : "0 7px 18px rgba(9,44,34,.16)",
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
              Não foi possível carregar as encomendas.
            </div>
          )}

          {success && (
            <div
              style={{
                padding: "14px 17px",
                background: "#eaf7ed",
                border: "1px solid #b7dfbd",
                borderRadius: "12px",
                color: "#18794e",
                fontWeight: 700,
              }}
            >
              Excel exportado com sucesso.
            </div>
          )}

          {/* STATS */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(3, minmax(0, 1fr))",
              gap: "14px",
            }}
          >
            {[
              {
                label: "ENCOMENDAS",
                value: orders.length,
                detail: "Disponíveis",
              },
              {
                label: "SELECIONADAS",
                value: selectedOrders.length,
                detail: "Selecionadas",
              },
              {
                label: "VALOR SELECIONADO",
                value: `${selectedTotal.toFixed(2)} €`,
                detail: "Total",
              },
            ].map((card) => (
              <div
                key={card.label}
                style={{
                  background: "#ffffff",
                  border: "1px solid #e1e3e5",
                  borderRadius: "16px",
                  padding: "20px",
                  boxShadow:
                    "0 6px 20px rgba(0,0,0,.035)",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 800,
                    color: "#8c9196",
                    letterSpacing: ".05em",
                  }}
                >
                  {card.label}
                </div>

                <strong
                  style={{
                    display: "block",
                    marginTop: "8px",
                    fontSize: "27px",
                  }}
                >
                  {card.value}
                </strong>

                <div
                  style={{
                    marginTop: "4px",
                    color: "#6d7175",
                    fontSize: "12px",
                  }}
                >
                  {card.detail}
                </div>
              </div>
            ))}
          </div>

          {/* SEARCH */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "14px",
              padding: "14px",
              background: "#ffffff",
              border: "1px solid #e1e3e5",
              borderRadius: "14px",
            }}
          >
            <input
              value={search}
              onChange={(event) =>
                setSearch(event.currentTarget.value)
              }
              placeholder="Pesquisar encomenda, cliente, país ou nota..."
              style={{
                width: "100%",
                maxWidth: "650px",
                padding: "12px 14px",
                border: "1px solid #d4d7d5",
                borderRadius: "10px",
                fontSize: "14px",
                outline: "none",
              }}
            />

            <button
              type="button"
              onClick={toggleAll}
              disabled={loading}
              style={{
                padding: "11px 15px",
                background: "#ffffff",
                border: "1px solid #d4d7d5",
                borderRadius: "10px",
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Selecionar todas
            </button>
          </div>

          {/* ORDERS */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e1e3e5",
              borderRadius: "16px",
              overflow: "hidden",
              boxShadow: "0 8px 24px rgba(0,0,0,.035)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "52px 120px 1fr 140px 130px 140px",
                gap: "12px",
                padding: "14px 18px",
                background: "#f7f8f7",
                fontSize: "11px",
                fontWeight: 800,
                color: "#6d7175",
                letterSpacing: ".04em",
              }}
            >
              <span />
              <span>ENCOMENDA</span>
              <span>CLIENTE</span>
              <span>DESTINO</span>
              <span>DATA</span>
              <span style={{ textAlign: "right" }}>
                TOTAL
              </span>
            </div>

            {filteredOrders.length === 0 ? (
              <div
                style={{
                  padding: "65px 20px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: "52px",
                    height: "52px",
                    margin: "0 auto 16px",
                    borderRadius: "50%",
                    background: "#eaf5ed",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#18794e",
                    fontWeight: 800,
                  }}
                >
                  SF
                </div>

                <h3
                  style={{
                    margin: 0,
                    fontSize: "19px",
                  }}
                >
                  Ainda não existem encomendas
                </h3>

                <p
                  style={{
                    margin: "7px 0 0",
                    color: "#6d7175",
                  }}
                >
                  As encomendas pendentes aparecerão aqui.
                </p>
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
                        "52px 120px 1fr 140px 130px 140px",
                      gap: "12px",
                      alignItems: "center",
                      padding: "17px 18px",
                      borderTop: "1px solid #eeeeee",
                      background: selected
                        ? "#f2f9f4"
                        : "#ffffff",
                      cursor: loading
                        ? "not-allowed"
                        : "pointer",
                      transition: "background .15s ease",
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
                          fontWeight: 700,
                        }}
                      >
                        {order.customerName}
                      </div>

                      {order.note && (
                        <div
                          style={{
                            marginTop: "4px",
                            color: "#8c6a00",
                            fontSize: "12px",
                          }}
                        >
                          {order.note}
                        </div>
                      )}
                    </div>

                    <span>
                      {countryLabel(order.country)}
                    </span>

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