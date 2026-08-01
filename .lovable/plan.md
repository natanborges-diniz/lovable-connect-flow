# Copiloto: busca por "Varilux Stylis" não encontra nada

## O que foi verificado

- Não existe nenhuma linha em `pricing_table_lentes` com "Stylis" em `family` ou `treatment` (0 resultados).
- "Stylis" não é família — é o **material/índice** da Essilor. No catálogo oficial (`essilor_pvc_abr2026_expandido.json`) aparece como "Stylis 1.67" / "Stylis 1.74", mas no banco está gravado como código: `S156`, `S167`, `S174` (96 linhas ativas).
- A busca do copiloto (`buscar-lentes-operador`) procura o termo **apenas** em `brand`, `family` e `treatment` — nunca em `index_name`. E procura a frase inteira: "Varilux Stylis" vira um único `ilike '%Varilux Stylis%'`, que nunca casa, mesmo se o material estivesse legível.
- Efeito colateral do mesmo problema: qualquer busca com duas palavras ("XR Pro Crizal", "Comfort Airwear") já falha hoje.

## O que fazer

### 1. Normalizar o material no banco (migration)

Traduzir os códigos Essilor para o nome comercial usado pelo cliente e pelo vendedor:

```text
S156 -> Stylis 1.56
S167 -> Stylis 1.67
S174 -> Stylis 1.74
Orma -> Orma 1.50
Airwear -> Airwear 1.59
Poli -> Policarbonato 1.59
```

Isso já faz "Stylis" aparecer na mensagem formatada ao cliente (hoje sai "Varilux XR Pro™ S167 Crizal", passa a sair "Varilux XR Pro™ Stylis 1.67 Crizal").

Os códigos opacos da DMax (`1.56_A56`, `1.59_Poli`, `1.67_F67`…) ficam para uma segunda rodada, com confirmação de qual tratamento cada sufixo representa.

### 2. Buscar também pelo material e por múltiplas palavras (edge function)

Em `supabase/functions/buscar-lentes-operador/index.ts`, nos modos Óculos e Catálogo:

- Quebrar o termo digitado em palavras e exigir **todas** elas (AND entre tokens), cada token casando em `brand` OR `family` OR `treatment` OR `index_name`.
- "Varilux Stylis" passa a devolver as lentes Varilux em material Stylis; "Varilux" sozinho continua devolvendo tudo como hoje.
- Mesma lógica aplicada ao modo Lentes de contato (`fornecedor`, `produto`).

### 3. Extração em linguagem natural

Ampliar o prompt do extrator NL para reconhecer material/índice ("stylis", "airwear", "orma", "1.67", "1.74", "policarbonato") e devolver junto do termo de marca, em vez de só a lista fixa de marcas.

## Detalhes técnicos

- Migration: `UPDATE public.pricing_table_lentes SET index_name = ... WHERE brand = 'Essilor' AND index_name IN (...)` — só rótulo, sem mexer em preço, faixa de grau ou `active`.
- A busca continua sendo somente leitura; nada é gravado em atendimento, metadata ou mensagens.
- `runConsultarLentes` do `ai-triage` não é alterado; ele lê `index_name` só para exibir, então herda o rótulo novo sem risco de regressão de filtro.
- Redeploy necessário: `buscar-lentes-operador`.
