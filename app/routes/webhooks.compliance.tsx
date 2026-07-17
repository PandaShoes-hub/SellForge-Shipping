import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } =
    await authenticate.webhook(request);

  console.log(`Compliance webhook ${topic} recebido de ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      console.log("Pedido de dados do cliente:", payload);
      break;

    case "CUSTOMERS_REDACT":
      console.log("Pedido de eliminação dos dados do cliente:", payload);
      break;

    case "SHOP_REDACT":
      console.log("Pedido de eliminação dos dados da loja:", payload);
      break;

    default:
      console.log(`Webhook de compliance desconhecido: ${topic}`);
  }

  return new Response(null, {
    status: 200,
  });
};