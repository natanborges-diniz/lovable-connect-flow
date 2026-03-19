export type TipoContato = 'cliente' | 'fornecedor' | 'loja' | 'colaborador';
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
