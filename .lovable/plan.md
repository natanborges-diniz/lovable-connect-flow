
Usuário quer ver a base cadastral completa de produtos Essilor (`pricing_table_lentes` filtrado por brand=Essilor) para comparar com o material do fornecedor.

É uma consulta de leitura — não precisa mudar código. Vou executar a query e devolver os 34 registros tabulados, agrupados por família/categoria, com todos os campos relevantes (família, categoria, índice, tratamento, photo/blue, faixas sphere/cyl/add, diâmetro, altura mínima, preço, prioridade, ativo).

## Plano

**1. Consultar `pricing_table_lentes`** com `brand ILIKE 'essilor'` (também variantes como Varilux, Eyezen, Crizal caso estejam cadastradas como brand separada — verificar).

**2. Apresentar resultado em duas formas:**
   - **Resumo agrupado**: contagem por `family` + `category` + `index_name` para visão macro do que está cadastrado vs. o que falta.
   - **Tabela completa**: todos os 34 registros com todas as colunas, ordenados por família → categoria → índice → tratamento.

**3. Exportar CSV** em `/mnt/documents/essilor_catalogo.csv` para download e comparação offline com o material do fornecedor.

**4. Apontar lacunas óbvias** (ex: famílias Varilux/Eyezen/Stylis ausentes, índices faltando, ausência de tratamentos como Crizal Sapphire/Prevencia, etc.) para guiar sua comparação.

Saída final: tabela renderizada no chat + artifact CSV.
