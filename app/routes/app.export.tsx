import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getLicenseStatus,
  registerLicenseAccess,
} from "../utils/license.server";

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
  const license = await getLicenseStatus(session.shop);

  const trilhosAllowed =
    license.allowed && license.trilhosEnabled;

  if (!trilhosAllowed) {
    return {
      trilhosAllowed: false,
      shop: session.shop,
      orders: [] as Order[],
      accessError: false,
    };
  }

  await registerLicenseAccess(session.shop);

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
        createdAt: new Date(order.createdAt).toLocaleDateString(
          "pt-PT",
        ),
        country: order.shippingAddress?.countryCodeV2 || "",
      };
    });

    return {
      trilhosAllowed: true,
      shop: session.shop,
      orders,
      accessError: false,
    };
  } catch (error) {
    console.error("Erro ao carregar encomendas Shopify:", error);

    return {
      trilhosAllowed: true,
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
    trilhosAllowed,
    shop,
    orders,
    accessError,
  } = useLoaderData<typeof loader>();

  const [selectedOrders, setSelectedOrders] =
    useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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
      .filter((order) => selectedOrders.includes(order.id))
      .reduce((sum, order) => sum + order.totalNumber, 0);
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

    const visibleIds = filteredOrders.map((order) => order.id);
    const allSelected =
      visibleIds.length > 0 &&
      visibleIds.every((id) => selectedOrders.includes(id));

    if (allSelected) {
      setSelectedOrders((current) =>
        current.filter((id) => !visibleIds.includes(id)),
      );
    } else {
      setSelectedOrders((current) =>
        Array.from(new Set([...current, ...visibleIds])),
      );
    }
  }

  async function exportSelected() {
    if (selectedOrders.length === 0) return;

    setLoading(true);
    setSuccess(false);
    setErrorMessage("");

    try {
      const response = await fetch("/api/export-selected", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          carrier: "trilhos",
          orderIds: selectedOrders,
        }),
      });

      if (!response.ok) {
        let message = `Erro ao exportar: ${response.status}`;

        try {
          const data = await response.json();
          if (data?.error) message = data.error;
        } catch {
          // resposta não JSON
        }

        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "ATT_IMPORT.xlsx";

      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setSuccess(true);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível exportar.";

      setErrorMessage(message);
      console.error("Erro ao exportar encomendas:", error);
    } finally {
      setLoading(false);
    }
  }

  if (!trilhosAllowed) {
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
            <div style={{ fontSize: "36px" }}>🔒</div>
            <h2>Sem acesso à Trilhos</h2>
            <p style={{ color: "#616161", lineHeight: 1.6 }}>
              A loja <strong>{shop}</strong> não tem autorização
              para utilizar a exportação Trilhos.
            </p>
            <p style={{ color: "#6d7175", fontSize: "13px" }}>
              O acesso é atribuído pelo administrador da SellForge.
            </p>
            <Link to="/app">Voltar ao Dashboard</Link>
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
                  fontWeight: 700,
                }}
              >
                ← Voltar ao Dashboard
              </Link>

              <div
                style={{
                  marginTop: "18px",
                  display: "inline-flex",
                  padding: "5px 9px",
                  borderRadius: "999px",
                  background: "#e8f5ec",
                  color: "#18794e",
                  fontSize: "11px",
                  fontWeight: 850,
                }}
              >
                TRILHOS
              </div>

              <h1
                style={{
                  margin: "10px 0 5px",
                  fontSize: "31px",
                }}
              >
                Exportar encomendas
              </h1>

              <p style={{ margin: 0, color: "#616161" }}>
                Selecione as encomendas e gere o ficheiro ATT_IMPORT.xlsx.
              </p>
            </div>

            <button
              type="button"
              onClick={exportSelected}
              disabled={selectedOrders.length === 0 || loading}
              style={{
                minWidth: "175px",
                padding: "13px 19px",
                border: 0,
                borderRadius: "11px",
                background:
                  selectedOrders.length === 0
                    ? "#e3e5e4"
                    : "#102c24",
                color:
                  selectedOrders.length === 0
                    ? "#8c9196"
                    : "#ffffff",
                fontWeight: 850,
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
              ATT_IMPORT.xlsx exportado com sucesso.
            </div>
          )}

          {errorMessage && (
            <div
              style={{
                padding: "14px 17px",
                background: "#fff1f0",
                border: "1px solid #f0b8b5",
                borderRadius: "12px",
                color: "#8a1f17",
                fontWeight: 700,
              }}
            >
              {errorMessage}
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
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
                detail: "Para exportar",
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

          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e1e3e5",
              borderRadius: "16px",
              overflow: "hidden",
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
              }}
            >
              <span />
              <span>ENCOMENDA</span>
              <span>CLIENTE</span>
              <span>DESTINO</span>
              <span>DATA</span>
              <span style={{ textAlign: "right" }}>TOTAL</span>
            </div>

            {filteredOrders.length === 0 ? (
              <div
                style={{
                  padding: "60px 20px",
                  textAlign: "center",
                  color: "#6d7175",
                }}
              >
                Nenhuma encomenda disponível.
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
                      padding: "15px 18px",
                      borderTop: "1px solid #eceeed",
                      background: selected
                        ? "#f1faf3"
                        : "#ffffff",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={loading}
                      onChange={() => toggleOrder(order.id)}
                    />
                    <strong>{order.name}</strong>
                    <span>{order.customerName}</span>
                    <span>{countryLabel(order.country)}</span>
                    <span>{order.createdAt}</span>
                    <strong style={{ textAlign: "right" }}>
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

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
