import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
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

import { useMemo, useState } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
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

export const loader = async ({
  request,
}: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const licensed = isShopLicensed(session.shop);

  if (!licensed) {
    return {
      licensed: false,
      shop: session.shop,
      orders: [] as Order[],
    };
  }

  const orders: Order[] = [];

  return {
    licensed: true,
    shop: session.shop,
    orders,
  };
};

export default function Index() {
  const { licensed, shop, orders } = useLoaderData<typeof loader>();

  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
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

    const allVisibleSelected =
      visibleIds.length > 0 &&
      visibleIds.every((id) => selectedOrders.includes(id));

    if (allVisibleSelected) {
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

    try {
      const response = await fetch("/api/export-selected", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderIds: selectedOrders,
        }),
      });

      if (!response.ok) {
        throw new Error(`Erro ao exportar: ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const downloadLink = document.createElement("a");
      downloadLink.href = url;
      downloadLink.download = "SELLFORGE_SHIPPING.xlsx";

      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();

      window.URL.revokeObjectURL(url);

      setSuccess(true);

      setTimeout(() => {
        setSuccess(false);
      }, 2500);
    } catch (error) {
      console.error("Erro ao exportar encomendas:", error);
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
              maxWidth: "680px",
              margin: "40px auto",
              padding: "32px",
              background: "white",
              border: "1px solid #dfe3e8",
              borderRadius: "16px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "42px", marginBottom: "12px" }}>🔒</div>
            <h2 style={{ margin: 0, fontSize: "24px" }}>Licença inativa</h2>
            <p style={{ margin: "12px 0 0", color: "#666" }}>
              Esta loja não tem autorização para utilizar a SellForge Shipping.
            </p>
            <p style={{ margin: "8px 0 0", color: "#666" }}>
              Loja: <strong>{shop}</strong>
            </p>
            <p style={{ margin: "18px 0 0", color: "#444" }}>
              Contacte a SellForge para ativar ou renovar o acesso.
            </p>
          </div>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="SellForge Shipping">
      <s-section>
        <div style={{ display: "grid", gap: "18px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "16px",
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: "24px" }}>
                🚚 SellForge Shipping
              </h2>

              <p style={{ margin: "6px 0 0", color: "#666" }}>
                Exportação para Trilhos Dinâmicos
              </p>
            </div>

            <s-button
              variant="primary"
              disabled={selectedOrders.length === 0 || loading}
              onClick={exportSelected}
            >
              {loading
                ? "A exportar..."
                : `📥 Exportar (${selectedOrders.length})`}
            </s-button>
          </div>

          {success && (
            <div
              style={{
                padding: "12px 14px",
                borderRadius: "10px",
                background: "#e3f1df",
                border: "1px solid #b4e1aa",
                fontWeight: 600,
              }}
            >
              ✅ Excel exportado com sucesso
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "12px",
            }}
          >
            <div
              style={{
                padding: "14px",
                border: "1px solid #dfe3e8",
                borderRadius: "12px",
                background: "white",
              }}
            >
              <div style={{ color: "#666", fontSize: "13px" }}>
                📦 Encomendas
              </div>

              <strong style={{ fontSize: "22px" }}>{orders.length}</strong>
            </div>

            <div
              style={{
                padding: "14px",
                border: "1px solid #dfe3e8",
                borderRadius: "12px",
                background: "white",
              }}
            >
              <div style={{ color: "#666", fontSize: "13px" }}>
                ☑ Selecionadas
              </div>

              <strong style={{ fontSize: "22px" }}>
                {selectedOrders.length}
              </strong>
            </div>

            <div
              style={{
                padding: "14px",
                border: "1px solid #dfe3e8",
                borderRadius: "12px",
                background: "white",
              }}
            >
              <div style={{ color: "#666", fontSize: "13px" }}>
                💰 Valor
              </div>

              <strong style={{ fontSize: "22px" }}>
                {selectedTotal.toFixed(2)} €
              </strong>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: "12px",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              padding: "14px",
              border: "1px solid #dfe3e8",
              borderRadius: "12px",
              background: "white",
            }}
          >
            <input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="🔍 Pesquisar por encomenda, cliente ou nota..."
              style={{
                width: "100%",
                maxWidth: "440px",
                padding: "11px 13px",
                border: "1px solid #c9cccf",
                borderRadius: "9px",
                fontSize: "14px",
              }}
            />

            <s-button onClick={toggleAll} disabled={loading}>
              Selecionar todas
            </s-button>
          </div>

          <div
            style={{
              border: "1px solid #dfe3e8",
              borderRadius: "12px",
              overflow: "hidden",
              background: "white",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "48px 110px 1fr 120px 140px",
                gap: "12px",
                padding: "13px 16px",
                background: "#f6f6f7",
                fontWeight: 700,
                fontSize: "13px",
              }}
            >
              <span></span>
              <span>Encomenda</span>
              <span>Cliente / Nota</span>
              <span>Data</span>
              <span style={{ textAlign: "right" }}>Total</span>
            </div>

            {filteredOrders.length === 0 && (
              <div style={{ padding: "28px", textAlign: "center" }}>
                ✅ Não existem encomendas não processadas.
              </div>
            )}

            {filteredOrders.map((order) => {
              const selected = selectedOrders.includes(order.id);

              return (
                <label
                  key={order.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "48px 110px 1fr 120px 140px",
                    gap: "12px",
                    alignItems: "center",
                    padding: "14px 16px",
                    borderTop: "1px solid #eee",
                    cursor: loading ? "not-allowed" : "pointer",
                    background: selected ? "#eef4ff" : "white",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={loading}
                    onChange={() => toggleOrder(order.id)}
                  />

                  <strong>{order.name}</strong>

                  <div>
  <div>{order.customerName}</div>

  {order.note && (
    <div
      style={{
        marginTop: "5px",
        display: "inline-block",
        background: "#fff4d6",
        color: "#8a6116",
        padding: "3px 8px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 600,
      }}
    >
      📝 {order.note}
    </div>
  )}

  <div
    style={{
      marginTop: "6px",
      fontSize: "12px",
      color: "#666",
      fontWeight: 600,
    }}
  >
    {order.country === "ES"
      ? "🇪🇸 Espanha"
      : order.country === "PT"
        ? "🇵🇹 Portugal"
        : order.country || "País não definido"}
  </div>
</div>

                  <span>{order.createdAt}</span>

                  <strong style={{ textAlign: "right" }}>
                    {order.total}
                  </strong>
                </label>
              );
            })}
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};