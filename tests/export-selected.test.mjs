/* eslint-env node */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import ExcelJS from "exceljs";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "sellforge-export-tests-"));
after(() => rm(temporary, { recursive: true, force: true }));

// Execute the real export action. Only Shopify authentication, its read-only
// responses and the licence lookup are replaced; no store or database is used.
const mocksPath = path.join(temporary, "mocks.mjs");
await writeFile(mocksPath, `
  export const state = { admin: null, license: null };
  export const authenticate = {
    admin: async () => ({
      admin: state.admin,
      session: { shop: "export-tests.myshopify.com" },
    }),
  };
  export const getLicenseStatus = async () => state.license;
`);
const mocksUrl = pathToFileURL(mocksPath).href;
const { state } = await import(mocksUrl);

function asModule(source, imports = new Map()) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    transformers: {
      before: [(context) => {
        const visit = (node) => {
          if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const replacement = imports.get(node.moduleSpecifier.text);
            if (replacement) {
              return context.factory.updateImportDeclaration(
                node, node.modifiers, node.importClause,
                context.factory.createStringLiteral(replacement), node.attributes,
              );
            }
          }
          return ts.visitEachChild(node, visit, context);
        };
        return (sourceFile) => ts.visitNode(sourceFile, visit);
      }],
    },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}

const nextlogSource = await readFile(path.join(root, "app/utils/nextlog-excel.server.ts"), "utf8");
const actionSource = await readFile(path.join(root, "app/routes/api.export-selected.tsx"), "utf8");
const nextlogActionSource = await readFile(path.join(root, "app/routes/api.export-nextlog.tsx"), "utf8");
const imports = new Map([
  ["exceljs", import.meta.resolve("exceljs")],
  ["../utils/nextlog-excel.server", asModule(nextlogSource)],
  ["../shopify.server", mocksUrl],
  ["../utils/license.server", mocksUrl],
]);
const { action } = await import(asModule(actionSource, imports));
const { action: nextlogAction } = await import(asModule(nextlogActionSource, imports));

const services = {
  allowed: true,
  trilhosEnabled: true,
  trilhosPtService: "GOLD",
  trilhosEsService: "24ES",
  nextlogEnabled: true,
  nextlogPtService: "CTT48H",
  nextlogEsService: "CTT24H",
  nextlogDefaultVolumes: 1,
  nextlogDefaultWeight: 1,
};
const shop = {
  name: "PANDA SHOES",
  email: "sender@example.test",
  shopAddress: {
    company: "PANDA SHOES",
    address1: "Rua de Teste 10",
    address2: "Loja 2",
    zip: "4780-564",
    city: "Santo Tirso",
    countryCodeV2: "PT",
    phone: "+351900000000",
  },
};

function order(country = "ES", overrides = {}) {
  return {
    id: `gid://shopify/Order/${country === "PT" ? 2 : 1}`,
    name: country === "PT" ? "#TEST-PT" : "#TEST-ES",
    email: "recipient@example.test",
    currentTotalWeight: 1250,
    currentTotalPriceSet: { shopMoney: { amount: "54.99", currencyCode: "EUR" } },
    shippingAddress: {
      name: "Cliente de Teste",
      address1: "Rua de Teste 18",
      address2: "Piso 0 Porta 18",
      zip: country === "PT" ? "1000-001" : "08001",
      city: country === "PT" ? "Lisboa" : "Barcelona",
      phone: country === "PT" ? "900000000" : "600000000",
      countryCodeV2: country,
    },
    ...overrides,
  };
}

