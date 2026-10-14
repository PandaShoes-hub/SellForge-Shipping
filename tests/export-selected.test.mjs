/* eslint-env node */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { asModule } from "./helpers/module.mjs";

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

const nextlogSource = await readFile(path.join(root, "app/utils/nextlog-excel.server.ts"), "utf8");
const actionSource = await readFile(path.join(root, "app/routes/api.export-selected.tsx"), "utf8");
const nextlogActionSource = await readFile(path.join(root, "app/routes/api.export-nextlog.tsx"), "utf8");
const batchingSource = await readFile(path.join(root, "app/utils/shopify-orders.server.ts"), "utf8");
const imports = new Map([
  ["exceljs", import.meta.resolve("exceljs")],
  ["../utils/nextlog-excel.server", asModule(nextlogSource)],
  ["../utils/shopify-orders.server", asModule(batchingSource, new Map(), "shopify-orders.server.ts")],
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
  const batches = [];
  const byId = new Map(orders.map((item) => [item.id, item]));
  state.admin = {
    graphql: async (query, { variables }) => {
      queries.push(query);
      batches.push(variables.ids);
      if (options.failBatch === queries.length) {
        return Response.json({ errors: [{ message: "Batch failure", extensions: { code: "INTERNAL_SERVER_ERROR" } }] });
      }
      return Response.json({ data: { nodes: variables.ids.map((id) => byId.get(id) ?? null) } });
    },
  };
  const exporter = options.exporter ?? (carrier === "nextlog" ? nextlogAction : action);
  const endpoint = carrier === "nextlog" ? "/api/export-nextlog" : "/api/export-selected";
  const response = await exporter({ request: new Request(`https://app.example.test${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ carrier, orderIds: options.orderIds ?? orders.map((item) => item.id) }),
  }) });
  return { response, queries, batches };
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

test("NextLog writes the confirmed MODELO CTT input contract A:N", async () => {
  const orders = [order("ES"), order("PT")];
  const { response } = await exportOrders("nextlog", orders);
  assert.match(response.headers.get("Content-Disposition"), /SELLFORGE_NEXTLOG_CTT.xlsx/);
  const sheet = await worksheet(response);
  assert.equal(sheet.name, "Listagem");
  assert.equal(sheet.columnCount, 14);
  assert.equal(sheet.rowCount, 3);
  assert.deepEqual(cells(sheet, 1), [
    "REF", "COBRANÇA", "NOME", "MORADA", "CP", "LOCALIDADE", "CONTACTO",
    "EMAIL", "PAIS", "BACK", "VOLUMES", "PESO", "OBS", "SERVIÇO",
  ]);
  assert.deepEqual(cells(sheet, 2), [
    "#TEST-ES", 54.99, "Cliente de Teste", "Rua de Teste 18 Piso 0 Porta 18",
    "08001", "Barcelona", "+34600000000", "recipient@example.test", "ES",
    0, 1, 1, "", "CTT24H",
  ]);
  assert.equal(sheet.getCell("N3").value, "CTT48H");
  assert.equal(sheet.getCell("A3").value, "#TEST-PT");
  assert.equal(sheet.getCell("E2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("E2").numFmt, "@");
  assert.equal(sheet.getCell("K2").type, ExcelJS.ValueType.Number);
  assert.equal(sheet.getCell("L2").type, ExcelJS.ValueType.Number);
  assert.equal(sheet.getCell("B2").type, ExcelJS.ValueType.Number);
});

test("NextLog always exports one volume and one kilogram regardless of Shopify or saved defaults", async () => {
  const { response } = await exportOrders("nextlog", [
    order("ES", { currentTotalWeight: 1250 }),
    order("PT", { currentTotalWeight: 90000 }),
  ], {
    settings: { nextlogDefaultWeight: 2.5, nextlogDefaultVolumes: 8 },
  });
  const sheet = await worksheet(response);
  for (const row of [2, 3]) {
    assert.equal(sheet.getCell(`K${row}`).value, 1);
    assert.equal(sheet.getCell(`L${row}`).value, 1);
  }
});

test("NextLog keeps one volume and one kilogram for missing or invalid old weights and settings", async () => {
  const orders = [0, null, undefined, "invalid", -1].map((weight, index) => order("ES", {
    id: `gid://shopify/Order/${index + 10}`, currentTotalWeight: weight,
  }));
  const { response } = await exportOrders("nextlog", orders, {
    settings: { nextlogDefaultWeight: 0, nextlogDefaultVolumes: 0 },
  });
  const sheet = await worksheet(response);
  for (let row = 2; row <= 6; row++) {
    assert.equal(sheet.getCell(`K${row}`).value, 1);
    assert.equal(sheet.getCell(`L${row}`).value, 1);
  }
});

