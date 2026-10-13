import type { ActionFunctionArgs } from "react-router";
import ExcelJS from "exceljs";
import { NEXTLOG_HEADERS, buildNextlogRow, type NextlogOrder } from "../utils/nextlog-excel.server";
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

    // A folha NextLog é construída diretamente a partir das encomendas.
    // Se não existirem dados fiáveis do remetente, os respetivos campos
    // do Excel ficam vazios. Não bloquear a exportação por esse motivo.

    const workbook = new ExcelJS.Workbook();
    if (carrier === "nextlog") {
      // A NextLog tem 29 colunas diferentes da Trilhos.
      const nextlogSheet = workbook.addWorksheet("NextLog");
      nextlogSheet.addRow([...NEXTLOG_HEADERS]);
      nextlogSheet.getRow(1).font = { bold: true };
      nextlogSheet.getRow(1).alignment = { vertical: "middle" };
      nextlogSheet.columns = NEXTLOG_HEADERS.map((header) => ({
        header,
        width: Math.min(38, Math.max(16, header.length + 3)),
      }));
    } else {
      const templatePath = path.join(process.cwd(), "public", "ATT_IMPORT.xlsx");
      await workbook.xlsx.readFile(templatePath);
    }

    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      return Response.json(
        {
          error:
            "O template Excel não contém nenhuma folha.",
        },
        { status: 500 },
      );
    }

    if (carrier === "nextlog") {
      for (const order of orders as NextlogOrder[]) {
        const addr = order.shippingAddress;
        const absent = [
          ["nome", addr?.name || [addr?.firstName, addr?.lastName].filter(Boolean).join(" ")],
          ["morada", addr?.address1],
          ["código postal", addr?.zip],
          ["localidade", addr?.city],
          ["telefone", addr?.phone || order.phone],
        ].filter(([, value]) => !String(value || "").trim());
        if (absent.length) {
          return Response.json(
            { error: `NextLog: faltam ${absent.map(([field]) => field).join(", ")} na encomenda ${order.name}. Corrige na Shopify e tenta novamente.` },
            { status: 422 },
          );
        }
        const rawTotal = order.currentTotalPriceSet?.shopMoney?.amount;
        const amount = Number(rawTotal);
        if (rawTotal === undefined || rawTotal === null || rawTotal === "" || !Number.isFinite(amount) || amount < 0) {
          return Response.json(
            { error: `Total atual inválido na encomenda ${order.name}.` },
            { status: 422 },
          );
        }
        const row = worksheet.addRow(buildNextlogRow(order, {
          ...license,
          nextlogSenderName: license.nextlogSenderName || license.company || "",
        }));
        // Código postal, telefone, referências e NIF como texto (sem perder zeros).
        [7, 10, 13, 16, 19, 21, 28].forEach((col) => {
          row.getCell(col).numFmt = "@";
        });
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

    if (!firstDataRow.getCell(carrier === "nextlog" ? 4 : 1).value) {
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
