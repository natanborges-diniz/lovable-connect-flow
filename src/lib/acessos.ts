// Modelo central de acessos. Mantém em sincronia o tipo derivado do banco
// (sync_from_user_acessos) e a UI.

export type Poder = "ver" | "agir" | "encerrar";

export type ModuloKey =
  // Atrium web
  | "dashboard"
  | "crm"
  | "lojas"
  | "financeiro"
  | "ti"
  | "interno"
  | "estoque"
  | "tarefas"
  | "mensagens"
  | "demandas"
  | "configuracoes"
  // InFoco Messenger
  | "chat_1a1"
  | "chat_grupo"
  | "demandas_minhas_lojas"
  | "menu_loja";

export type ModulosMap = Partial<Record<ModuloKey, Poder>>;

export interface Acessos {
  modulos: ModulosMap;
  lojas: string[] | null; // null = todas
  setores: string[] | null; // null = todos
  acessoTotal: boolean;
}

export const MODULOS_ATRIUM: { key: ModuloKey; label: string; rota?: string; descricao: string }[] = [
  { key: "dashboard", label: "Dashboard", rota: "/", descricao: "Painel inicial com indicadores gerais." },
  { key: "crm", label: "CRM (Vendas)", rota: "/crm", descricao: "Pipeline de vendas: leads, atendimentos do consultor e funil comercial." },
  { key: "lojas", label: "Lojas (Agendamentos)", rota: "/lojas", descricao: "Pipeline de agendamentos por loja (confirmação, no-show, venda)." },
  { key: "financeiro", label: "Financeiro", rota: "/financeiro", descricao: "Links de pagamento, boletos, comprovantes e aprovações de CPF." },
  { key: "ti", label: "TI", rota: "/ti", descricao: "Pipeline de chamados internos de TI." },
  { key: "interno", label: "Interno", rota: "/interno", descricao: "Pipeline corporativo (conversas entre lojas, colaboradores e setores)." },
  { key: "estoque", label: "Estoque", rota: "/estoque", descricao: "Confirmação de peças/lentes e movimentação entre lojas." },
  { key: "tarefas", label: "Tarefas", rota: "/tarefas", descricao: "Lista de tarefas executáveis (kanban operacional)." },
  { key: "mensagens", label: "Mensagens (chat interno web)", rota: "/mensagens", descricao: "Chat interno entre operadores DENTRO do Atrium web. Não é o app do celular." },
  { key: "demandas", label: "Demandas", rota: "/demandas", descricao: "Caixa de demandas tipadas (estoque, financeiro, etc.) que chegam dos setores." },
  { key: "configuracoes", label: "Configurações", rota: "/configuracoes", descricao: "Painel de admin. Só Admins/Diretor devem ter." },
];

export const MODULOS_MESSENGER: { key: ModuloKey; label: string; descricao: string }[] = [
  { key: "chat_1a1", label: "Chat 1:1", descricao: "Habilita conversas individuais no app do celular (colaborador↔colaborador, loja↔colaborador)." },
  { key: "chat_grupo", label: "Grupos", descricao: "Habilita conversas em grupo no app." },
  { key: "demandas_minhas_lojas", label: "Demandas das minhas lojas", descricao: "Caixa do supervisor: vê e responde demandas das lojas no escopo dele." },
  { key: "menu_loja", label: "Menu de loja (fluxos do bot)", descricao: "Habilita o menu interativo do bot no app — Solicitar link, Pedir boleto, Falar com setor, etc. Tipicamente para usuários da loja." },
];

export function hasModulo(a: Acessos | null | undefined, m: ModuloKey): boolean {
  if (!a) return false;
  if (a.acessoTotal) return true;
  return a.modulos?.[m] != null;
}

export function podeAgir(a: Acessos | null | undefined, m: ModuloKey): boolean {
  if (!a) return false;
  if (a.acessoTotal) return true;
  const p = a.modulos?.[m];
  return p === "agir" || p === "encerrar";
}

// Atalhos / perfis pré-prontos. Apenas marcam checkboxes; não são persistidos.
export const PERFIS_RAPIDOS: {
  id: string;
  label: string;
  descricao: string;
  apply: () => Partial<Acessos>;
}[] = [
  {
    id: "diretor",
    label: "Diretor (acesso total)",
    descricao: "Vê e age em tudo, exceto Configurações.",
    apply: () => ({
      acessoTotal: true,
      lojas: null,
      setores: null,
      modulos: Object.fromEntries(
        [...MODULOS_ATRIUM, ...MODULOS_MESSENGER]
          .filter((m) => m.key !== "configuracoes")
          .map((m) => [m.key, "agir" as Poder])
      ),
    }),
  },
  {
    id: "supervisor",
    label: "Supervisor de lojas",
    descricao: "Lojas, Demandas, Mensagens, Tarefas. Escopo: lojas selecionadas. Setores: vazio.",
    apply: () => ({
      acessoTotal: false,
      setores: [], // supervisor opera por loja, não por setor
      modulos: {
        lojas: "agir",
        demandas: "agir",
        mensagens: "agir",
        tarefas: "agir",
        chat_1a1: "agir",
        demandas_minhas_lojas: "agir",
      },
    }),
  },
  {
    id: "operador_loja",
    label: "Operador de loja",
    descricao: "1 loja + módulos básicos + menu_loja no Messenger. Setores: vazio.",
    apply: () => ({
      acessoTotal: false,
      setores: [], // operador de loja NÃO marca setor — escopo é só por loja
      modulos: {
        lojas: "agir",
        mensagens: "agir",
        tarefas: "agir",
        demandas: "agir",
        chat_1a1: "agir",
        menu_loja: "agir",
      },
    }),
  },
  {
    id: "setor",
    label: "Operador de setor",
    descricao: "Módulo do setor + Mensagens. Escopo: setor. Lojas: vazio.",
    apply: () => ({
      acessoTotal: false,
      lojas: [], // operador de setor não tem escopo por loja
      modulos: {
        interno: "agir",
        mensagens: "agir",
        tarefas: "agir",
        chat_1a1: "agir",
      },
    }),
  },
  {
    id: "admin",
    label: "Admin do sistema",
    descricao: "Tudo, incluindo Configurações.",
    apply: () => ({
      acessoTotal: true,
      lojas: null,
      setores: null,
      modulos: Object.fromEntries(
        [...MODULOS_ATRIUM, ...MODULOS_MESSENGER].map((m) => [m.key, "agir" as Poder])
      ),
    }),
  },
];

export function moduloFromRoute(pathname: string): ModuloKey | null {
  if (pathname === "/" || pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/crm")) return "crm";
  if (pathname.startsWith("/lojas")) return "lojas";
  if (pathname.startsWith("/financeiro")) return "financeiro";
  if (pathname.startsWith("/ti")) return "ti";
  if (pathname.startsWith("/interno")) return "interno";
  if (pathname.startsWith("/estoque")) return "estoque";
  if (pathname.startsWith("/tarefas")) return "tarefas";
  if (pathname.startsWith("/mensagens")) return "mensagens";
  if (pathname.startsWith("/demandas")) return "demandas";
  if (pathname.startsWith("/configuracoes")) return "configuracoes";
  return null;
}
