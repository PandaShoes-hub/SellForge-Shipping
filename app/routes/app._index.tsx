import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { isShopLicensed } from "../utils/license.server";

type DashboardOrder = {
  amount: number;
  currency: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const licensed = isShopLicensed(session.shop);

  if (!licensed) {
    return {
      shop: session.shop,
      licensed: false,
      orderCount: 0,
      valueLabel: "0,00 €",
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
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    `);

    const json = await response.json();

    const edges = json?.data?.orders?.edges ?? [];

    const orders: DashboardOrder[] = edges.map((edge: any) => ({
      amount: Number(
        edge.node?.totalPriceSet?.shopMoney?.amount || 0,
      ),
      currency:
        edge.node?.totalPriceSet?.shopMoney?.currencyCode || "EUR",
    }));

    const totalsByCurrency = orders.reduce<Record<string, number>>(
      (totals, order) => {
        totals[order.currency] =
          (totals[order.currency] || 0) + order.amount;

        return totals;
      },
      {},
    );

    const valueLabel = Object.entries(totalsByCurrency)
      .map(
        ([currency, value]) =>
          `${value.toFixed(2)} ${currency}`,
      )
      .join(" + ");

    return {
      shop: session.shop,
      licensed: true,
      orderCount: orders.length,
      valueLabel: valueLabel || "0,00 EUR",
      accessError: false,
    };
  } catch (error) {
    console.error(
      "Erro ao carregar resumo das encomendas:",
      error,
    );

    return {
      shop: session.shop,
      licensed: true,
      orderCount: 0,
      valueLabel: "—",
      accessError: true,
    };
  }
};

export default function Dashboard() {
  const {
    shop,
    licensed,
    orderCount,
    valueLabel,
    accessError,
  } = useLoaderData<typeof loader>();

  return (
    <s-page heading="SellForge Shipping">
      <s-section>
        <div
          style={{
            maxWidth: "1120px",
            margin: "24px auto 60px",
            display: "grid",
            gap: "22px",
          }}
        >
          {/* HEADER */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "20px",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginBottom: "14px",
                }}
              >
                <div
                  style={{
                    width: "38px",
                    height: "38px",
                    borderRadius: "11px",
                    background: "#e8f5ec",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    color: "#18794e",
                  }}
                >
                  SF
                </div>

                <div>
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: "15px",
                      lineHeight: 1.1,
                    }}
                  >
                    SELLFORGE
                  </div>

                  <div
                    style={{
                      fontSize: "11px",
                      color: "#6d7175",
                      letterSpacing: ".08em",
                    }}
                  >
                    SHIPPING
                  </div>
                </div>
              </div>

              <h1
                style={{
                  margin: 0,
                  fontSize: "31px",
                  lineHeight: 1.15,
                }}
              >
                Bem-vindo de volta
              </h1>

              <p
                style={{
                  margin: "8px 0 0",
                  color: "#616161",
                  fontSize: "15px",
                }}
              >
                Aqui está o resumo das encomendas prontas para exportar.
              </p>
            </div>

            <div
              style={{
                padding: "11px 14px",
                background: "#ffffff",
                border: "1px solid #e1e3e5",
                borderRadius: "12px",
                boxShadow: "0 4px 14px rgba(0,0,0,.04)",
                fontWeight: 700,
                fontSize: "13px",
              }}
            >
              {shop}
            </div>
          </div>

          {/* ERROR */}
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
                Não foi possível atualizar o resumo das encomendas.
              </strong>

              <p
                style={{
                  margin: "5px 0 0",
                  color: "#616161",
                }}
              >
                A aplicação continua disponível. Tente novamente mais tarde.
              </p>
            </div>
          )}

          {/* STATS */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "14px",
            }}
          >
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e1e3e5",
                borderRadius: "16px",
                padding: "20px",
                boxShadow: "0 6px 20px rgba(0,0,0,.035)",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#8c9196",
                  letterSpacing: ".05em",
                }}
              >
                ENCOMENDAS POR EXPORTAR
              </div>

              <strong
                style={{
                  display: "block",
                  marginTop: "9px",
                  fontSize: "28px",
                }}
              >
                {orderCount}
              </strong>

              <div
                style={{
                  marginTop: "5px",
                  color: "#6d7175",
                  fontSize: "13px",
                }}
              >
                Pendentes de exportação
              </div>
            </div>

            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e1e3e5",
                borderRadius: "16px",
                padding: "20px",
                boxShadow: "0 6px 20px rgba(0,0,0,.035)",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#8c9196",
                  letterSpacing: ".05em",
                }}
              >
                VALOR PENDENTE
              </div>

              <strong
                style={{
                  display: "block",
                  marginTop: "9px",
                  fontSize: "24px",
                }}
              >
                {valueLabel}
              </strong>

              <div
                style={{
                  marginTop: "5px",
                  color: "#6d7175",
                  fontSize: "13px",
                }}
              >
                Valor total das encomendas
              </div>
            </div>

            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e1e3e5",
                borderRadius: "16px",
                padding: "20px",
                boxShadow: "0 6px 20px rgba(0,0,0,.035)",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#8c9196",
                  letterSpacing: ".05em",
                }}
              >
                ESTADO
              </div>

              <strong
                style={{
                  display: "block",
                  marginTop: "9px",
                  fontSize: "24px",
                  color: licensed ? "#18794e" : "#a61b1b",
                }}
              >
                {licensed ? "Ativa" : "Inativa"}
              </strong>

              <div
                style={{
                  marginTop: "5px",
                  color: "#6d7175",
                  fontSize: "13px",
                }}
              >
                Loja ligada ao SellForge
              </div>
            </div>
          </div>

          {/* HERO EXPORT */}
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              borderRadius: "20px",
              background:
                "linear-gradient(135deg, #102c24 0%, #071b16 100%)",
              color: "#ffffff",
              padding: "34px",
              minHeight: "230px",
              boxShadow: "0 12px 35px rgba(6,35,26,.18)",
            }}
          >
            <div
              style={{
                position: "absolute",
                width: "340px",
                height: "340px",
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, rgba(77,208,133,.16), transparent 68%)",
                right: "-40px",
                top: "-90px",
              }}
            />

            <div
              style={{
                position: "relative",
                zIndex: 2,
                maxWidth: "620px",
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  padding: "5px 9px",
                  borderRadius: "999px",
                  background: "rgba(90,210,130,.12)",
                  color: "#8ee7a8",
                  fontSize: "11px",
                  fontWeight: 800,
                  letterSpacing: ".05em",
                }}
              >
                EXPORTAÇÃO
              </div>

              <h2
                style={{
                  margin: "16px 0 8px",
                  fontSize: "30px",
                }}
              >
                Pronto para exportar
              </h2>

              <p
                style={{
                  margin: 0,
                  color: "#d3ded9",
                  lineHeight: 1.6,
                  maxWidth: "540px",
                }}
              >
                Tem {orderCount} encomenda
                {orderCount === 1 ? "" : "s"} pendente
                {orderCount === 1 ? "" : "s"}.
                Selecione e exporte diretamente para o formato Excel
                da transportadora.
              </p>

              {licensed ? (
                <Link
                  to="/app/export"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: "24px",
                    padding: "12px 19px",
                    background:
                      "linear-gradient(135deg, #78d954, #48b84c)",
                    color: "#082015",
                    borderRadius: "10px",
                    textDecoration: "none",
                    fontWeight: 800,
                    boxShadow: "0 8px 20px rgba(78,190,83,.25)",
                  }}
                >
                  Exportar encomendas →
                </Link>
              ) : (
                <div
                  style={{
                    display: "inline-flex",
                    marginTop: "24px",
                    padding: "12px 18px",
                    borderRadius: "10px",
                    background: "rgba(255,255,255,.08)",
                    color: "#ffffff",
                  }}
                >
                  Licença inativa
                </div>
              )}
            </div>
          </div>

          {/* INFO */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e1e3e5",
              borderRadius: "16px",
              padding: "22px",
            }}
          >
            <div
              style={{
                fontWeight: 800,
                fontSize: "15px",
                marginBottom: "13px",
              }}
            >
              Fluxo de exportação
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: "14px",
              }}
            >
              {[
                ["01", "Abrir encomendas"],
                ["02", "Selecionar pedidos"],
                ["03", "Gerar Excel"],
                ["04", "Importar na transportadora"],
              ].map(([number, label]) => (
                <div
                  key={number}
                  style={{
                    padding: "14px",
                    background: "#f8f9f8",
                    borderRadius: "11px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 800,
                      color: "#18794e",
                      marginBottom: "6px",
                    }}
                  >
                    {number}
                  </div>

                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#383838",
                    }}
                  >
                    {label}
                  </div>
                </div>
              ))}
            </div>
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