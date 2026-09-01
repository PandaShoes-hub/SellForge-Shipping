-- AlterTable
ALTER TABLE "License" ADD COLUMN     "cttEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trilhosEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "upsEnabled" BOOLEAN NOT NULL DEFAULT false;
