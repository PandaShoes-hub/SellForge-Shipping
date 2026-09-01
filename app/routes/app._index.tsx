import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  getLicenseStatus,
  registerLicenseAccess,
} from "../utils/license.server";

type DashboardOrder = {
  amount: number;
  currency: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  let license = await getLicenseStatus(session.shop);
  let company = license.company;

  // Preenche automaticamente o nome da loja no Admin na primeira utilização.
  if (!company) {
    try {
      const shopResponse = await admin.graphql(`
        #graphql
        query SellForgeShopName {
          shop {
            name
          }
        }
      `);

      const shopJson = await shopResponse.json();
      const shopName = String(shopJson?.data?.shop?.name || "").trim();

      if (shopName) {
        await prisma.license.update({
          where: { shop: session.shop.trim().toLowerCase() },
          data: { company: shopName },
        });

        company = shopName;
        license = { ...license, company: shopName };
      }
    } catch (error) {
      console.error("Erro ao sincronizar nome da loja:", error);
    }
  }

  if (!license.allowed) {
    return {
      shop: session.shop,
      company,
      accountAllowed: false,
      trilhosEnabled: false,
      cttEnabled: false,
      upsEnabled: false,
      orderCount: 0,
      valueLabel: "0,00 EUR",
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
      amount: Number(edge.node?.totalPriceSet?.shopMoney?.amount || 0),
      currency:
        edge.node?.totalPriceSet?.shopMoney?.currencyCode || "EUR",
    }));

    const totalsByCurrency = orders.reduce<Record<string, number>>(
      (totals, order) => {
        totals[order.currency] = (totals[order.currency] || 0) + order.amount;
        return totals;
      },
      {},
    );

    const valueLabel = Object.entries(totalsByCurrency)
      .map(([currency, value]) => `${value.toFixed(2)} ${currency}`)
      .join(" + ");

    return {
      shop: session.shop,
      company,
      accountAllowed: true,
      trilhosEnabled: license.trilhosEnabled,
      cttEnabled: license.cttEnabled,
      upsEnabled: license.upsEnabled,
      orderCount: orders.length,
      valueLabel: valueLabel || "0,00 EUR",
      accessError: false,
    };
  } catch (error) {
    console.error("Erro ao carregar resumo das encomendas:", error);

    return {
      shop: session.shop,
      company,
      accountAllowed: true,
      trilhosEnabled: license.trilhosEnabled,
      cttEnabled: license.cttEnabled,
      upsEnabled: license.upsEnabled,
      orderCount: 0,
      valueLabel: "—",
      accessError: true,
    };
  }
};

type CarrierCardProps = {
  name: string;
  description: string;
  enabled: boolean;
  available: boolean;
  href?: string;
  badge?: string;
};

