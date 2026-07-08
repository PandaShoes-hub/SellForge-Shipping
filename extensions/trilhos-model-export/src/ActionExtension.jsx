import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { close, data } = shopify;
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloadUrl, setDownloadUrl] = useState("");

  useEffect(() => {
    async function getOrder() {
      const query = {
        query: `
          query Order($id: ID!) {
            order(id: $id) {
              name
              totalPriceSet {
                shopMoney {
                  amount
                }
              }
              email
              phone
              note
              shippingAddress {
                name
                address1
                address2
                zip
                city
                country
                phone
              }
            }
          }
        `,
        variables: {
          id: data.selected[0].id,
        },
      };

      const res = await fetch("shopify:admin/api/graphql.json", {
        method: "POST",
        body: JSON.stringify(query),
      });

      const json = await res.json();
      setOrder(json.data.order);
      setLoading(false);
    }

    getOrder();
  }, []);

  async function exportExcel() {
    const address = order.shippingAddress || {};

    const payload = {
      ref: order.name,
      cobranca: order.totalPriceSet.shopMoney.amount,
      nome: address.name || "",
      morada: `${address.address1 || ""} ${address.address2 || ""}`.trim(),
      cp: address.zip || "",
      localidade: address.city || "",
      contacto: address.phone || order.phone || "",
      pais: "ES",
      email: order.email || "",
      obs: order.note || "",
    };

    const response = await fetch("/api/export-trilhos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (result.success) {
      setDownloadUrl(result.downloadUrl);
    }
  }

  return (
    <s-admin-action>
      <s-stack direction="block" gap="base">
        <s-heading>Exportar para Trilhos</s-heading>

        {loading && <s-text>A carregar encomenda...</s-text>}

        {!loading && order && (
          <>
            <s-text>Encomenda: {order.name}</s-text>
            <s-text>Cliente: {order.shippingAddress?.name || "Sem nome"}</s-text>
            <s-text>Total: {order.totalPriceSet.shopMoney.amount} €</s-text>
          </>
        )}

        {downloadUrl && (
          <s-link href={downloadUrl} target="_blank">
            Descarregar Excel
          </s-link>
        )}
      </s-stack>

      <s-button
        slot="primary-action"
        variant="primary"
        disabled={loading || !order}
        onClick={exportExcel}
      >
        Criar Excel
      </s-button>

      <s-button slot="secondary-actions" onClick={() => close()}>
        Fechar
      </s-button>
    </s-admin-action>
  );
}