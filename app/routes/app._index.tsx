import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { isShopLicensed } from "../utils/license.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const licensed = isShopLicensed(session.shop);

  return {
    shop: session.shop,
    licensed,
  };
};

export default function Dashboard() {
  const { shop, licensed } = useLoaderData<typeof loader>();

  return (
    <s-page heading="SellForge Shipping">
      <s-section>
        <div
          style={{
            maxWidth: "980px",
            margin: "28px auto 60px",
            display: "grid",
            gap: "22px",
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: "30px",
                lineHeight: 1.15,
              }}
            >
              SellForge Shipping
            </h1>

            <p
              style={{
                margin: "8px 0 0",
                color: "#616161",
                fontSize: "15px",
              }}
            >
              Exporte encomendas Shopify para o formato da sua transportadora.
            </p>
          </div>

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
                borderRadius: "14px",
                padding: "18px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "#8c9196",
                  marginBottom: "7px",
                }}
              >
                LOJA
              </div>

              <strong
                style={{
                  fontSize: "15px",
                }}
              >
                {shop}
              </strong>
            </div>

            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e1e3e5",
                borderRadius: "14px",
                padding: "18px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "#8c9196",
                  marginBottom: "7px",
                }}
              >
                ESTADO
              </div>

              <strong
                style={{
                  fontSize: "15px",
                  color: licensed ? "#0a7a3d" : "#8a1f17",
                }}
              >
                {licensed ? "Ativa" : "Inativa"}
              </strong>
            </div>

            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e1e3e5",
                borderRadius: "14px",
                padding: "18px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "#8c9196",
                  marginBottom: "7px",
                }}
              >
                FORMATO
              </div>

              <strong
                style={{
                  fontSize: "15px",
                }}
              >
                Excel Trilhos
              </strong>
            </div>
          </div>

          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e1e3e5",
              borderRadius: "18px",
              padding: "30px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "30px",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                maxWidth: "620px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "#008060",
                  letterSpacing: ".06em",
                  marginBottom: "8px",
                }}
              >
                SELLFORGE EXPORT
              </div>

              <h2
                style={{
                  margin: 0,
                  fontSize: "25px",
                }}
              >
                Exportar encomendas
              </h2>

              <p
                style={{
                  margin: "10px 0 0",
                  color: "#616161",
                  lineHeight: 1.55,
                }}
              >
                Selecione as encomendas pendentes e gere automaticamente
                o ficheiro Excel pronto para importar na transportadora.
              </p>
            </div>

            {licensed ? (
              <Link
                to="/app/export"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: "155px",
                  padding: "12px 18px",
                  background: "#303030",
                  color: "#ffffff",
                  borderRadius: "10px",
                  textDecoration: "none",
                  fontWeight: 700,
                }}
              >
                Abrir Export →
              </Link>
            ) : (
              <div
                style={{
                  padding: "12px 16px",
                  background: "#fff4e5",
                  border: "1px solid #f5c58b",
                  borderRadius: "10px",
                  color: "#6d4b00",
                  fontWeight: 600,
                }}
              >
                Licença inativa
              </div>
            )}
          </div>

          <div
            style={{
              padding: "20px 22px",
              background: "#f6f6f7",
              borderRadius: "14px",
            }}
          >
            <div
              style={{
                fontSize: "13px",
                fontWeight: 700,
                marginBottom: "12px",
              }}
            >
              Como funciona
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: "14px",
              }}
            >
              {[
                ["01", "Abrir Export"],
                ["02", "Selecionar encomendas"],
                ["03", "Gerar Excel"],
                ["04", "Importar na transportadora"],
              ].map(([number, label]) => (
                <div
                  key={number}
                  style={{
                    display: "flex",
                    gap: "10px",
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#8c9196",
                    }}
                  >
                    {number}
                  </span>

                  <span
                    style={{
                      fontSize: "13px",
                      color: "#4a4a4a",
                    }}
                  >
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};