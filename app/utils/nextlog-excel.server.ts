/**
 * NextLog -> opção de importação "MODELO CTT" (14 colunas de entrada A:N).
 * Formato confirmado no portal com NEXTLOG_TESTE_MODELO_CTT.xlsx.
 * Os 29 campos da pré-visualização são o resultado do mapeamento do portal.
 */
export const NEXTLOG_HEADERS = [
  "REF",         // A
  "COBRANÇA",    // B
  "NOME",        // C
  "MORADA",      // D
  "CP",          // E
  "LOCALIDADE",  // F
  "CONTACTO",    // G
  "EMAIL",       // H
  "PAIS",        // I
  "BACK",        // J
  "VOLUMES",     // K
  "PESO",        // L
  "OBS",         // M
  "SERVIÇO",     // N
] as const;

export type NextlogOrder = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
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
  const a = order.shippingAddress;
  return clean(a?.name) || [a?.firstName, a?.lastName].map(clean).filter(Boolean).join(" ");
}

export function normalizePhone(raw: string, country: string): string {
  const phone = clean(raw).replace(/[\s().-]/g, "");
  if (!phone) return "";
  if (phone.startsWith("+")) return phone;
  if (phone.startsWith("00")) return `+${phone.slice(2)}`;
  const prefix = country === "PT" ? "351" : country === "ES" ? "34" : "";
  if (!prefix) return phone;
  // Não duplicar indicativo quando já vem presente sem "+".
  if (phone.startsWith(prefix) && phone.length === prefix.length + 9) {
    return `+${phone}`;
  }
  return `+${prefix}${phone}`;
}

/** Exporta o formato MODELO CTT confirmado, sempre com 1 volume e 1 kg. */
export function buildNextlogRow(
  order: NextlogOrder,
  settings: NextlogServices,
): (string | number)[] {
  const a = order.shippingAddress ?? {};
  const destCountry = clean(a.countryCodeV2).toUpperCase();
  const recipient = recipientName(order);
  const price = Number(order.currentTotalPriceSet?.shopMoney?.amount);
  const service = destCountry === "PT" ? settings.nextlogPtService : settings.nextlogEsService;

  const values: (string | number)[] = [
    clean(order.name),                                                       // A  Referência
    price,                                                                   // B  Cobrança
    recipient,                                                               // C  Nome destinatário
    fullAddress(a),                                                           // D  Morada
    clean(a.zip).replace(/^'+/, ""),                                          // E  Código postal
    clean(a.city),                                                            // F  Localidade
    normalizePhone(clean(a.phone) || clean(order.phone), destCountry),        // G  Telefone
    clean(order.email),                                                       // H  E-mail
    destCountry,                                                             // I  País destinatário
    0,                                                                       // J  BACK
    1,                                                                       // K  Volumes fixos
    1,                                                                       // L  Peso fixo em kg
    "",                                                                      // M  Observações
    clean(service),                                                          // N  Serviço NextLog do Admin
  ];
  if (values.length !== NEXTLOG_HEADERS.length || values.length !== 14) {
    throw new Error("NextLog MODELO CTT: número de colunas diferente de 14.");
  }
  return values;
}
