# Exportar mais de 100 encomendas

A limitação vinha das consultas de listagem, que usavam `first: 100` sem
avançar para a página seguinte. A aplicação mostrava apenas as primeiras
100 encomendas abertas e por preparar. O dashboard também contava apenas
essas 100 encomendas.

## Comportamento atualizado

- A listagem e o dashboard percorrem as páginas Shopify com `after`,
  `hasNextPage` e `endCursor`, mantendo o filtro e a ordenação existentes.
- O ecrã apresenta 100 linhas por página para manter a seleção rápida.
  **Selecionar todas** abrange todas as encomendas que correspondem à
  pesquisa, incluindo as que estão nas outras páginas do ecrã.
- Os IDs selecionados são consultados em lotes de até 100. Todos os lotes
  são reunidos no mesmo Excel. O tamanho do lote não limita a quantidade
  total exportada.
- IDs repetidos no pedido são exportados uma única vez.
- Se uma página ou um lote falhar, a aplicação apresenta um erro. Não
  descarrega um Excel parcial como se estivesse completo.
- As consultas aguardam quando o orçamento GraphQL devolvido pela Shopify
  não chega para o pedido seguinte. Erros THROTTLED, incluindo os lançados
  pelo SDK, são repetidos até três vezes com espera. Um pedido cancelado
  interrompe o carregamento.

## Formatos preservados

Trilhos mantém `public/ATT_IMPORT.xlsx`, as suas 15 colunas e os serviços
PT/ES guardados no Admin. A alteração no seu endpoint limita-se a obter
os IDs por lotes e a evitar IDs repetidos.

NextLog mantém o MODELO CTT confirmado de 14 colunas A:N, os seus serviços
PT/ES e **1 volume / 1 kg por encomenda**.

Não há alterações de permissões, licença, base de dados ou migrações.

## Limites e verificação

Foi retirado o teto de 100 da SellForge. Isto não representa uma promessa
de quantidade infinita: permanecem os limites da Shopify, do Excel e da
memória/tempo de resposta do servidor. A paginação Shopify admite até
25.000 objetos por pesquisa; volumes superiores precisam de filtros ou
de outra estratégia de extração. Grandes volumes devem ser verificados
no serviço alojado antes de se prometer uma capacidade específica.

Os testes usam respostas Shopify simuladas e executam os loaders, o
componente de seleção e os dois exportadores reais. Verificam 1.001
encomendas completas, IDs únicos, seleção entre páginas, falhas em páginas
ou lotes posteriores, controlo de custo, repetição de throttling,
cancelamento e preservação dos dois contratos Excel.

```sh
npx prisma generate
npm run typecheck
npm run test:exports
npm run build
```

Referências oficiais:

- [Paginação GraphQL](https://shopify.dev/docs/api/usage/pagination-graphql)
- [Limites da Shopify](https://shopify.dev/docs/api/usage/limits)
- [Custo e controlo de pedidos GraphQL](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits)
