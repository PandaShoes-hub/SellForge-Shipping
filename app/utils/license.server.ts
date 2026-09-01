import prisma from "../db.server";

export type LicenseStatus = {
  allowed: boolean;
  reason:
    | "active"
    | "not_found"
    | "inactive"
    | "expired";
  shop: string;
  company: string | null;
  expiresAt: Date | null;
  trilhosEnabled: boolean;
  cttEnabled: boolean;
  upsEnabled: boolean;
};

function normalizeShop(shop: string): string {
  return shop.trim().toLowerCase();
}

const noCarrierAccess = {
  trilhosEnabled: false,
  cttEnabled: false,
  upsEnabled: false,
};

export async function getLicenseStatus(
  shop: string,
): Promise<LicenseStatus> {
  const normalizedShop = normalizeShop(shop);

  const license = await prisma.license.findUnique({
    where: {
      shop: normalizedShop,
    },
  });

  if (!license) {
    // Uma loja nova fica registada automaticamente no Admin,
    // mas sem acesso até ser aprovada manualmente.
    await prisma.license.upsert({
      where: {
        shop: normalizedShop,
      },
      update: {},
      create: {
        shop: normalizedShop,
        active: false,
        trilhosEnabled: false,
        cttEnabled: false,
        upsEnabled: false,
      },
    });

    return {
      allowed: false,
      reason: "not_found",
      shop: normalizedShop,
      company: null,
      expiresAt: null,
      ...noCarrierAccess,
    };
  }

  if (!license.active) {
    return {
      allowed: false,
      reason: "inactive",
      shop: normalizedShop,
      company: license.company,
      expiresAt: license.expiresAt,
      trilhosEnabled: license.trilhosEnabled,
      cttEnabled: license.cttEnabled,
      upsEnabled: license.upsEnabled,
    };
  }

  const expired =
    license.expiresAt !== null &&
    license.expiresAt.getTime() < Date.now();

  if (expired) {
    return {
      allowed: false,
      reason: "expired",
      shop: normalizedShop,
      company: license.company,
      expiresAt: license.expiresAt,
      trilhosEnabled: license.trilhosEnabled,
      cttEnabled: license.cttEnabled,
      upsEnabled: license.upsEnabled,
    };
  }

  return {
    allowed: true,
    reason: "active",
    shop: normalizedShop,
    company: license.company,
    expiresAt: license.expiresAt,
    trilhosEnabled: license.trilhosEnabled,
    cttEnabled: license.cttEnabled,
    upsEnabled: license.upsEnabled,
  };
}

export async function isShopLicensed(
  shop: string,
): Promise<boolean> {
  const status = await getLicenseStatus(shop);

  return status.allowed;
}

export async function registerLicenseAccess(
  shop: string,
): Promise<void> {
  const normalizedShop = normalizeShop(shop);

  await prisma.license.updateMany({
    where: {
      shop: normalizedShop,
    },
    data: {
      lastAccessAt: new Date(),
    },
  });
}