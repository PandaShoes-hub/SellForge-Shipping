// Formato Excel específico da NextLog: 29 colunas, na ordem do importador.
// Não utilizar o template ATT_IMPORT.xlsx da Trilhos nesta transportadora.
export const NEXTLOG_HEADERS = [
  "Data",
  "Hora Início",
  "Hora Fim",
  "Código de Serviço",
  "Nome Destinatário",
  "Morada Destinatário",
  "Cód. Postal Destinatário",
  "Localidade Destinatário",
  "País Destinatário",
  "Telefone Destinatário",
  "E-mail Destinatário",
  "Pessoa de Contacto",
  "NIF Destinatário",
  "Nome Remetente",
  "Morada Remetente",
  "Cód. Postal Remetente",
  "Localidade Remetente",
  "País Remetente",
  "Telefone Remetente",
  "Pessoa Contacto Remetente",
  "NIF Remetente",
  "Volumes",
  "Peso Real",
  "Km",
  "Valor Reembolso",
  "Retorno de Encomenda",
  "Retorno Guia Assinada",
  "Referência",
  "Observações"
] as const;

export type NextlogOrder = {
  name: string;
  phone?: string | null;
  email?: string | null;
  currentTotalPriceSet?: { shopMoney?: { amount?: string | number | null } | null } | null;
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

export type NextlogConfig = {
  nextlogPtService: string;
  nextlogEsService: string;
  nextlogSenderName: string;
  nextlogSenderAddress: string;
  nextlogSenderPostalCode: string;
  nextlogSenderCity: string;
  nextlogSenderCountry: string;
  nextlogSenderPhone: string;
  nextlogSenderContact: string;
  nextlogSenderNif: string;
  nextlogDefaultVolumes: number;
  nextlogDefaultWeight: number;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function phoneWithPrefix(phone: string, country: string): string {
  const normal = phone.replace(/\s+/g, "").trim();
  if (!normal) return "";
  if (normal.startsWith("+") || normal.startsWith("00")) return normal;
  if (country === "ES") return normal.startsWith("34") && normal.length === 11 ? `+${normal}` : `+34${normal}`;
  if (country === "PT") return normal.startsWith("351") && normal.length === 12 ? `+${normal}` : `+351${normal}`;
  return normal;
}

export function buildNextlogRow(order: NextlogOrder, config: NextlogConfig): (string | number)[] {
  const address: NonNullable<NextlogOrder["shippingAddress"]> = order.shippingAddress ?? {};
  const country = text(address.countryCodeV2).toUpperCase();
  const name = text(address.name) || [address.firstName, address.lastName].map(text).filter(Boolean).join(" ");
  const street = [address.address1, address.address2].map(text).filter(Boolean).join(" ");
  const money = Number(order.currentTotalPriceSet?.shopMoney?.amount);
  const values: (string | number)[] = [
    "", // A: Data (data de recolha ainda não definida)
    "", // B: Hora Início
    "", // C: Hora Fim
    country === "PT" ? config.nextlogPtService : config.nextlogEsService, // D: Código de Serviço
    name, // E: Nome Destinatário
    street, // F: Morada Destinatário
    text(address.zip), // G: Cód. Postal Destinatário
    text(address.city), // H: Localidade Destinatário
    country, // I: País Destinatário
    phoneWithPrefix(text(address.phone || order.phone), country), // J: Telefone Destinatário
    text(order.email), // K: E-mail Destinatário
    name, // L: Pessoa de Contacto
    "", // M: NIF Destinatário (não disponível na Shopify)
    config.nextlogSenderName, // N: Nome Remetente
    config.nextlogSenderAddress, // O: Morada Remetente
    config.nextlogSenderPostalCode, // P: Cód. Postal Remetente
    config.nextlogSenderCity, // Q: Localidade Remetente
    config.nextlogSenderCountry, // R: País Remetente
    config.nextlogSenderPhone, // S: Telefone Remetente
    config.nextlogSenderContact || config.nextlogSenderName, // T: Pessoa Contacto Remetente
    config.nextlogSenderNif, // U: NIF Remetente
    config.nextlogDefaultVolumes, // V: Volumes
    config.nextlogDefaultWeight, // W: Peso Real (configurado em kg)
    "", // X: Km
    money, // Y: Valor Reembolso (total atual Shopify)
    "", // Z: Retorno de Encomenda
    "", // AA: Retorno Guia Assinada
    order.name, // AB: Referência
    "", // AC: Observações (não exportar notas Shopify)
  ];
  if (values.length !== NEXTLOG_HEADERS.length) {
    throw new Error("Mapeamento NextLog incompatível com as 29 colunas.");
  }
  return values;
}
