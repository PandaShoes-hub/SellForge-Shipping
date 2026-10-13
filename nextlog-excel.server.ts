/**
 * NextLog -> opção de importação "MODELO CTT" (29 colunas A:AC).
 * A ordem foi retirada da pré-visualização MODELO CTT enviada pelo utilizador.
 * O antigo modelo "modelo_importacao_envios.xlsx" com 27 colunas NÃO serve para MODELO CTT.
 */
export const NEXTLOG_HEADERS = [
  "Data",                         // A (1)
  "Hora Início",                  // B
  "Hora Fim",                     // C
  "Código de Serviço",            // D
  "Nome Destinatário",            // E
  "Morada Destinatário",          // F
  "Cód. Postal Destinatário",     // G
  "Localidade Destinatário",      // H
  "País Destinatário",            // I
  "Telefone Destinatário",        // J
  "E-mail Destinatário",          // K
  "Pessoa de Contacto",           // L
  "NIF Destinatário",             // M
  "Nome Remetente",               // N
  "Morada Remetente",             // O
  "Cód. Postal Remetente",        // P
  "Localidade Remetente",         // Q
  "País Remetente",               // R
  "Telefone Remetente",           // S
  "Pessoa Contacto Remetente",    // T
  "NIF Remetente",                // U
  "Volumes",                      // V
  "Peso Real",                    // W
  "Km",                           // X
  "Valor Reembolso",              // Y
  "Retorno de Encomenda",         // Z
  "Retorno Guia Assinada",        // AA
  "Referência",                   // AB
  "Observações",                  // AC (29)
] as const;

export type NextlogOrder = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  currentTotalWeight?: number | string | null; // Shopify Admin GraphQL: gramas
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
  nextlogDefaultVolumes?: number | null;
  nextlogDefaultWeight?: number | null; // kg, usado quando a Shopify não fornece peso
  // Dados anteriormente guardados no Admin. Só são usados se o conjunto
  // essencial estiver completo, para não misturar moradas de remetentes.
  nextlogSenderName?: string | null;
  nextlogSenderAddress?: string | null;
  nextlogSenderPostalCode?: string | null;
  nextlogSenderCity?: string | null;
  nextlogSenderCountry?: string | null;
  nextlogSenderPhone?: string | null;
  nextlogSenderContact?: string | null;
  nextlogSenderNif?: string | null;
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

/**
 * Remetente: prioriza dados completos previamente configurados para a NextLog.
 * Caso contrário, usa o billingAddress da loja Shopify.
 * Atenção: morada de faturação da loja pode NÃO ser a morada de expedição.
 */
export function nextlogSender(shop: NextlogShop, settings: NextlogServices) {
  const hasPreviousConfig = [
    settings.nextlogSenderName,
    settings.nextlogSenderAddress,
    settings.nextlogSenderPostalCode,
    settings.nextlogSenderCity,
    settings.nextlogSenderCountry,
  ].every((value) => clean(value).length > 0);
  if (hasPreviousConfig) {
    const country = clean(settings.nextlogSenderCountry).toUpperCase();
    return {
      name: clean(settings.nextlogSenderName),
      address: clean(settings.nextlogSenderAddress),
      postalCode: clean(settings.nextlogSenderPostalCode),
      city: clean(settings.nextlogSenderCity),
      country,
      phone: normalizePhone(clean(settings.nextlogSenderPhone), country),
      contact: clean(settings.nextlogSenderContact) || clean(settings.nextlogSenderName),
      nif: clean(settings.nextlogSenderNif),
      source: "saved" as const,
    };
  }
  const origin = shop.shopAddress ?? {};
  const country = clean(origin.countryCodeV2).toUpperCase();
  return {
    name: clean(origin.company) || clean(shop.name),
    address: fullAddress(origin),
    postalCode: clean(origin.zip),
    city: clean(origin.city),
    country,
    phone: normalizePhone(clean(origin.phone), country),
    contact: clean(origin.company) || clean(shop.name),
    nif: "", // Não inventar NIF que a Shopify não forneceu
    source: "shopify" as const,
  };
}

/** Exporta precisamente os 29 valores exigidos pelo MODELO CTT, em A:AC. */
export function buildNextlogRow(
  order: NextlogOrder,
  settings: NextlogServices,
  shop: NextlogShop,
  exportDate: string,
): (string | number)[] {
  const a = order.shippingAddress ?? {};
  const destCountry = clean(a.countryCodeV2).toUpperCase();
  const sender = nextlogSender(shop, settings);
  const recipient = recipientName(order);
  const grams = Number(order.currentTotalWeight ?? 0);
  const configuredWeight = Number(settings.nextlogDefaultWeight);
  const defaultWeight = Number.isFinite(configuredWeight) && configuredWeight > 0
    ? configuredWeight
    : 1;
  const configuredVolumes = Number(settings.nextlogDefaultVolumes);
  const volumes = Number.isInteger(configuredVolumes) && configuredVolumes > 0
    ? configuredVolumes
    : 1;
  // Respeitar o peso padrão guardado se os produtos Shopify não tiverem peso.
  // O comerciante deverá conferir o peso real antes de gerar a guia.
  const weightKg = Number.isFinite(grams) && grams > 0
    ? Math.max(0.01, Math.round(grams / 10) / 100)
    : defaultWeight;
  const price = Number(order.currentTotalPriceSet?.shopMoney?.amount);
  const service = destCountry === "PT" ? settings.nextlogPtService : settings.nextlogEsService;

  const values: (string | number)[] = [
    exportDate,                                                   // A  Data
    "",                                                           // B  Hora Início
    "",                                                           // C  Hora Fim
    clean(service),                                               // D  Código de Serviço
    recipient,                                                    // E  Nome Destinatário
    fullAddress(a),                                               // F  Morada Destinatário
    clean(a.zip).replace(/^'+/, ""),                              // G  Cód. Postal Destinatário
    clean(a.city),                                                // H  Localidade Destinatário
    destCountry,                                                  // I  País Destinatário
    normalizePhone(clean(a.phone || order.phone), destCountry),    // J  Telefone Destinatário
    clean(order.email),                                           // K  E-mail Destinatário
    recipient,                                                    // L  Pessoa de Contacto
    "",                                                           // M  NIF Destinatário (não fornecido)
    sender.name,                                                  // N  Nome Remetente
    sender.address,                                               // O  Morada Remetente
    sender.postalCode,                                            // P  Cód. Postal Remetente
    sender.city,                                                  // Q  Localidade Remetente
    sender.country,                                               // R  País Remetente
    sender.phone,                                                 // S  Telefone Remetente
    sender.contact,                                               // T  Pessoa Contacto Remetente
    sender.nif,                                                   // U  NIF Remetente
    volumes,                                                      // V  Volumes
    weightKg,                                                     // W  Peso Real (kg)
    "",                                                           // X  Km
    price,                                                        // Y  Valor Reembolso: mesmo valor utilizado na Trilhos
    0,                                                            // Z  Retorno de Encomenda (não pedir retorno automaticamente)
    0,                                                            // AA Retorno Guia Assinada
    clean(order.name),                                            // AB Referência
    "",                                                           // AC Observações privadas não exportadas
  ];
  if (values.length !== NEXTLOG_HEADERS.length || values.length !== 29) {
    throw new Error("NextLog MODELO CTT: número de colunas diferente de 29.");
  }
  return values;
}
