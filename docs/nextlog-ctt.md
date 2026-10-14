# Exportadores independentes

Cada transportadora usa um endpoint, um formato Excel e os seus próprios
serviços guardados no Admin. Não há lógica NextLog no exportador da Trilhos.

| Transportadora | Endpoint | Ficheiro exportado | Formato |
| --- | --- | --- | --- |
| Trilhos | `/api/export-selected` | `SELLFORGE_EXPORT.xlsx` | Modelo original `public/ATT_IMPORT.xlsx`, 15 colunas |
| NextLog | `/api/export-nextlog` | `SELLFORGE_NEXTLOG_CTT.xlsx` | MODELO CTT confirmado, 14 colunas de entrada A:N |

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

## NextLog: MODELO CTT confirmado

Em 14 de outubro de 2026, o utilizador confirmou no portal NextLog que o
ficheiro `NEXTLOG_TESTE_MODELO_CTT.xlsx` apresentou o serviço CTT24H, os
volumes e o peso nas posições corretas. Esse ficheiro tem 14 colunas de
entrada. Os 29 campos da pré-visualização são o resultado do mapeamento
feito pelo portal, não a ordem a usar no Excel.

O exportador usa o mesmo esquema confirmado:

| Coluna | Cabeçalho | Conteúdo |
| --- | --- | --- |
| A | REF | Referência da encomenda Shopify |
| B | COBRANÇA | Valor atual da encomenda |
| C | NOME | Nome do destinatário |
| D | MORADA | Morada do destinatário |
| E | CP | Código postal como texto |
| F | LOCALIDADE | Localidade do destinatário |
| G | CONTACTO | Telefone com indicativo |
| H | EMAIL | E-mail do destinatário |
| I | PAIS | PT ou ES |
| J | BACK | 0 |
| K | VOLUMES | Sempre o número 1 |
| L | PESO | Sempre o número 1, em kg |
| M | OBS | Vazio |
| N | SERVIÇO | Serviço NextLog do país, guardado no Admin |

A pedido do utilizador, cada encomenda NextLog sai sempre com **1 volume e
1 kg**, mesmo que a Shopify indique outro peso ou existam outros padrões
guardados. Esses campos antigos continuam na base de dados, mas não
controlam K e L. Esta alteração não precisa de uma migração.

Os serviços continuam a usar apenas `nextlogPtService` e `nextlogEsService`,
editáveis no Admin. O ficheiro tem uma única folha, `Listagem`, com uma
linha de cabeçalhos e uma linha por encomenda.

Este esquema corresponde ao MODELO CTT testado na conta NextLog do projeto.
O Excel não contém campos de remetente. O exportador não consulta o nome
ou a morada da loja Shopify e não exige um remetente guardado para gerar
este formato. Os dados de remetente apresentados na importação dependem
da configuração do modelo no portal NextLog.

A confirmação no portal foi feita com um registo fictício. Depois de
publicar a atualização, deve verificar-se a pré-visualização de uma
encomenda real antes de concluir a importação.

## Verificação

```sh
npx prisma generate
npm run typecheck
npm run test:exports
npm run build
```

Os testes usam encomendas fictícias. Reabrem os ficheiros produzidos para
verificar os dois contratos Excel, 1 volume e 1 kg fixos na NextLog,
serviços por país e por transportadora,
independência das permissões, rejeição de pedidos enviados ao endpoint errado
e preservação exata do modelo Trilhos.

Ficheiros enviados acidentalmente para a raiz do repositório foram removidos
ou movidos para app, docs e tests. A atualização deve ser aplicada no PC,
mantendo esses caminhos, e depois enviada pelo CMD.
