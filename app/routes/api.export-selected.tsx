import type { ActionFunctionArgs } from "react-router";
import ExcelJS from "exceljs";
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

    if (!license.trilhosEnabled) {
      return Response.json(
        {
          error:
            "Esta loja não tem autorização para utilizar a exportação Trilhos.",
        },
        { status: 403 },
      );
    }

    const body = await request.json();

    if (
      body?.carrier &&
      String(body.carrier).toLowerCase() !== "trilhos"
    ) {
      return Response.json(
        {
          error: "Transportadora não suportada nesta exportação.",
        },
        { status: 400 },
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

    const json = await response.json();

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

    const templatePath = path.join(
      process.cwd(),
      "public",
      "ATT_IMPORT.xlsx",
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);

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
      row.getCell(15).value =
        country === "PT" ? "24PT" : "24ES";
    });

    const firstDataRow = worksheet.getRow(2);

    if (!firstDataRow.getCell(1).value) {
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
          'attachment; filename="SELLFORGE_EXPORT.xlsx"',
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