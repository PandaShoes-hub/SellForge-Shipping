/**
 * Modelo de importação NextLog fornecido pelo cliente (folha "Listagem", A:AA).
 * Os nomes e a ORDEM das 27 colunas são importantes para o importador.
 * Não reutilizar o modelo Trilhos nesta transportadora.
 */
export const NEXTLOG_HEADERS = [
  "Data",
  "Hora Início",
  "Hora Fim",
  "Referência",
  "Cod. Serviço",
  "Remetente",
  "Morada Remetente",
  "Cod Post Remetente",
  "Localidade Remetente",
  "Pais Remetente",
  "Contacto Remetente",
  "Pessoa Contacto Remetente",
  "Destinatário",
  "Morada Destinatário",
  "Cod Post Destinatário",
  "Localidade Destinatário",
  "Pais Destinatário",
  "Contacto Destinatário",
  "Email destinatario",
  "Pessoa Contacto Destino",
  "Volumes/Qtd",
  "Peso (Kg)",
  "Kms",
  "Cobrança",
  "Retorno (1/0)",
  "Observações",
  "Solicitado Por",
] as const;

export type NextlogOrder = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  currentTotalWeight?: string | number | null; // Shopify: gramas
  currentTotalPriceSet?: {
    shopMoney?: { amount?: string | number | null; currencyCode?: string | null } | null;
  } | null;
  shippingAddress?: {
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    address1?: string | null;
    address2?: string | null;
    zip?: string | null;
    city?: string | null;
    phone?: string | null;
    countryCodeV2?: string | null;
  } | null;
};

export type NextlogShop = {
  name?: string | null;
  email?: string | null;
  shopAddress?: {
    company?: string | null;
    address1?: string | null;
    address2?: string | null;
    zip?: string | null;
    city?: string | null;
    phone?: string | null;
    countryCodeV2?: string | null;
  } | null;
};

export type NextlogServices = {
  nextlogPtService: string;
  nextlogEsService: string;
};

export function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function fullAddress(address?: { address1?: string | null; address2?: string | null } | null): string {
  return [address?.address1, address?.address2].map(clean).filter(Boolean).join(" ");
}

export function recipientName(order: NextlogOrder): string {
  const addr = order.shippingAddress;
  return clean(addr?.name) || [addr?.firstName, addr?.lastName].map(clean).filter(Boolean).join(" ");
}

export function normalizePhone(raw: string, country: string): string {
  const phone = clean(raw).replace(/[\s().-]/g, "");
  if (!phone) return "";
  if (phone.startsWith("+")) return phone;
  if (phone.startsWith("00")) return `+${phone.slice(2)}`;
  const prefix = country === "PT" ? "351" : country === "ES" ? "34" : "";
  if (!prefix) return phone;
  const nationalLength = country === "PT" ? 9 : 9;
  if (phone.startsWith(prefix) && phone.length === prefix.length + nationalLength) {
    return `+${phone}`;
  }
  return `+${prefix}${phone}`;
}

/** Produz exatamente 27 valores na ordem original A:AA. */
export function buildNextlogRow(
  order: NextlogOrder,
  services: NextlogServices,
  shop: NextlogShop,
  exportDate: string,
): (string | number)[] {
  const destination = order.shippingAddress ?? {};
  const origin = shop.shopAddress ?? {};
  const destCountry = clean(destination.countryCodeV2).toUpperCase();
  const sourceCountry = clean(origin.countryCodeV2).toUpperCase();
  const sender = clean(origin.company) || clean(shop.name);
  const recipient = recipientName(order);
  const rawGrams = Number(order.currentTotalWeight ?? 0);
  // Se a Shopify não tiver peso, usar mínimo operacional 1 kg.
  // Confirmar peso real antes de produzir a guia da transportadora.
  const weightKg = Number.isFinite(rawGrams) && rawGrams > 0
    ? Math.max(0.01, Math.round(rawGrams / 10) / 100)
    : 1;
  const price = Number(order.currentTotalPriceSet?.shopMoney?.amount);

  const row: (string | number)[] = [
    exportDate, // A Data
    "", // B Hora Início
    "", // C Hora Fim
    clean(order.name), // D Referência
    destCountry === "PT" ? services.nextlogPtService : services.nextlogEsService, // E Cod. Serviço
    sender, // F Remetente
    fullAddress(origin), // G Morada Remetente
    clean(origin.zip), // H Cod Post Remetente
    clean(origin.city), // I Localidade Remetente
    sourceCountry, // J Pais Remetente
    normalizePhone(clean(origin.phone), sourceCountry), // K Contacto Remetente
    sender, // L Pessoa Contacto Remetente (nome comercial disponível)
    recipient, // M Destinatário
    fullAddress(destination), // N Morada Destinatário
    clean(destination.zip), // O Cod Post Destinatário
    clean(destination.city), // P Localidade Destinatário
    destCountry, // Q Pais Destinatário
    normalizePhone(clean(destination.phone || order.phone), destCountry), // R Contacto Destinatário
    clean(order.email), // S Email destinatario
    recipient, // T Pessoa Contacto Destino
    1, // U Volumes/Qtd (um volume por encomenda, ajustável mais tarde)
    weightKg, // V Peso (Kg)
    "", // W Kms
    price, // X Cobrança - segue valor atual da encomenda, como na Trilhos
    0, // Y Retorno (1/0)
    "", // Z Observações - não exportar notas privadas da Shopify
    clean(shop.name), // AA Solicitado Por
  ];
  if (row.length !== NEXTLOG_HEADERS.length) {
    throw new Error("NextLog: mapeamento incompatível com o modelo A:AA (27 colunas).");
  }
  return row;
}
