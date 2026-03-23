export type TipoContato = 'cliente' | 'fornecedor' | 'loja' | 'colaborador';
export type EstagioFunil = 'lead' | 'qualificado' | 'proposta' | 'fechado' | 'perdido';
export type TipoCanal = 'whatsapp' | 'sistema' | 'email' | 'telefone';
export type StatusSolicitacao = 'aberta' | 'classificada' | 'em_atendimento' | 'aguardando_execucao' | 'concluida' | 'cancelada' | 'reaberta';
export type Prioridade = 'critica' | 'alta' | 'normal' | 'baixa';

export interface Contato {
  id: string;
  nome: string;
  tipo: TipoContato;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  metadata: Record<string, unknown>;
  tags: string[];
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Canal {
  id: string;
  contato_id: string;
  tipo: TipoCanal;
  identificador: string;
  principal: boolean;
  provedor: string;
  ativo: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface EventoCRM {
  id: string;
  contato_id: string;
  tipo: string;
  descricao: string | null;
  referencia_tipo: string | null;
  referencia_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Solicitacao {
  id: string;
  contato_id: string;
  canal_origem: TipoCanal;
  status: StatusSolicitacao;
  assunto: string;
  descricao: string | null;
  tipo: string | null;
  prioridade: Prioridade;
  classificacao_ia: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  contato?: Contato;
}

export type TipoFila = 'atendimento' | 'execucao';
export type StatusAtendimento = 'aguardando' | 'em_atendimento' | 'encerrado';
export type DirecaoMensagem = 'inbound' | 'outbound' | 'internal';
export type StatusTarefa = 'pendente' | 'em_andamento' | 'concluida' | 'cancelada';

export interface Setor {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Fila {
  id: string;
  setor_id: string;
  nome: string;
  tipo: TipoFila;
  descricao: string | null;
  ativo: boolean;
  sla_minutos: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  setor?: Setor;
}

export interface Atendimento {
  id: string;
  solicitacao_id: string;
  fila_id: string | null;
  contato_id: string;
  status: StatusAtendimento;
  canal: TipoCanal;
  canal_provedor: string;
  atendente_nome: string | null;
  inicio_at: string | null;
  fim_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  solicitacao?: Solicitacao;
  contato?: Contato;
  fila?: Fila;
}

export interface Mensagem {
  id: string;
  atendimento_id: string;
  direcao: DirecaoMensagem;
  conteudo: string;
  remetente_nome: string | null;
  provedor: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Tarefa {
  id: string;
  solicitacao_id: string | null;
  fila_id: string | null;
  titulo: string;
  descricao: string | null;
  status: StatusTarefa;
  prioridade: Prioridade;
  responsavel_nome: string | null;
  prazo_at: string | null;
  concluida_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  solicitacao?: Solicitacao;
  fila?: Fila;
}

export interface ChecklistItem {
  id: string;
  tarefa_id: string;
  titulo: string;
  concluido: boolean;
  ordem: number;
  created_at: string;
}
