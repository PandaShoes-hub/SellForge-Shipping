-- Permite editar os serviços Trilhos e configurar o remetente NextLog por loja.
-- Os serviços existentes mantêm os valores atuais.
ALTER TABLE "License"
  ADD COLUMN "trilhosPtService" TEXT NOT NULL DEFAULT 'GOLD',
  ADD COLUMN "trilhosEsService" TEXT NOT NULL DEFAULT '24ES',
  ADD COLUMN "nextlogSenderName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "nextlogSenderAddress" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "nextlogSenderPostalCode" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "nextlogSenderCity" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "nextlogSenderCountry" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "nextlogSenderPhone" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "nextlogSenderContact" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "nextlogSenderNif" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "nextlogDefaultVolumes" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "nextlogDefaultWeight" DOUBLE PRECISION NOT NULL DEFAULT 1;
