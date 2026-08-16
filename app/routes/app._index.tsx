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
            maxWidth: "900px",
            margin: "20px auto",
            display: "grid",
            gap: "18px",
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: "28px",
              }}
            >
              SellForge Shipping
            </h1>

            <p
              style={{
                marginTop: "6px",
                color: "#666",
              }}
            >
              Exporte encomendas Shopify para o formato da sua transportadora.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "12px",
            }}
          >
            <div
              style={{
                background: "white",
                border: "1px solid #dfe3e8",
                borderRadius: "12px",
                padding: "18px",
              }}
            >
              <div
                style={{
                  color: "#666",
                  fontSize: "13px",
                }}
              >
                Loja
              </div>

              <strong>{shop}</strong>
            </div>

            <div
              style={{
                background: "white",
                border: "1px solid #dfe3e8",
                borderRadius: "12px",
                padding: "18px",
              }}
            >
              <div
                style={{
                  color: "#666",
                  fontSize: "13px",
                }}
              >
                Estado
              </div>

              <strong>
                {licensed ? "Ativa" : "Inativa"}
              </strong>
            </div>

            <div
              style={{
                background: "white",
                border: "1px solid #dfe3e8",
                borderRadius: "12px",
                padding: "18px",
              }}
            >
              <div
                style={{
                  color: "#666",
                  fontSize: "13px",
                }}
              >
                Exportação
              </div>

              <strong>Excel Trilhos</strong>
            </div>
          </div>

          <div
            style={{
              background: "white",
              border: "1px solid #dfe3e8",
              borderRadius: "16px",
              padding: "26px",
            }}
          >
            <h2
              style={{
                marginTop: 0,
              }}
            >
              Exportar encomendas
            </h2>

            <p
              style={{
                color: "#666",
                maxWidth: "600px",
              }}
            >
              Selecione as encomendas pendentes e gere automaticamente
              o ficheiro Excel pronto para importar na transportadora.
            </p>

            {licensed ? (
              <Link
                to="/app/export"
                style={{
                  display: "inline-block",
                  marginTop: "12px",
                  padding: "11px 18px",
                  background: "#303030",
                  color: "white",
                  borderRadius: "8px",
                  textDecoration: "none",
                  fontWeight: 700,
                }}
              >
                Abrir Export →
              </Link>
            ) : (
              <div
                style={{
                  marginTop: "16px",
                  padding: "12px 14px",
                  background: "#fff4e5",
                  borderRadius: "8px",
                }}
              >
                A licença desta loja não está ativa.
              </div>
            )}
          </div>

          <div
            style={{
              background: "#f6f6f7",
              borderRadius: "12px",
              padding: "18px",
            }}
          >
            <strong>Como funciona</strong>

            <ol
              style={{
                marginBottom: 0,
                lineHeight: 1.8,
              }}
            >
              <li>Abra o módulo de exportação.</li>
              <li>Selecione as encomendas.</li>
              <li>Gere o ficheiro Excel.</li>
              <li>Importe o ficheiro na transportadora.</li>
            </ol>
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};