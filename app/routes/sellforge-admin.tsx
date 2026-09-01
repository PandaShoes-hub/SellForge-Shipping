import crypto from "node:crypto";
import { useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";

import prisma from "../db.server";

type ActionResult = {
  success?: string;
  error?: string;
};

type FilterType = "all" | "active" | "suspended" | "expired";

const COOKIE_NAME = "sellforge_admin";

function getAdminSecret() {
  return process.env.SELLFORGE_ADMIN_PASSWORD || "";
}

function createToken() {
  const secret = getAdminSecret();

  return crypto
    .createHash("sha256")
    .update(`sellforge-admin:${secret}`)
    .digest("hex");
}

function getCookieToken(request: Request) {
  const cookie = request.headers.get("Cookie") || "";

  const match = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));

  if (!match) return "";

  return decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
}

function isAuthenticated(request: Request) {
  const secret = getAdminSecret();

  if (!secret) {
    throw new Response(
      "Falta SELLFORGE_ADMIN_PASSWORD no ficheiro .env.",
      { status: 500 },
    );
  }

  return getCookieToken(request) === createToken();
}

function normalizeShop(value: string) {
  let shop = value.trim().toLowerCase();

  shop = shop
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

  if (shop && !shop.includes(".")) {
    shop = `${shop}.myshopify.com`;
  }

  return shop;
}

