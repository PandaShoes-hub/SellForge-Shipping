import type { ActionFunctionArgs } from "react-router";
import ExcelJS from "exceljs";
import {
  NEXTLOG_HEADERS,
  buildNextlogRow,
  recipientName,
  clean,
  type NextlogOrder,
  type NextlogShop,
} from "../utils/nextlog-excel.server";
import path from "node:path";

import { authenticate } from "../shopify.server";
import { getLicenseStatus } from "../utils/license.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { admin, session } =
      await authenticate.admin(request);

    const license = await getLicenseStatus(session.shop);

    if (!license.allowed) {
      return Response.json(
        {
          error: "A conta desta loja não está ativa.",
        },
        { status: 403 },
      );
    }

    const body = await request.json();
    const carrier = body?.carrier == null
      ? "trilhos"
      : String(body.carrier).trim().toLowerCase();

    if (carrier !== "trilhos" && carrier !== "nextlog") {
      return Response.json(
        { error: "Transportadora não suportada nesta exportação." },
        { status: 400 },
      );
    }

    const enabled = carrier === "nextlog"
      ? license.nextlogEnabled
      : license.trilhosEnabled;

    if (!enabled) {
      return Response.json(
        { error: `Esta loja não tem autorização para utilizar a exportação ${carrier === "nextlog" ? "NextLog" : "Trilhos"}.` },
        { status: 403 },
      );
    }

    const orderIds = Array.isArray(body?.orderIds)
      ? body.orderIds.filter(
          (id: unknown) =>
            typeof id === "string" && id.length > 0,
        )
      : [];

    if (orderIds.length === 0) {
      return Response.json(
        {
          error:
            "Nenhuma encomenda foi selecionada para exportação.",
        },
        { status: 400 },
      );
    }

    const response = await admin.graphql(
      `#graphql
      query GetOrders($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Order {
            id
            name
            email
            phone
            currentTotalWeight
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
              province
              phone
              countryCodeV2
            }
          }
        }
      }`,
      {
        variables: {
          ids: orderIds,
        },
      },
    );

    const json = (await response.json()) as {
      data?: { nodes?: any[] };
      errors?: Array<{ message?: string }>;
    };

    if (json?.errors?.length) {
      console.error("Erro GraphQL Shopify:", json.errors);

      return Response.json(
        {
          error:
            "A Shopify devolveu um erro ao carregar as encomendas.",
        },
        { status: 502 },
      );
    }

    const nodes = Array.isArray(json?.data?.nodes)
      ? json.data.nodes
      : [];

    const orders = nodes.filter(
      (order: any) =>
        order &&
        order.id &&
        order.name,
    );

    if (orders.length === 0) {
      return Response.json(
        {
          error:
            "Não foi possível carregar as encomendas selecionadas.",
        },
        { status: 404 },
      );
    }

    if (orders.length !== orderIds.length) {
      return Response.json(
        {
          error:
            "Uma ou mais encomendas foram alteradas, removidas ou já não estão disponíveis. Atualize a página e tente novamente.",
        },
        { status: 409 },
      );
    }

    if (carrier === "nextlog") {
      const unsupportedOrder = orders.find((order: any) => {
        const country = String(order.shippingAddress?.countryCodeV2 || "").toUpperCase();
        return country !== "PT" && country !== "ES";
      });

      if (unsupportedOrder) {
        return Response.json(
          { error: `NextLog: a encomenda ${unsupportedOrder.name} não tem destino Portugal ou Espanha válido.` },
          { status: 422 },
        );
      }
    }

    // A NextLog utiliza o modelo OFICIAL recebido (27 colunas, A:AA).
    // A Trilhos continua com o modelo ATT_IMPORT.xlsx, sem mudanças.
    let shopInfo: NextlogShop | null = null;
    if (carrier === "nextlog") {
      const shopResponse = await admin.graphql(`
        #graphql
        query SellForgeNextlogSender {
          shop {
            name
            email
            shopAddress {
              company
              address1
              address2
              zip
              city
              countryCodeV2
              phone
            }
          }
        }
      `);
      const shopJson = (await shopResponse.json()) as {
        data?: { shop?: NextlogShop | null };
        errors?: Array<{ message?: string }>;
      };
      if (shopJson.errors?.length || !shopJson.data?.shop) {
        return Response.json(
          { error: "NextLog: não foi possível obter os dados da loja na Shopify." },
          { status: 502 },
        );
      }
      shopInfo = shopJson.data.shop;

      // O remetente é a loja Shopify, não campos manuais no Admin SellForge.
      // Se faltarem dados essenciais, bloquear em vez de produzir um Excel trocado.
      const origin = shopInfo.shopAddress;
      const missingOrigin = [
        ["nome da loja", origin?.company || shopInfo.name],
        ["morada da loja", origin?.address1],
        ["código postal da loja", origin?.zip],
        ["localidade da loja", origin?.city],
        ["país da loja", origin?.countryCodeV2],
      ].filter(([, value]) => !clean(value));
      if (missingOrigin.length) {
        return Response.json(
          { error: `NextLog: faltam ${missingOrigin.map(([field]) => field).join(", ")} nos dados da loja Shopify. Atualiza as informações da loja e tenta novamente.` },
          { status: 422 },
        );
      }
    }

    const workbook = new ExcelJS.Workbook();
    const modelPath = carrier === "nextlog"
      ? path.join(process.cwd(), "public", "modelo_importacao_envios.xlsx")
      : path.join(process.cwd(), "public", "ATT_IMPORT.xlsx");
    await workbook.xlsx.readFile(modelPath);
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      return Response.json(
        { error: "O modelo Excel não contém nenhuma folha." },
        { status: 500 },
      );
    }

    if (carrier === "nextlog") {
      // Proteção contra um template trocado ou atualizado com outra ordem.
      const sameHeaders = NEXTLOG_HEADERS.every(
        (header, index) => clean(worksheet.getRow(1).getCell(index + 1).value) === header,
      );
      if (!sameHeaders || worksheet.getRow(1).cellCount !== NEXTLOG_HEADERS.length) {
        return Response.json(
          { error: "NextLog: o modelo Excel não corresponde às 27 colunas oficiais. Verifica public/modelo_importacao_envios.xlsx." },
          { status: 500 },
        );
      }

      const exportDate = new Date().toISOString().slice(0, 10);
      for (const [index, order] of (orders as NextlogOrder[]).entries()) {
        const addr = order.shippingAddress;
        const absent = [
          ["nome", recipientName(order)],
          ["morada", addr?.address1],
          ["código postal", addr?.zip],
          ["localidade", addr?.city],
          ["telefone", addr?.phone || order.phone],
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

        const values = buildNextlogRow(order, license, shopInfo!, exportDate);
        const row = worksheet.getRow(index + 2);
        // Escreve cada célula explicitamente (sem deslocar a primeira coluna).
        values.forEach((value, cellIndex) => {
          row.getCell(cellIndex + 1).value = value;
        });
        [4, 5, 8, 10, 11, 15, 17, 18, 19, 27].forEach((col) => {
          row.getCell(col).numFmt = "@";
        });
        row.getCell(22).numFmt = "0.00";
        row.getCell(24).numFmt = "0.00";
      }
    } else {
    orders.forEach((order: any, index: number) => {
      const row = worksheet.getRow(index + 2);
      const address = order.shippingAddress ?? {};

      const country = String(
        address.countryCodeV2 || "",
      ).toUpperCase();

      const customerName =
        address.name ||
        [address.firstName, address.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        "Sem nome";

      const fullAddress = [
        address.address1,
        address.address2,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      let phone = String(
        address.phone ||
          order.phone ||
          "",
      )
        .replace(/\s+/g, "")
        .trim();

      if (
        phone &&
        country === "ES" &&
        !phone.startsWith("+34")
      ) {
        phone = `+34${phone}`;
      }

      if (
        phone &&
        country === "PT" &&
        !phone.startsWith("+351")
      ) {
        phone = `+351${phone}`;
      }

      const totalRaw =
        order.currentTotalPriceSet?.shopMoney?.amount;

      const total = Number(totalRaw);

      if (
        totalRaw === null ||
        totalRaw === undefined ||
        totalRaw === "" ||
        !Number.isFinite(total) ||
        total < 0
      ) {
        throw new Error(
          `Total atual inválido na encomenda ${order.name}.`,
        );
      }

      row.getCell(1).value = order.name;
      row.getCell(2).value = total;
      row.getCell(3).value = customerName;
      row.getCell(4).value = fullAddress;

      const postalCode = String(address.zip || "")
        .replace(/^'+/, "")
        .trim();

      row.getCell(5).value = postalCode;
      row.getCell(5).numFmt = "@";
      row.getCell(6).value = address.city || "";
      row.getCell(7).value = phone;
      row.getCell(8).value = country || "ES";
      row.getCell(9).value = 0;
      row.getCell(10).value = 1;
      row.getCell(11).value = 1;
      row.getCell(12).value = order.email || "";
      row.getCell(13).value = "";
      row.getCell(14).value = customerName;
      // Códigos Trilhos configuráveis por loja (padrão GOLD / 24ES).
      row.getCell(15).value = country === "PT"
        ? license.trilhosPtService
        : license.trilhosEsService;
    });
    }

    const firstDataRow = worksheet.getRow(2);

    if (!firstDataRow.getCell(carrier === "nextlog" ? 5 : 1).value) {
      return Response.json(
        {
          error:
            "O Excel não foi preenchido corretamente.",
        },
        { status: 500 },
      );
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          carrier === "nextlog"
            ? 'attachment; filename="SELLFORGE_NEXTLOG.xlsx"'
            : 'attachment; filename="SELLFORGE_EXPORT.xlsx"',
        "Cache-Control":
          "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error(
      "Erro crítico no export SellForge:",
      error,
    );

    return Response.json(
      {
        error:
          "Não foi possível gerar o ficheiro Excel.",
      },
      { status: 500 },
    );
  }
}
