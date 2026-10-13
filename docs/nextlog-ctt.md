# Exportadores independentes

Cada transportadora usa um endpoint, um formato Excel e os seus próprios
serviços guardados no Admin. Não há lógica NextLog no exportador da Trilhos.

| Transportadora | Endpoint | Ficheiro exportado | Formato |
| --- | --- | --- | --- |
| Trilhos | `/api/export-selected` | `SELLFORGE_EXPORT.xlsx` | Modelo original `public/ATT_IMPORT.xlsx`, 15 colunas |
| NextLog | `/api/export-nextlog` | `SELLFORGE_NEXTLOG_CTT29.xlsx` | Folha criada apenas para a NextLog, 29 colunas A:AC |

## Trilhos restaurada

A exportação foi reposta a partir da última versão anterior à integração
NextLog (`d70da8d`). A única adaptação de comportamento é ler os serviços dos campos
`trilhosPtService` e `trilhosEsService` já editáveis no Admin, em vez de os
fixar no código. Os padrões continuam a ser GOLD para PT e 24ES para ES.
O tipo da resposta GraphQL foi ajustado para compilar com o SDK atual.

O template ATT_IMPORT.xlsx é idêntico, byte por byte, ao dessa versão.
Mantém REF, COBRANÇA, NOME, MORADA, CP, LOCALIDADE, CONTACTO, PAIS, BACK,
VOLUMES, PESO, EMAIL, OBS, CLIENTE e SERVIÇO, nessa ordem.

A consulta Shopify da Trilhos voltou à original e não pede campos de peso ou
remetente usados na NextLog. As alterações futuras da NextLog ficam no seu
exportador independente.

## NextLog em validação

O exportador independente mantém os 29 campos da implementação atual, com
serviço em D, destinatário em E, morada em F, código postal em G, volumes em
V, peso em W, reembolso em Y e referência em AB. Estes valores são testados
no ficheiro Excel produzido e reaberto.

A importação real ainda precisa de confirmação com o ficheiro vazio original
da opção MODELO CTT da NextLog. A pré-visualização apresenta 29 campos, mas
isso, por si só, não confirma a ordem das colunas esperada no ficheiro de
entrada. O exemplo apresentado pelo utilizador continua deslocado no portal;
não se deve declarar esse problema resolvido apenas porque o XLSX tem 29
colunas. Esta investigação fica limitada à NextLog.

Os serviços NextLog usam apenas `nextlogPtService` e `nextlogEsService`.
O peso Shopify é convertido de gramas para kg. Sem peso válido, é usado o
peso padrão NextLog guardado; se também estiver ausente ou inválido, é usado
1 kg provisório, a conferir antes de gerar a guia.

## Verificação

```sh
pnpm install --frozen-lockfile
pnpm test:exports
pnpm typecheck
pnpm build
```

Os testes usam encomendas fictícias. Reabrem os ficheiros produzidos para
verificar os dois contratos Excel, serviços por país e por transportadora,
independência das permissões, rejeição de pedidos enviados ao endpoint errado
e preservação exata do modelo Trilhos.

Ficheiros enviados acidentalmente para a raiz do repositório foram removidos
ou movidos para app, docs e tests. A atualização deve ser aplicada no PC,
mantendo esses caminhos, e depois enviada pelo CMD.
