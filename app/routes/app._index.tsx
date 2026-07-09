import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

type Order = {
  id: string;
  name: string;
  customerName: string;
  total: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

const response = await admin.graphql(`
  #graphql
  query {
    orders(
      first: 50,
      sortKey: CREATED_AT,
      reverse: true,
      query: "status:open fulfillment_status:unfulfilled"
    ) {
      edges {
        node {
          id
          name
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
    };
  });

  return { orders };
};

export default function Index() {
  const { orders } = useLoaderData<typeof loader>();
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  function toggleOrder(orderId: string) {
    setSelectedOrders((current) =>
      current.includes(orderId)
        ? current.filter((id) => id !== orderId)
        : [...current, orderId]
    );
  }

  function toggleAll() {
    if (selectedOrders.length === orders.length) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(orders.map((order) => order.id));
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
    <s-page heading="Exportar Encomendas para Trilhos">
      <s-section>
        <s-stack direction="block" gap="base">
          <s-button onClick={toggleAll}>
            {selectedOrders.length === orders.length
              ? "Desmarcar todas"
              : "Selecionar todas"}
          </s-button>

          <s-box borderWidth="base" borderRadius="base" padding="base">
            <div style={{ display: "grid", gap: "10px" }}>
              {orders.length === 0 && (
                <p>Não existem encomendas por processar.</p>
              )}

              {orders.map((order) => (
                <label
                  key={order.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "15px",
                    padding: "10px",
                    borderBottom: "1px solid #ddd",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedOrders.includes(order.id)}
                    onChange={() => toggleOrder(order.id)}
                  />

                  <strong style={{ width: "90px" }}>{order.name}</strong>

                  <span style={{ flex: 1 }}>{order.customerName}</span>

                  <strong>{order.total}</strong>
                </label>
              ))}
            </div>
          </s-box>

          <s-text>Selecionadas: {selectedOrders.length}</s-text>

          <s-button
            variant="primary"
            disabled={selectedOrders.length === 0 || loading}
            onClick={exportSelected}
          >
            {loading ? "A exportar..." : "Exportar selecionadas"}
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};