test("NextLog does not query Shopify weight or sender and cannot place the sender in the service column", async () => {
  const { response, queries } = await exportOrders("nextlog", [order("ES")], { settings: {
    nextlogSenderName: "PANDA SHOES", nextlogSenderAddress: "Rua do Armazém 1",
    nextlogSenderPostalCode: "4000-001", nextlogSenderCity: "Porto",
    nextlogSenderCountry: "PT", nextlogSenderPhone: "900000001",
    nextlogSenderNif: "000000000",
  } });
  const sheet = await worksheet(response);
  assert.equal(queries.length, 1);
  assert.ok(!queries[0].includes("currentTotalWeight"));
  assert.ok(!queries[0].includes("billingAddress"));
  assert.ok(!queries[0].includes("SellForgeNextlogSender"));
  assert.equal(sheet.getCell("N2").value, "CTT24H");
  assert.equal(sheet.getCell("C2").value, "Cliente de Teste");
  assert.ok(!cells(sheet, 2).includes("PANDA SHOES"));
});

test("NextLog keeps recipient name, postal code, email and phone fallback in their portal positions", async () => {
  const recipient = order("ES");
  recipient.shippingAddress = {
    ...recipient.shippingAddress, name: " ", firstName: "Ana", lastName: "Lopez",
    zip: "'08001", phone: " ",
  };
  recipient.phone = "0034600000000";
  const { response } = await exportOrders("nextlog", [recipient]);
  const sheet = await worksheet(response);
  assert.equal(sheet.getCell("C2").value, "Ana Lopez");
  assert.equal(sheet.getCell("E2").value, "08001");
  assert.equal(sheet.getCell("G2").value, "+34600000000");
  assert.equal(sheet.getCell("H2").value, "recipient@example.test");
  assert.equal(sheet.getCell("I2").value, "ES");
});

test("NextLog rejects an empty saved service instead of using a Trilhos service", async () => {
  const { response } = await exportOrders("nextlog", [order("ES")], {
    settings: { nextlogEsService: " ", trilhosEsService: "TRILHOS_ES_TEST" },
  });
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /falta configurar o serviço de Espanha/);
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
  assert.equal(sheet.getCell("N2").value, "NEXTLOG_ES_TEST");
  assert.equal(sheet.getCell("N3").value, "NEXTLOG_PT_TEST");
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
  assert.equal(sheet.columnCount, 14);
});

for (const carrier of ["trilhos", "nextlog"]) {
  test(`${carrier} exports 1001 selected orders in one complete Excel using bounded Shopify calls`, async () => {
    const orders = Array.from({ length: 1001 }, (_, index) => order(index % 2 ? "PT" : "ES", {
      id: `gid://shopify/Order/${10000 + index}`, name: `#BULK-${index}`,
    }));
    const { response, batches } = await exportOrders(carrier, orders);
    const sheet = await worksheet(response);
    assert.equal(sheet.rowCount, 1002);
    assert.equal(sheet.columnCount, carrier === "trilhos" ? 15 : 14);
    assert.deepEqual(batches.flat(), orders.map((item) => item.id));
    assert.ok(batches.every((batch) => batch.length > 0 && batch.length <= 100));
    const references = orders.map((_, index) => sheet.getCell(`A${index + 2}`).value);
    assert.deepEqual(references, orders.map((item) => item.name));
    assert.equal(new Set(references).size, 1001);
    for (const row of [2, 101, 102, 252, 1002]) {
      assert.equal(sheet.getCell(`${carrier === "trilhos" ? "J" : "K"}${row}`).value, 1);
      assert.equal(sheet.getCell(`${carrier === "trilhos" ? "K" : "L"}${row}`).value, 1);
    }
  });

  test(`${carrier} refuses a partial Excel when a later Shopify batch fails`, async (context) => {
    context.mock.method(console, "error", () => {});
    const orders = Array.from({ length: 251 }, (_, index) => order("ES", {
      id: `gid://shopify/Order/${20000 + index}`, name: `#FAIL-${index}`,
    }));
    const { response, batches } = await exportOrders(carrier, orders, { failBatch: 2 });
    assert.equal(response.status, 502);
    assert.equal(batches.length, 2);
    assert.match(response.headers.get("Content-Type"), /json/);
    assert.equal(response.headers.get("Content-Disposition"), null);
  });

  test(`${carrier} exports a repeated selected ID once`, async () => {
    const selected = order("ES");
    const { response, batches } = await exportOrders(carrier, [selected], { orderIds: [selected.id, selected.id] });
    const sheet = await worksheet(response);
    assert.equal(sheet.rowCount, 2);
    assert.deepEqual(batches, [[selected.id]]);
  });

  test(`${carrier} refuses the download if an order disappears in the final batch`, async () => {
    const orders = Array.from({ length: 251 }, (_, index) => order("ES", {
      id: `gid://shopify/Order/${40000 + index}`, name: `#REMOVED-${index}`,
    }));
    const orderIds = orders.map((item) => item.id);
    orderIds[250] = "gid://shopify/Order/999999999";
    const { response, batches } = await exportOrders(carrier, orders, { orderIds });
    assert.equal(response.status, 409);
    assert.equal(batches.length, 3);
    assert.equal(response.headers.get("Content-Disposition"), null);
  });
}
