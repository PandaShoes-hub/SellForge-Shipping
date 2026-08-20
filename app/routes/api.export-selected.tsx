import type { ActionFunctionArgs } from "react-router";
import ExcelJS from "exceljs";
import path from "node:path";

import { authenticate } from "../shopify.server";
import { isShopLicensed } from "../utils/license.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { admin, session } =
      await authenticate.admin(request);

    if (!isShopLicensed(session.shop)) {
      return Response.json(
        {
          error: "A licença desta loja está inativa.",
        },
        { status: 403 },
      );
    }

    const body = await request.json();

    const orderIds = Array.isArray(body?.orderIds)
      ? body.orderIds.filter(
          (id: unknown) =>
            typeof id === "string" && id.length > 0,
        )
      : [];

    console.log(
      "SellForge export - orderIds recebidos:",
      orderIds,
    );

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

            totalPriceSet {
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

    const json = await response.json();

    console.log(
      "SellForge export - resposta Shopify:",
      JSON.stringify(json),
    );

    if (json?.errors?.length) {
      console.error(
        "Erro GraphQL Shopify:",
        json.errors,
      );

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

    console.log(
      "SellForge export - encomendas encontradas:",
      orders.length,
    );

    /*
     * MUITO IMPORTANTE:
     * Nunca devolver o template vazio.
     */
    if (orders.length === 0) {
      return Response.json(
        {
          error:
            "Não foi possível carregar as encomendas selecionadas.",
        },
        { status: 404 },
      );
    }

    const templatePath = path.join(
      process.cwd(),
      "public",
      "ATT_IMPORT.xlsx",
    );

    const workbook =
      new ExcelJS.Workbook();

    await workbook.xlsx.readFile(
      templatePath,
    );

    const worksheet =
      workbook.worksheets[0];

    if (!worksheet) {
      return Response.json(
        {
          error:
            "O template Excel não contém nenhuma folha.",
        },
        { status: 500 },
      );
    }

    orders.forEach(
      (order: any, index: number) => {
        const row =
          worksheet.getRow(index + 2);

        const address =
          order.shippingAddress ?? {};

        const country =
          String(
            address.countryCodeV2 || "",
          ).toUpperCase();

        const customerName =
          address.name ||
          [
            address.firstName,
            address.lastName,
          ]
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

        const total = Number(
          order.totalPriceSet
            ?.shopMoney?.amount || 0,
        );

        /*
         * REF
         */
        row.getCell(1).value =
          order.name;

        /*
         * COBRANÇA
         */
        row.getCell(2).value =
          Number.isFinite(total)
            ? total
            : 0;

        /*
         * NOME
         */
        row.getCell(3).value =
          customerName;

        /*
         * MORADA
         */
        row.getCell(4).value =
          fullAddress;

        /*
         * CP
         *
         * Como texto para preservar
         * zeros à esquerda.
         */
        const postalCode = String(
          address.zip || "",
        )
          .replace(/^'+/, "")
          .trim();

        row.getCell(5).value =
          postalCode;

        row.getCell(5).numFmt = "@";

        /*
         * LOCALIDADE
         */
        row.getCell(6).value =
          address.city || "";

        /*
         * CONTACTO
         */
        row.getCell(7).value =
          phone;

        /*
         * PAÍS
         */
        row.getCell(8).value =
          country || "ES";

        /*
         * BACK
         */
        row.getCell(9).value = 0;

        /*
         * VOLUMES
         */
        row.getCell(10).value = 1;

        /*
         * PESO
         */
        row.getCell(11).value = 1;

        /*
         * EMAIL
         */
        row.getCell(12).value =
          order.email || "";

        /*
         * OBSERVAÇÕES
         */
        row.getCell(13).value = "";

        /*
         * DESTINATÁRIO
         */
        row.getCell(14).value =
          customerName;

        /*
         * SERVIÇO
         */
        row.getCell(15).value =
          country === "PT"
            ? "24PT"
            : "24ES";

        console.log(
          `Linha ${index + 2} preenchida:`,
          {
            order: order.name,
            customerName,
            fullAddress,
            postalCode,
            city: address.city,
            country,
            total,
          },
        );
      },
    );

    /*
     * Verificação extra antes de criar
     * o ficheiro.
     */
    const firstDataRow =
      worksheet.getRow(2);

    if (!firstDataRow.getCell(1).value) {
      console.error(
        "ERRO: linha 2 ficou vazia após exportação.",
      );

      return Response.json(
        {
          error:
            "O Excel não foi preenchido corretamente.",
        },
        { status: 500 },
      );
    }

    const buffer =
      await workbook.xlsx.writeBuffer();

    console.log(
      "SellForge export concluído:",
      orders.length,
      "encomendas -",
      buffer.byteLength,
      "bytes",
    );

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

        "Content-Disposition":
          'attachment; filename="SELLFORGE_SHIPPING.xlsx"',

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