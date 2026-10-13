-- Adiciona a NextLog sem modificar as permissões das transportadoras existentes.
ALTER TABLE "License"
  ADD COLUMN "nextlogEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "nextlogPtService" TEXT NOT NULL DEFAULT 'CTT48H',
  ADD COLUMN "nextlogEsService" TEXT NOT NULL DEFAULT 'CTT24H';
