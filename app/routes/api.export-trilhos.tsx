import type { ActionFunctionArgs } from "react-router";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs/promises";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function options() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const data = await request.json();

  const templatePath = path.join(process.cwd(), "public", "ATT_IMPORT.xlsx");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const worksheet = workbook.worksheets[0];
  const row = worksheet.getRow(2);

  row.getCell(1).value = data.ref;
  row.getCell(2).value = data.cobranca;
  row.getCell(3).value = data.nome;
  row.getCell(4).value = data.morada;
  row.getCell(5).value = data.cp;
  row.getCell(6).value = data.localidade;
  row.getCell(7).value = data.contacto;
  row.getCell(8).value = data.pais;
  row.getCell(9).value = 0;
  row.getCell(10).value = 1;
  row.getCell(11).value = 1;
  row.getCell(12).value = data.email;
  row.getCell(13).value = data.obs || "";
  row.getCell(14).value = data.nome;
  row.getCell(15).value = "24ES";

  row.commit();

  const buffer = await workbook.xlsx.writeBuffer();

  const exportsDir = path.join(process.cwd(), "public", "exports");
  await fs.mkdir(exportsDir, { recursive: true });

  const cleanRef = String(data.ref).replace(/[^a-zA-Z0-9_-]/g, "");
  const filename = `ATT_IMPORT_${cleanRef}.xlsx`;
  const filePath = path.join(exportsDir, filename);

  await fs.writeFile(filePath, Buffer.from(buffer));

  return new Response(
    JSON.stringify({
      success: true,
      downloadUrl: `https://trilhos-model-export.onrender.com/exports/${filename}`,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    }
  );
}