async function exportOrders(carrier, orders, options = {}) {
  state.license = { ...services, ...options.settings };
  const queries = [];
  state.admin = {
    graphql: async (query) => {
      queries.push(query);
      return Response.json({ data: query.includes("SellForgeNextlogSender")
        ? { shop: options.shop ?? shop }
        : { nodes: orders } });
    },
  };
  const exporter = options.exporter ?? (carrier === "nextlog" ? nextlogAction : action);
  const endpoint = carrier === "nextlog" ? "/api/export-nextlog" : "/api/export-selected";
  const response = await exporter({ request: new Request(`https://app.example.test${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ carrier, orderIds: orders.map((item) => item.id) }),
  }) });
  return { response, queries };
}

async function worksheet(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /spreadsheetml/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(workbook.worksheets.length, 1);
  return workbook.worksheets[0];
}

function cells(sheet, row) {
  return Array.from({ length: sheet.columnCount }, (_, index) => sheet.getRow(row).getCell(index + 1).value ?? "");
}

test("NextLog writes the CTT contract A:AC, with sender name separate from service", async () => {
  const orders = [order("ES"), order("PT")];
  const { response } = await exportOrders("nextlog", orders);
  assert.match(response.headers.get("Content-Disposition"), /SELLFORGE_NEXTLOG_CTT29.xlsx/);
  const sheet = await worksheet(response);
  assert.equal(sheet.name, "Listagem");
  assert.equal(sheet.columnCount, 29);
  assert.equal(sheet.rowCount, 3);
  assert.deepEqual(cells(sheet, 1), [
    "Data", "Hora Início", "Hora Fim", "Código de Serviço", "Nome Destinatário",
    "Morada Destinatário", "Cód. Postal Destinatário", "Localidade Destinatário",
    "País Destinatário", "Telefone Destinatário", "E-mail Destinatário",
    "Pessoa de Contacto", "NIF Destinatário", "Nome Remetente", "Morada Remetente",
    "Cód. Postal Remetente", "Localidade Remetente", "País Remetente",
    "Telefone Remetente", "Pessoa Contacto Remetente", "NIF Remetente", "Volumes",
    "Peso Real", "Km", "Valor Reembolso", "Retorno de Encomenda",
    "Retorno Guia Assinada", "Referência", "Observações",
  ]);
  const date = sheet.getCell("A2").value;
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(cells(sheet, 2), [
    date, "", "", "CTT24H", "Cliente de Teste", "Rua de Teste 18 Piso 0 Porta 18",
    "08001", "Barcelona", "ES", "+34600000000", "recipient@example.test",
    "Cliente de Teste", "", "PANDA SHOES", "Rua de Teste 10 Loja 2", "4780-564",
    "Santo Tirso", "PT", "+351900000000", "PANDA SHOES", "", 1, 1.25, "",
    54.99, 0, 0, "#TEST-ES", "",
  ]);
  assert.equal(sheet.getCell("D3").value, "CTT48H");
  assert.equal(sheet.getCell("AB3").value, "#TEST-PT");
  assert.equal(sheet.getCell("G2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("G2").numFmt, "@");
  assert.equal(sheet.getCell("W2").type, ExcelJS.ValueType.Number);
  assert.equal(sheet.getCell("Y2").type, ExcelJS.ValueType.Number);
});

test("NextLog uses the saved default weight and volumes when Shopify has no weight", async () => {
  const { response } = await exportOrders("nextlog", [order("ES", { currentTotalWeight: 0 })], {
    settings: { nextlogDefaultWeight: 2.5, nextlogDefaultVolumes: 2 },
  });
  const sheet = await worksheet(response);
  assert.equal(sheet.getCell("V2").value, 2);
  assert.equal(sheet.getCell("W2").value, 2.5);
});

test("NextLog keeps a positive fallback for missing or invalid weights and settings", async () => {
  const orders = [0, null, "invalid", -1].map((weight, index) => order("ES", {
    id: `gid://shopify/Order/${index + 10}`, currentTotalWeight: weight,
  }));
  const { response } = await exportOrders("nextlog", orders, {
    settings: { nextlogDefaultWeight: 0, nextlogDefaultVolumes: 0 },
  });
  const sheet = await worksheet(response);
  for (let row = 2; row <= 5; row++) {
    assert.equal(sheet.getCell(`V${row}`).value, 1);
    assert.equal(sheet.getCell(`W${row}`).value, 1);
  }
});

test("NextLog retains Shopify weight in kilograms even when a default is configured", async () => {
  const { response } = await exportOrders("nextlog", [order("ES")], {
    settings: { nextlogDefaultWeight: 3 },
  });
  const sheet = await worksheet(response);
  assert.equal(sheet.getCell("W2").value, 1.25);
});

test("NextLog uses a complete saved sender without mixing it with Shopify", async () => {
  const { response } = await exportOrders("nextlog", [order("ES")], { settings: {
    nextlogSenderName: "Remetente de Teste", nextlogSenderAddress: "Rua do Armazém 1",
    nextlogSenderPostalCode: "4000-001", nextlogSenderCity: "Porto",
    nextlogSenderCountry: "PT", nextlogSenderPhone: "900000001",
    nextlogSenderNif: "000000000",
  } });
  const sheet = await worksheet(response);
  assert.deepEqual(cells(sheet, 2).slice(13, 21), [
    "Remetente de Teste", "Rua do Armazém 1", "4000-001", "Porto", "PT",
    "+351900000001", "Remetente de Teste", "000000000",
  ]);
});

test("NextLog rejects missing mandatory recipient fields before downloading", async () => {
  const incomplete = order("ES");
  incomplete.shippingAddress = { ...incomplete.shippingAddress, name: "", address1: "", zip: "" };
  const { response } = await exportOrders("nextlog", [incomplete]);
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /faltam nome, morada, código postal/);
});

