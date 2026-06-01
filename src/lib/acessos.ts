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

export const MODULOS_ATRIUM: { key: ModuloKey; label: string; rota?: string }[] = [
  { key: "dashboard", label: "Dashboard", rota: "/" },
  { key: "crm", label: "CRM (Vendas)", rota: "/crm" },
  { key: "lojas", label: "Lojas (Agendamentos)", rota: "/lojas" },
  { key: "financeiro", label: "Financeiro", rota: "/financeiro" },
  { key: "ti", label: "TI", rota: "/ti" },
  { key: "interno", label: "Interno", rota: "/interno" },
  { key: "estoque", label: "Estoque", rota: "/estoque" },
  { key: "tarefas", label: "Tarefas", rota: "/tarefas" },
  { key: "mensagens", label: "Mensagens", rota: "/mensagens" },
  { key: "demandas", label: "Demandas", rota: "/demandas" },
  { key: "configuracoes", label: "Configurações", rota: "/configuracoes" },
];

export const MODULOS_MESSENGER: { key: ModuloKey; label: string }[] = [
  { key: "chat_1a1", label: "Chat 1:1" },
  { key: "chat_grupo", label: "Grupos" },
  { key: "demandas_minhas_lojas", label: "Demandas das minhas lojas" },
  { key: "menu_loja", label: "Menu de loja (fluxos do bot)" },
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
    descricao: "Lojas, Demandas, Mensagens, Tarefas. Escopo: lojas selecionadas.",
    apply: () => ({
      acessoTotal: false,
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
    descricao: "1 loja, módulos básicos + menu_loja no Messenger.",
    apply: () => ({
      acessoTotal: false,
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
    descricao: "Módulo do setor + Mensagens. Escopo: setor.",
    apply: () => ({
      acessoTotal: false,
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