function CarrierCard({
  name,
  description,
  enabled,
  available,
  href,
  badge,
}: CarrierCardProps) {
  const usable = enabled && available && href;

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e1e3e5",
        borderRadius: "18px",
        padding: "22px",
        display: "grid",
        gap: "14px",
        boxShadow: "0 8px 24px rgba(0,0,0,.035)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "12px",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "21px",
              fontWeight: 850,
              color: "#1f1f1f",
            }}
          >
            {name}
          </div>

          <div
            style={{
              marginTop: "5px",
              fontSize: "13px",
              color: "#6d7175",
              lineHeight: 1.5,
            }}
          >
            {description}
          </div>
        </div>

        <span
          style={{
            padding: "5px 9px",
            borderRadius: "999px",
            fontSize: "11px",
            fontWeight: 800,
            whiteSpace: "nowrap",
            background: enabled ? "#e5f4e8" : "#f2f3f3",
            color: enabled ? "#18794e" : "#6d7175",
          }}
        >
          {badge || (enabled ? "ACESSO ATIVO" : "SEM ACESSO")}
        </span>
      </div>

      {!available ? (
        <div
          style={{
            padding: "11px 13px",
            borderRadius: "10px",
            background: "#f6f6f7",
            color: "#6d7175",
            fontSize: "13px",
            fontWeight: 700,
          }}
        >
          🔒 Integração em breve
        </div>
      ) : usable ? (
        <Link
          to={href}
          style={{
            display: "inline-flex",
            width: "fit-content",
            alignItems: "center",
            justifyContent: "center",
            padding: "11px 16px",
            borderRadius: "10px",
            background: "#102c24",
            color: "#ffffff",
            textDecoration: "none",
            fontWeight: 800,
            fontSize: "13px",
          }}
        >
          Exportar encomendas →
        </Link>
      ) : (
        <div
          style={{
            padding: "11px 13px",
            borderRadius: "10px",
            background: "#fff4e5",
            color: "#7b4d00",
            fontSize: "13px",
            fontWeight: 700,
          }}
        >
          🔒 Aguarda autorização do administrador
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const {
    shop,
    company,
    accountAllowed,
    trilhosEnabled,
    cttEnabled,
    upsEnabled,
    orderCount,
    valueLabel,
    accessError,
  } = useLoaderData<typeof loader>();

  return (
    <s-page heading="SellForge Shipping">
      <s-section>
        <div
          style={{
            maxWidth: "1180px",
            margin: "24px auto 60px",
            display: "grid",
            gap: "22px",
          }}
        >
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
                    width: "42px",
                    height: "42px",
                    borderRadius: "12px",
                    background: "#e8f5ec",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 850,
                    color: "#18794e",
                  }}
                >
                  SF
                </div>

                <div>
                  <div style={{ fontWeight: 850, fontSize: "15px" }}>
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
                {company ? `Olá, ${company}` : "Bem-vindo"}
              </h1>

              <p
                style={{
                  margin: "8px 0 0",
                  color: "#616161",
                  fontSize: "15px",
                }}
              >
                Escolha a transportadora disponível para a sua loja.
              </p>
            </div>

            <div
              style={{
                padding: "11px 14px",
                background: "#ffffff",
                border: "1px solid #e1e3e5",
                borderRadius: "12px",
                boxShadow: "0 4px 14px rgba(0,0,0,.04)",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: "13px" }}>
                {company || "Loja Shopify"}
              </div>
              <div
                style={{
                  marginTop: "3px",
                  color: "#6d7175",
                  fontSize: "11px",
                }}
              >
                {shop}
              </div>
            </div>
          </div>

          {!accountAllowed && (
            <div
              style={{
                padding: "17px 18px",
                background: "#fff5e6",
                border: "1px solid #efc77e",
                borderRadius: "14px",
              }}
            >
              <strong>Acesso pendente</strong>
              <div
                style={{
                  marginTop: "5px",
                  color: "#6d5a34",
                  lineHeight: 1.5,
                }}
              >
                A sua loja já foi registada na SellForge Shipping. O administrador
                precisa ativar a conta e escolher as transportadoras disponíveis.
              </div>
            </div>
          )}

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
                label: "ENCOMENDAS POR EXPORTAR",
                value: orderCount,
                detail: "Pendentes de exportação",
              },
              {
                label: "VALOR PENDENTE",
                value: valueLabel,
                detail: "Valor total das encomendas",
              },
              {
                label: "ESTADO DA CONTA",
                value: accountAllowed ? "Ativa" : "Pendente",
                detail: accountAllowed
                  ? "Conta autorizada"
                  : "Aguarda autorização",
              },
            ].map((card) => (
              <div
                key={card.label}
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
                    marginTop: "9px",
                    fontSize:
                      card.label === "VALOR PENDENTE" ? "23px" : "27px",
                    color:
                      card.label === "ESTADO DA CONTA"
                        ? accountAllowed
                          ? "#18794e"
                          : "#9a6700"
                        : "#202223",
                  }}
                >
                  {card.value}
                </strong>

                <div
                  style={{
                    marginTop: "5px",
                    color: "#6d7175",
                    fontSize: "13px",
                  }}
                >
                  {card.detail}
                </div>
              </div>
            ))}
          </div>

          <section
            style={{
              background:
                "linear-gradient(135deg, #102c24 0%, #071b16 100%)",
              borderRadius: "20px",
              padding: "28px",
              color: "#ffffff",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 800,
                color: "#8ee7a8",
                letterSpacing: ".07em",
              }}
            >
              TRANSPORTADORAS
            </div>
            <h2 style={{ margin: "8px 0 6px", fontSize: "27px" }}>
              Centro de exportação
            </h2>
            <p
              style={{
                margin: 0,
                maxWidth: "650px",
                color: "#d3ded9",
                lineHeight: 1.6,
              }}
            >
              O acesso a cada transportadora é controlado individualmente
              pelo administrador da SellForge.
            </p>
          </section>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "16px",
            }}
          >
            <CarrierCard
              name="Trilhos"
              description="Exporte as encomendas selecionadas para um ficheiro Excel da SellForge."
              enabled={accountAllowed && trilhosEnabled}
              available
              href="/app/export"
            />

            <CarrierCard
              name="CTT"
              description="Integração dedicada aos envios CTT."
              enabled={accountAllowed && cttEnabled}
              available={false}
              badge={
                accountAllowed && cttEnabled
                  ? "ACESSO ATRIBUÍDO"
                  : "SEM ACESSO"
              }
            />

            <CarrierCard
              name="UPS"
              description="Integração dedicada aos envios UPS."
              enabled={accountAllowed && upsEnabled}
              available={false}
              badge={
                accountAllowed && upsEnabled
                  ? "ACESSO ATRIBUÍDO"
                  : "SEM ACESSO"
              }
            />
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};