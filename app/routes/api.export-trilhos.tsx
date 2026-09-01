import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://extensions.shopifycdn.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, authorization",
};

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  return Response.json(
    {
      error:
        "Endpoint antigo desativado. Utilize a exportação dentro da SellForge Shipping.",
    },
    {
      status: 410,
      headers: corsHeaders,
    },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  return Response.json(
    {
      error:
        "Endpoint antigo desativado. Utilize a exportação dentro da SellForge Shipping.",
    },
    {
      status: 410,
      headers: corsHeaders,
    },
  );
}
