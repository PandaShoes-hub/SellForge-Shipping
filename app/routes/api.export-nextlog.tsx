import type { ActionFunctionArgs } from "react-router";
import ExcelJS from "exceljs";

import { authenticate } from "../shopify.server";
import { getLicenseStatus } from "../utils/license.server";
import {
  NEXTLOG_HEADERS,
  buildNextlogRow,
  clean,
  recipientName,
  type NextlogOrder,
} from "../utils/nextlog-excel.server";

// Exportador exclusivo da NextLog. Não carrega o modelo ATT_IMPORT da Trilhos.
export async function action({ request }: ActionFunctionArgs) {
  let stage = "autenticação Shopify";
  try {
    const { admin, session } = await authenticate.admin(request);
    stage = "verificação da licença NextLog";
    const license = await getLicenseStatus(session.shop);
    if (!license.allowed || !license.nextlogEnabled) {
      return Response.json(
        { error: "Esta loja não tem autorização para utilizar a exportação NextLog." },
        { status: 403 },
      );
    }

    const body = await request.json();
    if (body?.carrier && clean(body.carrier).toLowerCase() !== "nextlog") {
      return Response.json(
        { error: "Este exportador é exclusivo da NextLog." },
        { status: 400 },
      );
    }
    const orderIds: string[] = Array.isArray(body?.orderIds)
      ? body.orderIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
      : [];
    if (!orderIds.length) {
      return Response.json(
        { error: "Nenhuma encomenda foi selecionada para exportação." },
        { status: 400 },
      );
    }

    stage = "consulta das encomendas NextLog à Shopify";
    const response = await admin.graphql(
      `#graphql
      query SellForgeNextlogOrders($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Order {
            id
            name
            email
            phone
            currentTotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            shippingAddress {
              name
              firstName
              lastName
              address1
              address2
              zip
              city
              phone
              countryCodeV2
            }
          }
        }
      }`,
      { variables: { ids: orderIds } },
    );
    const json = (await response.json()) as {
      data?: { nodes?: (NextlogOrder | null)[] };
      errors?: { message?: string }[];
    };
    if (json.errors?.length) {
      return Response.json(
        { error: "A Shopify devolveu um erro ao carregar as encomendas para a NextLog." },
        { status: 502 },
      );
    }
    const orders = (json.data?.nodes ?? []).filter(
      (order): order is NextlogOrder => Boolean(order?.id && order?.name),
    );
    if (!orders.length) {
      return Response.json(
        { error: "Não foi possível carregar as encomendas selecionadas." },
        { status: 404 },
      );
    }
    if (orders.length !== orderIds.length) {
      return Response.json(
        { error: "Uma ou mais encomendas já não estão disponíveis. Atualiza a página e tenta novamente." },
        { status: 409 },
      );
    }

    for (const order of orders) {
      const address = order.shippingAddress;
      const country = clean(address?.countryCodeV2).toUpperCase();
      if (country !== "PT" && country !== "ES") {
        return Response.json(
          { error: `NextLog: a encomenda ${order.name} não tem destino Portugal ou Espanha válido.` },
          { status: 422 },
        );
      }
      const absent = [
        ["nome", recipientName(order)],
        ["morada", address?.address1],
        ["código postal", clean(address?.zip).replace(/^'+/, "")],
        ["localidade", address?.city],
        ["telefone", clean(address?.phone) || order.phone],
      ].filter(([, value]) => !clean(value));
      if (absent.length) {
        return Response.json(
          { error: `NextLog: faltam ${absent.map(([field]) => field).join(", ")} na encomenda ${order.name}. Corrige na Shopify e tenta novamente.` },
          { status: 422 },
        );
      }
      const amountRaw = order.currentTotalPriceSet?.shopMoney?.amount;
      const amount = Number(amountRaw);
      if (amountRaw === undefined || amountRaw === null || amountRaw === "" || !Number.isFinite(amount) || amount < 0) {
        return Response.json(
          { error: `NextLog: valor atual inválido na encomenda ${order.name}.` },
          { status: 422 },
        );
      }
      const service = country === "PT" ? license.nextlogPtService : license.nextlogEsService;
      if (!clean(service)) {
        return Response.json(
          { error: `NextLog: falta configurar o serviço de ${country === "PT" ? "Portugal" : "Espanha"} no Admin.` },
          { status: 422 },
        );
      }
    }

    stage = "criação do Excel NextLog";
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SellForge Shipping";
    workbook.title = "NextLog — MODELO CTT";
    const sheet = workbook.addWorksheet("Listagem");
    NEXTLOG_HEADERS.forEach((header, index) => {
      sheet.getRow(1).getCell(index + 1).value = header;
    });
    orders.forEach((order, index) => {
      const row = sheet.getRow(index + 2);
      buildNextlogRow(order, license).forEach((value, column) => {
        row.getCell(column + 1).value = value;
      });
      [1, 3, 4, 5, 6, 7, 8, 9, 13, 14].forEach((column) => {
        row.getCell(column).numFmt = "@";
      });
      row.getCell(2).numFmt = "0.00";
      [10, 11, 12].forEach((column) => {
        row.getCell(column).numFmt = "0";
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="SELLFORGE_NEXTLOG_CTT.xlsx"',
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Erro no exportador NextLog:", { etapa: stage, erro: error });
    return Response.json(
      { error: `Não foi possível gerar o Excel NextLog. Falha na etapa: ${stage}.` },
      { status: 500 },
    );
  }
}