test("NextLog rejects unsupported destinations and invalid reimbursement amounts", async () => {
  const unsupported = await exportOrders("nextlog", [order("FR")]);
  assert.equal(unsupported.response.status, 422);
  const invalid = await exportOrders("nextlog", [order("ES", {
    currentTotalPriceSet: { shopMoney: { amount: "invalid" } },
  })]);
  assert.equal(invalid.response.status, 422);
});

test("Trilhos retains its original 15-column template and exported data", async () => {
  const { response, queries } = await exportOrders("trilhos", [order("ES"), order("PT")]);
  assert.match(response.headers.get("Content-Disposition"), /SELLFORGE_EXPORT.xlsx/);
  const sheet = await worksheet(response);
  assert.equal(queries.length, 1);
  assert.ok(!queries[0].includes("currentTotalWeight"));
  assert.ok(!queries[0].includes("SellForgeNextlogSender"));
  assert.equal(sheet.name, "Folha1");
  assert.equal(sheet.columnCount, 15);
  assert.deepEqual(cells(sheet, 1), [
    "REF", "COBRANÇA", "NOME", "MORADA", "CP", "LOCALIDADE", "CONTACTO", "PAIS",
    "BACK", "VOLUMES", "PESO", "EMAIL", "OBS", "CLIENTE", "SERVIÇO",
  ]);
  assert.deepEqual(cells(sheet, 2), [
    "#TEST-ES", 54.99, "Cliente de Teste", "Rua de Teste 18 Piso 0 Porta 18", "08001",
    "Barcelona", "+34600000000", "ES", 0, 1, 1, "recipient@example.test", "",
    "Cliente de Teste", "24ES",
  ]);
  assert.equal(sheet.getCell("O3").value, "GOLD");
  assert.equal(sheet.getCell("G3").value, "+351900000000");
});

test("The default carrier remains Trilhos", async () => {
  const { response } = await exportOrders(undefined, [order("ES")]);
  const sheet = await worksheet(response);
  assert.equal(sheet.columnCount, 15);
  assert.equal(sheet.getCell("O2").value, "24ES");
});

test("Trilhos uses its own Portugal and Spain services saved in the Admin", async () => {
  const { response } = await exportOrders("trilhos", [order("ES"), order("PT")], { settings: {
    trilhosPtService: "TRILHOS_PT_TEST", trilhosEsService: "TRILHOS_ES_TEST",
    nextlogPtService: "NEXTLOG_PT_TEST", nextlogEsService: "NEXTLOG_ES_TEST",
  } });
  const sheet = await worksheet(response);
  assert.equal(sheet.getCell("O2").value, "TRILHOS_ES_TEST");
  assert.equal(sheet.getCell("O3").value, "TRILHOS_PT_TEST");
});

test("NextLog uses only its own services, independently of Trilhos settings", async () => {
  const { response } = await exportOrders("nextlog", [order("ES"), order("PT")], { settings: {
    trilhosPtService: "TRILHOS_PT_TEST", trilhosEsService: "TRILHOS_ES_TEST",
    nextlogPtService: "NEXTLOG_PT_TEST", nextlogEsService: "NEXTLOG_ES_TEST",
  } });
  const sheet = await worksheet(response);
  assert.equal(sheet.getCell("D2").value, "NEXTLOG_ES_TEST");
  assert.equal(sheet.getCell("D3").value, "NEXTLOG_PT_TEST");
});

test("The Trilhos template is byte-identical to its version before NextLog existed", async () => {
  const template = await readFile(path.join(root, "public/ATT_IMPORT.xlsx"));
  // SHA-256 of ATT_IMPORT.xlsx in the last Trilhos-only release (d70da8d).
  assert.equal(createHash("sha256").update(template).digest("hex"),
    "83937c90f41e451109c51d1eb7923c3c9b74baa20da133cd0ae83cd593f8384a");
});

test("The Trilhos endpoint rejects requests for NextLog", async () => {
  const { response, queries } = await exportOrders("nextlog", [order("ES")], { exporter: action });
  assert.equal(response.status, 400);
  assert.equal(queries.length, 0);
});

test("The NextLog endpoint rejects requests for Trilhos", async () => {
  const { response, queries } = await exportOrders("trilhos", [order("ES")], { exporter: nextlogAction });
  assert.equal(response.status, 400);
  assert.equal(queries.length, 0);
});

test("Trilhos still exports when NextLog is disabled", async () => {
  const { response } = await exportOrders("trilhos", [order("ES")], { settings: { nextlogEnabled: false } });
  const sheet = await worksheet(response);
  assert.equal(sheet.columnCount, 15);
});

test("NextLog still exports when Trilhos is disabled", async () => {
  const { response } = await exportOrders("nextlog", [order("ES")], { settings: { trilhosEnabled: false } });
  const sheet = await worksheet(response);
  assert.equal(sheet.columnCount, 29);
});