function parseExpiryDate(value: string) {
  if (!value) return null;

  const date = new Date(`${value}T23:59:59.999Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(baseDate: Date, days: number) {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + days);
  return date;
}

export const loader = async ({
  request,
}: LoaderFunctionArgs) => {
  if (!isAuthenticated(request)) {
    return {
      authenticated: false,
      licenses: [],
      stats: {
        total: 0,
        active: 0,
        suspended: 0,
        expired: 0,
      },
    };
  }

  const licenses = await prisma.license.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });

  const now = new Date();

  return {
    authenticated: true,
    licenses,
    stats: {
      total: licenses.length,
      active: licenses.filter(
        (license) =>
          license.active &&
          (!license.expiresAt || license.expiresAt >= now),
      ).length,
      suspended: licenses.filter(
        (license) => !license.active,
      ).length,
      expired: licenses.filter(
        (license) =>
          license.expiresAt !== null &&
          license.expiresAt < now,
      ).length,
    },
  };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult | Response> => {
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "login") {
    const password = String(formData.get("password") || "");
    const expectedPassword = getAdminSecret();

    if (!expectedPassword) {
      return {
        error:
          "Falta SELLFORGE_ADMIN_PASSWORD no ficheiro .env.",
      };
    }

    if (password !== expectedPassword) {
      return {
        error: "Palavra-passe incorreta.",
      };
    }

    return redirect("/sellforge-admin", {
      headers: {
        "Set-Cookie": `${COOKIE_NAME}=${encodeURIComponent(
          createToken(),
        )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`,
      },
    });
  }

  if (intent === "logout") {
    return redirect("/sellforge-admin", {
      headers: {
        "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      },
    });
  }

  if (!isAuthenticated(request)) {
    return {
      error: "Sessão expirada. Volta a iniciar sessão.",
    };
  }

  try {
    if (intent === "create") {
      const shop = normalizeShop(
        String(formData.get("shop") || ""),
      );

      const company = String(
        formData.get("company") || "",
      ).trim();

      const notes = String(
        formData.get("notes") || "",
      ).trim();

      const expiresAtValue = String(
        formData.get("expiresAt") || "",
      );

      const trilhosEnabled = formData.get("trilhosEnabled") === "on";
      const cttEnabled = formData.get("cttEnabled") === "on";
      const upsEnabled = formData.get("upsEnabled") === "on";

      if (!shop || !shop.endsWith(".myshopify.com")) {
        return {
          error:
            "Indica um domínio válido, por exemplo loja.myshopify.com.",
        };
      }

      const existingLicense =
        await prisma.license.findUnique({
          where: {
            shop,
          },
        });

      if (existingLicense) {
        return {
          error: "Essa loja já está registada.",
        };
      }

      await prisma.license.create({
        data: {
          shop,
          company: company || null,
          notes: notes || null,
          expiresAt: parseExpiryDate(expiresAtValue),
          active: true,
          trilhosEnabled,
          cttEnabled,
          upsEnabled,
        },
      });

      return {
        success: "Cliente adicionado com sucesso.",
      };
    }

    if (intent === "toggle") {
      const id = String(formData.get("id") || "");

      const license = await prisma.license.findUnique({
        where: {
          id,
        },
      });

      if (!license) {
        return {
          error: "Licença não encontrada.",
        };
      }

      await prisma.license.update({
        where: {
          id,
        },
        data: {
          active: !license.active,
        },
      });

      return {
        success: license.active
          ? "Cliente suspenso."
          : "Cliente ativado.",
      };
    }

    if (intent === "toggleCarrier") {
      const id = String(formData.get("id") || "");
      const carrier = String(formData.get("carrier") || "");

      if (!["trilhos", "ctt", "ups"].includes(carrier)) {
        return {
          error: "Transportadora inválida.",
        };
      }

      const license = await prisma.license.findUnique({
        where: { id },
      });

      if (!license) {
        return {
          error: "Licença não encontrada.",
        };
      }

      const field =
        carrier === "trilhos"
          ? "trilhosEnabled"
          : carrier === "ctt"
            ? "cttEnabled"
            : "upsEnabled";

      const currentValue = license[field];

      await prisma.license.update({
        where: { id },
        data: {
          [field]: !currentValue,
        },
      });

      const carrierName =
        carrier === "trilhos" ? "Trilhos" : carrier === "ctt" ? "CTT" : "UPS";

      return {
        success: `${carrierName} ${currentValue ? "desativada" : "ativada"} para ${license.company || license.shop}.`,
      };
    }

    if (intent === "renew") {
      const id = String(formData.get("id") || "");

      const expiresAtValue = String(
        formData.get("expiresAt") || "",
      );

      await prisma.license.update({
        where: {
          id,
        },
        data: {
          expiresAt: parseExpiryDate(expiresAtValue),
          active: true,
        },
      });

      return {
        success: "Validade atualizada.",
      };
    }

    if (intent === "renewDays") {
      const id = String(formData.get("id") || "");
      const days = Number(formData.get("days") || 0);

      if (![30, 90, 365].includes(days)) {
        return {
          error: "Período de renovação inválido.",
        };
      }

      const license = await prisma.license.findUnique({
        where: { id },
      });

      if (!license) {
        return {
          error: "Licença não encontrada.",
        };
      }

      const now = new Date();
      const baseDate =
        license.expiresAt && license.expiresAt > now
          ? license.expiresAt
          : now;

      await prisma.license.update({
        where: { id },
        data: {
          expiresAt: addDays(baseDate, days),
          active: true,
        },
      });

      return {
        success: `Licença renovada por ${days} dias.`,
      };
    }

    if (intent === "delete") {
      const id = String(formData.get("id") || "");

      await prisma.license.delete({
        where: {
          id,
        },
      });

      return {
        success: "Cliente eliminado.",
      };
    }

    return {
      error: "Operação inválida.",
    };
  } catch (error) {
    console.error("Erro no SellForge Admin:", error);

    return {
      error: "Não foi possível concluir a operação.",
    };
  }
};

function formatDate(value: string | Date | null) {
  if (!value) return "Sem validade";

  return new Intl.DateTimeFormat("pt-PT").format(
    new Date(value),
  );
}

function isExpired(value: string | Date | null) {
  if (!value) return false;

  return new Date(value).getTime() < Date.now();
}

function daysUntil(value: string | Date | null) {
  if (!value) return null;

  const difference =
    new Date(value).getTime() - Date.now();

  return Math.ceil(difference / (1000 * 60 * 60 * 24));
}

export default function SellForgeAdmin() {
  const { authenticated, licenses, stats } =
    useLoaderData<typeof loader>();

  const actionData = useActionData<ActionResult>();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [copiedShop, setCopiedShop] = useState("");

  const filteredLicenses = useMemo(() => {
    const value = search.toLowerCase().trim();

    return licenses.filter((license) => {
      const expired = isExpired(license.expiresAt);

      const matchesSearch =
        !value ||
        license.shop.toLowerCase().includes(value) ||
        (license.company || "").toLowerCase().includes(value) ||
        (license.notes || "").toLowerCase().includes(value);

      const matchesFilter =
        filter === "all" ||
        (filter === "active" && license.active && !expired) ||
        (filter === "suspended" && !license.active) ||
        (filter === "expired" && expired);

      return matchesSearch && matchesFilter;
    });
  }, [licenses, search, filter]);

  async function copyShop(shop: string) {
    await navigator.clipboard.writeText(shop);
    setCopiedShop(shop);

    window.setTimeout(() => {
      setCopiedShop("");
    }, 1500);
  }

  if (!authenticated) {
    return (
      <main style={pageStyle}>
        <div
          style={{
            maxWidth: "420px",
            margin: "80px auto",
            background: "white",
            border: "1px solid #dfe3e8",
            borderRadius: "16px",
            padding: "28px",
          }}
        >
          <div
            style={{
              textAlign: "center",
              fontSize: "42px",
              marginBottom: "10px",
            }}
          >
            🔐
          </div>

          <h1
            style={{
              margin: 0,
              textAlign: "center",
              fontSize: "26px",
            }}
          >
            SellForge Admin
          </h1>

          <p
            style={{
              textAlign: "center",
              color: "#6d7175",
              margin: "8px 0 22px",
            }}
          >
            Introduz a palavra-passe de administração.
          </p>

          {actionData?.error && (
            <div style={errorStyle}>
              ❌ {actionData.error}
            </div>
          )}

          <Form method="post" style={{ display: "grid", gap: "12px" }}>
            <input type="hidden" name="intent" value="login" />

            <input
              name="password"
              type="password"
              required
              autoFocus
              placeholder="Palavra-passe"
              style={inputStyle}
            />

            <button type="submit" style={primaryButtonStyle}>
              Entrar
            </button>
          </Form>
        </div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <div
        style={{
          maxWidth: "1280px",
          margin: "0 auto",
          display: "grid",
          gap: "22px",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "30px" }}>
              🚚 SellForge Admin
            </h1>

            <p style={{ margin: "7px 0 0", color: "#6d7175" }}>
              Gestão dos clientes e licenças da SellForge Shipping
            </p>
          </div>

          <Form method="post">
            <input type="hidden" name="intent" value="logout" />
            <button type="submit" style={smallButtonStyle}>
              Sair
            </button>
          </Form>
        </header>

        {actionData?.success && (
          <div style={successStyle}>
            ✅ {actionData.success}
          </div>
        )}

        {actionData?.error && (
          <div style={errorStyle}>
            ❌ {actionData.error}
          </div>
        )}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: "14px",
          }}
        >
          <StatCard label="Clientes" value={stats.total} icon="🏪" />
          <StatCard label="Licenças ativas" value={stats.active} icon="🟢" />
          <StatCard label="Suspensas" value={stats.suspended} icon="🔴" />
          <StatCard label="Expiradas" value={stats.expired} icon="📅" />
        </section>

        <section style={sectionStyle}>
          <h2 style={{ margin: "0 0 18px", fontSize: "20px" }}>
            ➕ Adicionar cliente
          </h2>

          <Form
            method="post"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "15px",
            }}
          >
            <input type="hidden" name="intent" value="create" />

            <Field label="Domínio da loja">
              <input
                name="shop"
                required
                placeholder="cliente.myshopify.com"
                style={inputStyle}
              />
            </Field>

            <Field label="Empresa ou cliente">
              <input
                name="company"
                placeholder="Nome do cliente"
                style={inputStyle}
              />
            </Field>

            <Field label="Data de validade">
              <input
                name="expiresAt"
                type="date"
                style={inputStyle}
              />
            </Field>

            <Field label="Notas">
              <input
                name="notes"
                placeholder="Pagamento, plano, contacto..."
                style={inputStyle}
              />
            </Field>

            <div
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                gap: "18px",
                flexWrap: "wrap",
                padding: "12px 14px",
                background: "#f6f6f7",
                borderRadius: "10px",
              }}
            >
              <label style={carrierCheckboxLabelStyle}>
                <input
                  type="checkbox"
                  name="trilhosEnabled"
                  defaultChecked
                />
                Trilhos
              </label>

              <label style={carrierCheckboxLabelStyle}>
                <input type="checkbox" name="cttEnabled" />
                CTT
              </label>

              <label style={carrierCheckboxLabelStyle}>
                <input type="checkbox" name="upsEnabled" />
                UPS
              </label>
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <button type="submit" style={primaryButtonStyle}>
                Guardar cliente
              </button>
            </div>
          </Form>
        </section>

        <section style={{ ...sectionStyle, padding: 0, overflow: "hidden" }}>
          <div
            style={{
              padding: "18px 22px",
              borderBottom: "1px solid #e1e3e5",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "14px",
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: "20px" }}>
                Clientes
              </h2>

              <div
                style={{
                  marginTop: "4px",
                  color: "#6d7175",
                  fontSize: "13px",
                }}
              >
                {filteredLicenses.length} resultado(s)
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <input
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="🔍 Pesquisar cliente ou loja..."
                style={{
                  ...inputStyle,
                  width: "280px",
                }}
              />

              <select
                value={filter}
                onChange={(event) =>
                  setFilter(event.currentTarget.value as FilterType)
                }
                style={{
                  ...inputStyle,
                  width: "170px",
                }}
              >
                <option value="all">Todas</option>
                <option value="active">Ativas</option>
                <option value="suspended">Suspensas</option>
                <option value="expired">Expiradas</option>
              </select>
            </div>
          </div>

          {filteredLicenses.length === 0 ? (
            <div
              style={{
                padding: "40px",
                textAlign: "center",
                color: "#6d7175",
              }}
            >
              Nenhum cliente encontrado.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f6f6f7" }}>
                    <TableHeader>Cliente</TableHeader>
                    <TableHeader>Loja</TableHeader>
                    <TableHeader>Estado</TableHeader>
                    <TableHeader>Trilhos</TableHeader>
                    <TableHeader>CTT</TableHeader>
                    <TableHeader>UPS</TableHeader>
                    <TableHeader>Validade</TableHeader>
                    <TableHeader>Último acesso</TableHeader>
                    <TableHeader>Ações</TableHeader>
                  </tr>
                </thead>

                <tbody>
                  {filteredLicenses.map((license) => {
                    const expired = isExpired(license.expiresAt);
                    const active = license.active && !expired;
                    const remainingDays = daysUntil(license.expiresAt);
                    const expiringSoon =
                      active &&
                      remainingDays !== null &&
                      remainingDays >= 0 &&
                      remainingDays <= 7;

                    return (
                      <tr
                        key={license.id}
                        style={{ borderTop: "1px solid #e1e3e5" }}
                      >
                        <TableCell>
                          <strong>{license.company || "Sem nome"}</strong>

                          {license.notes && (
                            <div
                              style={{
                                marginTop: "4px",
                                color: "#6d7175",
                                fontSize: "12px",
                              }}
                            >
                              {license.notes}
                            </div>
                          )}
                        </TableCell>

                        <TableCell>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <span>{license.shop}</span>

                            <button
                              type="button"
                              onClick={() => copyShop(license.shop)}
                              title="Copiar domínio"
                              style={{
                                ...iconButtonStyle,
                                color:
                                  copiedShop === license.shop
                                    ? "#235b18"
                                    : "#4a4f53",
                              }}
                            >
                              {copiedShop === license.shop ? "✅" : "📋"}
                            </button>
                          </div>
                        </TableCell>

                        <TableCell>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "5px 10px",
                              borderRadius: "999px",
                              background: expired
                                ? "#fff1f0"
                                : expiringSoon
                                  ? "#fff4d6"
                                  : active
                                    ? "#e3f1df"
                                    : "#fff1f0",
                              color: expired
                                ? "#8a1f17"
                                : expiringSoon
                                  ? "#8a6116"
                                  : active
                                    ? "#235b18"
                                    : "#8a1f17",
                              fontWeight: 700,
                              fontSize: "12px",
                            }}
                          >
                            {expired
                              ? "🔴 EXPIRADA"
                              : expiringSoon
                                ? `🟡 EXPIRA EM ${remainingDays} DIA(S)`
                                : license.active
                                  ? "🟢 ATIVA"
                                  : "🔴 SUSPENSA"}
                          </span>
                        </TableCell>

                        <TableCell>
                          <CarrierToggle
                            id={license.id}
                            carrier="trilhos"
                            enabled={license.trilhosEnabled}
                            disabled={!active}
                          />
                        </TableCell>

                        <TableCell>
                          <CarrierToggle
                            id={license.id}
                            carrier="ctt"
                            enabled={license.cttEnabled}
                            disabled={!active}
                          />
                        </TableCell>

                        <TableCell>
                          <CarrierToggle
                            id={license.id}
                            carrier="ups"
                            enabled={license.upsEnabled}
                            disabled={!active}
                          />
                        </TableCell>

                        <TableCell>
                          <div>{formatDate(license.expiresAt)}</div>

                          {remainingDays !== null && !expired && (
                            <div
                              style={{
                                marginTop: "4px",
                                color: "#6d7175",
                                fontSize: "12px",
                              }}
                            >
                              {remainingDays} dia(s) restante(s)
                            </div>
                          )}
                        </TableCell>

                        <TableCell>
                          {formatDate(license.lastAccessAt)}
                        </TableCell>

                        <TableCell>
                          <div
                            style={{
                              display: "grid",
                              gap: "8px",
                              minWidth: "310px",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                gap: "6px",
                                flexWrap: "wrap",
                              }}
                            >
                              <Form method="post">
                                <input type="hidden" name="intent" value="toggle" />
                                <input type="hidden" name="id" value={license.id} />

                                <button
                                  type="submit"
                                  style={{
                                    ...smallButtonStyle,
                                    background: license.active
                                      ? "#fff1f0"
                                      : "#e3f1df",
                                    color: license.active
                                      ? "#8a1f17"
                                      : "#235b18",
                                  }}
                                >
                                  {license.active ? "Suspender" : "Ativar"}
                                </button>
                              </Form>

                              {[30, 90, 365].map((days) => (
                                <Form method="post" key={days}>
                                  <input
                                    type="hidden"
                                    name="intent"
                                    value="renewDays"
                                  />
                                  <input type="hidden" name="id" value={license.id} />
                                  <input type="hidden" name="days" value={days} />

                                  <button
                                    type="submit"
                                    style={smallButtonStyle}
                                  >
                                    +{days} dias
                                  </button>
                                </Form>
                              ))}
                            </div>

                            <div
                              style={{
                                display: "flex",
                                gap: "6px",
                                flexWrap: "wrap",
                              }}
                            >
                              <Form
                                method="post"
                                style={{ display: "flex", gap: "6px" }}
                              >
                                <input type="hidden" name="intent" value="renew" />
                                <input type="hidden" name="id" value={license.id} />

                                <input
                                  name="expiresAt"
                                  type="date"
                                  required
                                  style={{
                                    ...inputStyle,
                                    padding: "7px",
                                    width: "145px",
                                  }}
                                />

                                <button type="submit" style={smallButtonStyle}>
                                  Data manual
                                </button>
                              </Form>

                              <Form
                                method="post"
                                onSubmit={(event) => {
                                  const confirmed = window.confirm(
                                    `Eliminar definitivamente ${license.shop}?`,
                                  );

                                  if (!confirmed) {
                                    event.preventDefault();
                                  }
                                }}
                              >
                                <input type="hidden" name="intent" value="delete" />
                                <input type="hidden" name="id" value={license.id} />

                                <button
                                  type="submit"
                                  style={{
                                    ...smallButtonStyle,
                                    color: "#8a1f17",
                                  }}
                                >
                                  Eliminar
                                </button>
                              </Form>
                            </div>
                          </div>
                        </TableCell>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function CarrierToggle({
  id,
  carrier,
  enabled,
  disabled,
}: {
  id: string;
  carrier: "trilhos" | "ctt" | "ups";
  enabled: boolean;
  disabled: boolean;
}) {
  const carrierName =
    carrier === "trilhos" ? "Trilhos" : carrier === "ctt" ? "CTT" : "UPS";

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="toggleCarrier" />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="carrier" value={carrier} />

      <button
        type="submit"
        disabled={disabled}
        title={
          disabled
            ? "Ativa primeiro a licença da loja."
            : `${enabled ? "Desativar" : "Ativar"} ${carrierName}`
        }
        style={{
          ...smallButtonStyle,
          minWidth: "62px",
          background: disabled
            ? "#f1f2f3"
            : enabled
              ? "#e3f1df"
              : "#fff1f0",
          color: disabled
            ? "#8c9196"
            : enabled
              ? "#235b18"
              : "#8a1f17",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.7 : 1,
        }}
      >
        {enabled ? "✅ ON" : "🔒 OFF"}
      </button>
    </Form>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: string;
}) {
  return (
    <div style={sectionStyle}>
      <div style={{ color: "#6d7175", fontSize: "13px" }}>
        {icon} {label}
      </div>

      <strong
        style={{
          display: "block",
          marginTop: "7px",
          fontSize: "27px",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "grid",
        gap: "7px",
        fontWeight: 600,
        fontSize: "14px",
      }}
    >
      {label}
      {children}
    </label>
  );
}

function TableHeader({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <th
      style={{
        padding: "13px 15px",
        textAlign: "left",
        fontSize: "13px",
        color: "#4a4f53",
      }}
    >
      {children}
    </th>
  );
}

function TableCell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <td
      style={{
        padding: "15px",
        verticalAlign: "top",
        fontSize: "14px",
      }}
    >
      {children}
    </td>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f4f6f8",
  padding: "32px 20px",
  fontFamily:
    "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
};

const sectionStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #dfe3e8",
  borderRadius: "14px",
  padding: "22px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  border: "1px solid #c9cccf",
  borderRadius: "8px",
  fontSize: "14px",
  background: "white",
};

const primaryButtonStyle: React.CSSProperties = {
  border: 0,
  borderRadius: "8px",
  padding: "11px 18px",
  background: "#005bd3",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const smallButtonStyle: React.CSSProperties = {
  border: "1px solid #c9cccf",
  borderRadius: "7px",
  padding: "7px 10px",
  background: "white",
  color: "#202223",
  fontWeight: 600,
  cursor: "pointer",
};

const iconButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  padding: "2px",
  cursor: "pointer",
  fontSize: "15px",
};

const carrierCheckboxLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "7px",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
};

const successStyle: React.CSSProperties = {
  padding: "13px 16px",
  background: "#e3f1df",
  border: "1px solid #aee09f",
  borderRadius: "10px",
  color: "#235b18",
  fontWeight: 600,
};

const errorStyle: React.CSSProperties = {
  padding: "13px 16px",
  background: "#fff1f0",
  border: "1px solid #f0b8b5",
  borderRadius: "10px",
  color: "#8a1f17",
  fontWeight: 600,
};