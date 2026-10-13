# Exportação NextLog — MODELO CTT

A opção **MODELO CTT** da NextLog exige 29 colunas, de A a AC. O ficheiro
`public/modelo_importacao_envios.xlsx` tem 27 colunas e pertence a outro formato;
não deve ser utilizado nesta opção. O exportador gera a folha `Listagem`
diretamente, sem coluna de índice nem linhas vazias entre encomendas.

O mapeamento de 29 colunas está na `main` desde o commit `2324ec6`.
Um Excel exportado antes dessa correção precisa de ser gerado novamente.

| Coluna | Campo | Origem |
| --- | --- | --- |
| D | Código de Serviço | Serviço NextLog configurado para o país: CTT48H em PT, CTT24H em ES por padrão |
| E | Nome Destinatário | Nome da morada de entrega Shopify |
| F | Morada Destinatário | Morada e complemento da entrega |
| G | Cód. Postal Destinatário | Texto, preservando zeros iniciais |
| H | Localidade Destinatário | Localidade da entrega |
| I | País Destinatário | PT ou ES |
| J | Telefone Destinatário | Telefone com indicativo internacional |
| K | E-mail Destinatário | E-mail da encomenda |
| N a U | Dados do remetente | Configuração NextLog completa; caso contrário, dados da loja Shopify |
| V | Volumes | Número padrão guardado; 1 se estiver ausente ou inválido |
| W | Peso Real | Peso Shopify convertido de gramas para kg; peso padrão guardado se não houver peso Shopify válido |
| Y | Valor Reembolso | Total atual da encomenda Shopify |
| AB | Referência | Número da encomenda |
| AC | Observações | Vazio; notas privadas Shopify não são exportadas |

Sem um peso padrão válido, o fallback continua a ser 1 kg. Este é um valor
provisório: o peso real deve ser conferido antes de gerar a guia.

## Verificação antes de publicar

```sh
pnpm install --frozen-lockfile
pnpm test:exports
pnpm typecheck
pnpm build
```

Os testes executam a ação de exportação e reabrem o Excel produzido. Utilizam
dados fictícios e substituem as consultas Shopify e a licença, sem aceder a
lojas ou bases de dados. Verificam a ordem das 29 colunas, PT/ES, zeros dos
códigos postais, kg, reembolso, remetente, campos obrigatórios e valores padrão.
Também confirmam o contrato original da Trilhos: 15 colunas, modelo ATT_IMPORT,
serviços GOLD/24ES e exportação por omissão.

Após o deploy no Render, exportar um ficheiro novo e importá-lo na opção
**MODELO CTT** da NextLog. Na pré-visualização, confirmar serviço em D, nome em
E, morada em F, código postal em G, volumes em V, peso em W, reembolso em Y e
referência em AB. Um nome de loja em D indica um ficheiro ou exportador de
outro formato. Validar com uma encomenda PT e outra ES antes de concluir a
importação.

## Próximas atualizações

- Mostrar quando foi usado um peso padrão por faltar o peso na Shopify.
- Identificar a versão do formato exportado para distinguir ficheiros antigos.
- Manter estes testes como verificação obrigatória nas próximas alterações aos exportadores.

Esta alteração não modifica o template nem o preenchimento da Trilhos.
