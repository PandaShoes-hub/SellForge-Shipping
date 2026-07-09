import type { ActionFunctionArgs } from "react-router";
import ExcelJS from "exceljs";
import path from "path";
import { authenticate } from "../shopify.server";

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const { orderIds } = await request.json();

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
            }
          }
          shippingAddress {
            name
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
    {
      variables: { ids: orderIds },
    }
  );

  const json = await response.json();
  const orders = json.data.nodes.filter(Boolean);

  const templatePath = path.join(process.cwd(), "public", "ATT_IMPORT.xlsx");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const worksheet = workbook.worksheets[0];

  orders.forEach((order: any, index: number) => {
    const row = worksheet.getRow(index + 2);

    const address = order.shippingAddress || {};

    let telefone = address.phone || order.phone || "";

    telefone = telefone.replace(/\s+/g, "");

    if (
      telefone &&
      address.countryCodeV2 === "ES" &&
      !telefone.startsWith("+34")
    ) {
      telefone = "+34" + telefone;
    }

    row.getCell(1).value = order.name;
    row.getCell(2).value = order.totalPriceSet.shopMoney.amount;
    row.getCell(3).value = address.name || "";
    row.getCell(4).value =
      `${address.address1 || ""} ${address.address2 || ""}`.trim();
    row.getCell(5).value = address.zip || "";
    row.getCell(6).value = address.city || "";
    row.getCell(7).value = telefone;
    row.getCell(8).value = "ES";
    row.getCell(9).value = 0;
    row.getCell(10).value = 1;
    row.getCell(11).value = 1;
    row.getCell(12).value = order.email || "";

    // OBSERVAÇÕES (sempre vazio)
    row.getCell(13).value = "";

    row.getCell(14).value = address.name || "";
    row.getCell(15).value = "24ES";

    row.commit();
  });

  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="ATT_IMPORT_TRILHOS.xlsx"',
    },
  });
}