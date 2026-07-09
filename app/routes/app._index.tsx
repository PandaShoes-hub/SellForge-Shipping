import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

type Order = {
  id: string;
  name: string;
  customerName: string;
  total: string;
  createdAt: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

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
            createdAt
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            shippingAddress {
              name
            }
          }
        }
      }
    }
  `);

  const json = await response.json();

  const orders: Order[] = json.data.orders.edges.map((edge: any) => {
    const order = edge.node;

    return {
      id: order.id,
      name: order.name,
      customerName: order.shippingAddress?.name || "Sem nome",
      total: `${order.totalPriceSet.shopMoney.amount} ${order.totalPriceSet.shopMoney.currencyCode}`,
      createdAt: new Date(order.createdAt).toLocaleDateString("pt-PT"),
    };
  });

  return { orders };
};

export default function Index() {
  const { orders } = useLoaderData<typeof loader>();

  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const filteredOrders = useMemo(() => {
    const value = search.toLowerCase().trim();

    if (!value) return orders;

    return orders.filter(
      (order) =>
        order.name.toLowerCase().includes(value) ||
        order.customerName.toLowerCase().includes(value),
    );
  }, [orders, search]);

  function toggleOrder(orderId: string) {
    setSelectedOrders((current) =>
      current.includes(orderId)
        ? current.filter((id) => id !== orderId)
        : [...current, orderId],
    );
  }

  function toggleAll() {
    const visibleIds = filteredOrders.map((order) => order.id);
    const allVisibleSelected = visibleIds.every((id) =>
      selectedOrders.includes(id),
    );

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

    const response = await fetch("/api/export-selected", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orderIds: selectedOrders }),
    });

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "ATT_IMPORT_TRILHOS.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);
    setLoading(false);
  }

  return (
    <s-page heading="Exportar para Trilhos">
      <s-section>
        <div
          style={{
            display: "grid",
            gap: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: "12px",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 style={{ margin: 0 }}>Encomendas não processadas</h2>
              <p style={{ margin: "4px 0 0", color: "#666" }}>
                Seleciona as encomendas que queres exportar para a Trilhos.
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <s-button onClick={toggleAll}>
                Selecionar todas
              </s-button>

              <s-button
                variant="primary"
                disabled={selectedOrders.length === 0 || loading}
                onClick={exportSelected}
              >
                {loading
                  ? "A exportar..."
                  : `Exportar ${selectedOrders.length || ""}`}
              </s-button>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: "12px",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Pesquisar por encomenda ou cliente..."
              style={{
                width: "100%",
                maxWidth: "420px",
                padding: "10px 12px",
                border: "1px solid #c9cccf",
                borderRadius: "8px",
                fontSize: "14px",
              }}
            />

            <strong>{selectedOrders.length} selecionada(s)</strong>
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
                padding: "12px 16px",
                background: "#f6f6f7",
                fontWeight: 700,
                fontSize: "13px",
              }}
            >
              <span></span>
              <span>Encomenda</span>
              <span>Cliente</span>
              <span>Data</span>
              <span style={{ textAlign: "right" }}>Total</span>
            </div>

            {filteredOrders.length === 0 && (
              <div style={{ padding: "24px", textAlign: "center" }}>
                Não existem encomendas não processadas.
              </div>
            )}

            {filteredOrders.map((order) => (
              <label
                key={order.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "48px 110px 1fr 120px 140px",
                  gap: "12px",
                  alignItems: "center",
                  padding: "14px 16px",
                  borderTop: "1px solid #eee",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedOrders.includes(order.id)}
                  onChange={() => toggleOrder(order.id)}
                />

                <strong>{order.name}</strong>
                <span>{order.customerName}</span>
                <span>{order.createdAt}</span>
                <strong style={{ textAlign: "right" }}>{order.total}</strong>
              </label>
            ))}
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};