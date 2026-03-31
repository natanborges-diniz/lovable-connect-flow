export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      agendamentos: {
        Row: {
          atendimento_id: string | null
          cobranca_loja_enviada: boolean | null
          confirmacao_enviada: boolean | null
          contato_id: string
          created_at: string | null
          data_horario: string
          id: string
          lembrete_enviado: boolean | null
          loja_confirmou_presenca: boolean | null
          loja_nome: string
          loja_telefone: string | null
          metadata: Json | null
          noshow_agendar_para: string | null
          noshow_enviado: boolean | null
          numero_venda: string | null
          numeros_os: string[] | null
          observacoes: string | null
          status: string
          tentativas_cobranca_loja: number | null
          tentativas_lembrete: number | null
          tentativas_recuperacao: number | null
          updated_at: string | null
          valor_orcamento: number | null
          valor_venda: number | null
        }
        Insert: {
          atendimento_id?: string | null
          cobranca_loja_enviada?: boolean | null
          confirmacao_enviada?: boolean | null
          contato_id: string
          created_at?: string | null
          data_horario: string
          id?: string
          lembrete_enviado?: boolean | null
          loja_confirmou_presenca?: boolean | null
          loja_nome: string
          loja_telefone?: string | null
          metadata?: Json | null
          noshow_agendar_para?: string | null
          noshow_enviado?: boolean | null
          numero_venda?: string | null
          numeros_os?: string[] | null
          observacoes?: string | null
          status?: string
          tentativas_cobranca_loja?: number | null
          tentativas_lembrete?: number | null
          tentativas_recuperacao?: number | null
          updated_at?: string | null
          valor_orcamento?: number | null
          valor_venda?: number | null
        }
        Update: {
          atendimento_id?: string | null
          cobranca_loja_enviada?: boolean | null
          confirmacao_enviada?: boolean | null
          contato_id?: string
          created_at?: string | null
          data_horario?: string
          id?: string
          lembrete_enviado?: boolean | null
          loja_confirmou_presenca?: boolean | null
          loja_nome?: string
          loja_telefone?: string | null
          metadata?: Json | null
          noshow_agendar_para?: string | null
          noshow_enviado?: boolean | null
          numero_venda?: string | null
          numeros_os?: string[] | null
          observacoes?: string | null
          status?: string
          tentativas_cobranca_loja?: number | null
          tentativas_lembrete?: number | null
          tentativas_recuperacao?: number | null
          updated_at?: string | null
          valor_orcamento?: number | null
          valor_venda?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agendamentos_atendimento_id_fkey"
            columns: ["atendimento_id"]
            isOneToOne: false
            referencedRelation: "atendimentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agendamentos_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      atendimentos: {
        Row: {
          atendente_nome: string | null
          canal: Database["public"]["Enums"]["tipo_canal"]
          canal_provedor: string | null
          contato_id: string
          created_at: string
          fila_id: string | null
          fim_at: string | null
          id: string
          inicio_at: string | null
          metadata: Json | null
          modo: string
          solicitacao_id: string
          status: Database["public"]["Enums"]["status_atendimento"]
          updated_at: string
        }
        Insert: {
          atendente_nome?: string | null
          canal?: Database["public"]["Enums"]["tipo_canal"]
          canal_provedor?: string | null
          contato_id: string
          created_at?: string
          fila_id?: string | null
          fim_at?: string | null
          id?: string
          inicio_at?: string | null
          metadata?: Json | null
          modo?: string
          solicitacao_id: string
          status?: Database["public"]["Enums"]["status_atendimento"]
          updated_at?: string
        }
        Update: {
          atendente_nome?: string | null
          canal?: Database["public"]["Enums"]["tipo_canal"]
          canal_provedor?: string | null
          contato_id?: string
          created_at?: string
          fila_id?: string | null
          fim_at?: string | null
          id?: string
          inicio_at?: string | null
          metadata?: Json | null
          modo?: string
          solicitacao_id?: string
          status?: Database["public"]["Enums"]["status_atendimento"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "atendimentos_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atendimentos_fila_id_fkey"
            columns: ["fila_id"]
            isOneToOne: false
            referencedRelation: "filas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atendimentos_solicitacao_id_fkey"
            columns: ["solicitacao_id"]
            isOneToOne: false
            referencedRelation: "solicitacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_menu_opcoes: {
        Row: {
          ativo: boolean
          chave: string
          created_at: string
          descricao: string | null
          emoji: string
          fluxo: string
          id: string
          ordem: number
          titulo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          chave: string
          created_at?: string
          descricao?: string | null
          emoji?: string
          fluxo: string
          id?: string
          ordem?: number
          titulo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          chave?: string
          created_at?: string
          descricao?: string | null
          emoji?: string
          fluxo?: string
          id?: string
          ordem?: number
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      bot_sessoes: {
        Row: {
          atendimento_id: string
          created_at: string | null
          dados: Json | null
          etapa: string
          fluxo: string
          id: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          atendimento_id: string
          created_at?: string | null
          dados?: Json | null
          etapa?: string
          fluxo?: string
          id?: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          atendimento_id?: string
          created_at?: string | null
          dados?: Json | null
          etapa?: string
          fluxo?: string
          id?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      canais: {
        Row: {
          ativo: boolean | null
          contato_id: string
          created_at: string
          id: string
          identificador: string
          metadata: Json | null
          principal: boolean
          provedor: string | null
          tipo: Database["public"]["Enums"]["tipo_canal"]
        }
        Insert: {
          ativo?: boolean | null
          contato_id: string
          created_at?: string
          id?: string
          identificador: string
          metadata?: Json | null
          principal?: boolean
          provedor?: string | null
          tipo: Database["public"]["Enums"]["tipo_canal"]
        }
        Update: {
          ativo?: boolean | null
          contato_id?: string
          created_at?: string
          id?: string
          identificador?: string
          metadata?: Json | null
          principal?: boolean
          provedor?: string | null
          tipo?: Database["public"]["Enums"]["tipo_canal"]
        }
        Relationships: [
          {
            foreignKeyName: "canais_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          concluido: boolean
          created_at: string
          id: string
          ordem: number
          tarefa_id: string
          titulo: string
        }
        Insert: {
          concluido?: boolean
          created_at?: string
          id?: string
          ordem?: number
          tarefa_id: string
          titulo: string
        }
        Update: {
          concluido?: boolean
          created_at?: string
          id?: string
          ordem?: number
          tarefa_id?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes_ia: {
        Row: {
          chave: string
          id: string
          updated_at: string
          valor: string
        }
        Insert: {
          chave: string
          id?: string
          updated_at?: string
          valor?: string
        }
        Update: {
          chave?: string
          id?: string
          updated_at?: string
          valor?: string
        }
        Relationships: []
      }
      conhecimento_ia: {
        Row: {
          ativo: boolean
          categoria: string
          conteudo: Json
          created_at: string
          id: string
          titulo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria?: string
          conteudo?: Json
          created_at?: string
          id?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria?: string
          conteudo?: Json
          created_at?: string
          id?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      contatos: {
        Row: {
          ativo: boolean
          created_at: string
          documento: string | null
          email: string | null
          estagio: Database["public"]["Enums"]["estagio_funil"]
          id: string
          metadata: Json | null
          nome: string
          pipeline_coluna_id: string | null
          setor_destino: string | null
          tags: string[] | null
          telefone: string | null
          tipo: Database["public"]["Enums"]["tipo_contato"]
          ultimo_contato_at: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          documento?: string | null
          email?: string | null
          estagio?: Database["public"]["Enums"]["estagio_funil"]
          id?: string
          metadata?: Json | null
          nome: string
          pipeline_coluna_id?: string | null
          setor_destino?: string | null
          tags?: string[] | null
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["tipo_contato"]
          ultimo_contato_at?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          documento?: string | null
          email?: string | null
          estagio?: Database["public"]["Enums"]["estagio_funil"]
          id?: string
          metadata?: Json | null
          nome?: string
          pipeline_coluna_id?: string | null
          setor_destino?: string | null
          tags?: string[] | null
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["tipo_contato"]
          ultimo_contato_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contatos_pipeline_coluna_id_fkey"
            columns: ["pipeline_coluna_id"]
            isOneToOne: false
            referencedRelation: "pipeline_colunas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contatos_setor_destino_fkey"
            columns: ["setor_destino"]
            isOneToOne: false
            referencedRelation: "setores"
            referencedColumns: ["id"]
          },
        ]
      }
      contatos_homologacao: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          id: string
          telefone: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          telefone: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          telefone?: string
        }
        Relationships: []
      }
      eventos_crm: {
        Row: {
          contato_id: string
          created_at: string
          descricao: string | null
          id: string
          metadata: Json | null
          referencia_id: string | null
          referencia_tipo: string | null
          tipo: string
        }
        Insert: {
          contato_id: string
          created_at?: string
          descricao?: string | null
          id?: string
          metadata?: Json | null
          referencia_id?: string | null
          referencia_tipo?: string | null
          tipo: string
        }
        Update: {
          contato_id?: string
          created_at?: string
          descricao?: string | null
          id?: string
          metadata?: Json | null
          referencia_id?: string | null
          referencia_tipo?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "eventos_crm_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      filas: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          id: string
          metadata: Json | null
          nome: string
          setor_id: string
          sla_minutos: number | null
          tipo: Database["public"]["Enums"]["tipo_fila"]
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          metadata?: Json | null
          nome: string
          setor_id: string
          sla_minutos?: number | null
          tipo: Database["public"]["Enums"]["tipo_fila"]
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          metadata?: Json | null
          nome?: string
          setor_id?: string
          sla_minutos?: number | null
          tipo?: Database["public"]["Enums"]["tipo_fila"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "filas_setor_id_fkey"
            columns: ["setor_id"]
            isOneToOne: false
            referencedRelation: "setores"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_exemplos: {
        Row: {
          ativo: boolean | null
          categoria: string
          created_at: string | null
          id: string
          pergunta: string
          resposta_ideal: string
        }
        Insert: {
          ativo?: boolean | null
          categoria?: string
          created_at?: string | null
          id?: string
          pergunta: string
          resposta_ideal: string
        }
        Update: {
          ativo?: boolean | null
          categoria?: string
          created_at?: string | null
          id?: string
          pergunta?: string
          resposta_ideal?: string
        }
        Relationships: []
      }
      ia_feedbacks: {
        Row: {
          atendimento_id: string
          avaliacao: string
          avaliador_id: string | null
          created_at: string | null
          id: string
          mensagem_id: string
          motivo: string | null
          resposta_corrigida: string | null
        }
        Insert: {
          atendimento_id: string
          avaliacao: string
          avaliador_id?: string | null
          created_at?: string | null
          id?: string
          mensagem_id: string
          motivo?: string | null
          resposta_corrigida?: string | null
        }
        Update: {
          atendimento_id?: string
          avaliacao?: string
          avaliador_id?: string | null
          created_at?: string | null
          id?: string
          mensagem_id?: string
          motivo?: string | null
          resposta_corrigida?: string | null
        }
        Relationships: []
      }
      ia_regras_proibidas: {
        Row: {
          ativo: boolean
          categoria: string
          created_at: string
          id: string
          regra: string
        }
        Insert: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          id?: string
          regra: string
        }
        Update: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          id?: string
          regra?: string
        }
        Relationships: []
      }
      mensagens: {
        Row: {
          atendimento_id: string
          conteudo: string
          created_at: string
          direcao: Database["public"]["Enums"]["direcao_mensagem"]
          id: string
          metadata: Json | null
          provedor: string | null
          remetente_nome: string | null
          tipo_conteudo: string
        }
        Insert: {
          atendimento_id: string
          conteudo: string
          created_at?: string
          direcao?: Database["public"]["Enums"]["direcao_mensagem"]
          id?: string
          metadata?: Json | null
          provedor?: string | null
          remetente_nome?: string | null
          tipo_conteudo?: string
        }
        Update: {
          atendimento_id?: string
          conteudo?: string
          created_at?: string
          direcao?: Database["public"]["Enums"]["direcao_mensagem"]
          id?: string
          metadata?: Json | null
          provedor?: string | null
          remetente_nome?: string | null
          tipo_conteudo?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_atendimento_id_fkey"
            columns: ["atendimento_id"]
            isOneToOne: false
            referencedRelation: "atendimentos"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_automacoes: {
        Row: {
          ativo: boolean
          config: Json
          created_at: string
          entidade: string
          id: string
          ordem: number
          pipeline_coluna_id: string | null
          status_alvo: string | null
          tipo_acao: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          config?: Json
          created_at?: string
          entidade?: string
          id?: string
          ordem?: number
          pipeline_coluna_id?: string | null
          status_alvo?: string | null
          tipo_acao: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          config?: Json
          created_at?: string
          entidade?: string
          id?: string
          ordem?: number
          pipeline_coluna_id?: string | null
          status_alvo?: string | null
          tipo_acao?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_automacoes_pipeline_coluna_id_fkey"
            columns: ["pipeline_coluna_id"]
            isOneToOne: false
            referencedRelation: "pipeline_colunas"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_colunas: {
        Row: {
          ativo: boolean
          cor: string
          created_at: string
          id: string
          nome: string
          ordem: number
          setor_id: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cor?: string
          created_at?: string
          id?: string
          nome: string
          ordem?: number
          setor_id?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cor?: string
          created_at?: string
          id?: string
          nome?: string
          ordem?: number
          setor_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_colunas_setor_id_fkey"
            columns: ["setor_id"]
            isOneToOne: false
            referencedRelation: "setores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ativo: boolean
          avatar_url: string | null
          cargo: string | null
          created_at: string
          email: string | null
          id: string
          nome: string
          setor_id: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          avatar_url?: string | null
          cargo?: string | null
          created_at?: string
          email?: string | null
          id: string
          nome: string
          setor_id?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          avatar_url?: string | null
          cargo?: string | null
          created_at?: string
          email?: string | null
          id?: string
          nome?: string
          setor_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_setor_id_fkey"
            columns: ["setor_id"]
            isOneToOne: false
            referencedRelation: "setores"
            referencedColumns: ["id"]
          },
        ]
      }
      setores: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          id: string
          metadata: Json | null
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          metadata?: Json | null
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          metadata?: Json | null
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      solicitacoes: {
        Row: {
          assunto: string
          canal_origem: Database["public"]["Enums"]["tipo_canal"]
          classificacao_ia: Json | null
          contato_id: string
          created_at: string
          descricao: string | null
          id: string
          metadata: Json | null
          pipeline_coluna_id: string | null
          prioridade: Database["public"]["Enums"]["prioridade"]
          status: Database["public"]["Enums"]["status_solicitacao"]
          tipo: string | null
          updated_at: string
        }
        Insert: {
          assunto: string
          canal_origem?: Database["public"]["Enums"]["tipo_canal"]
          classificacao_ia?: Json | null
          contato_id: string
          created_at?: string
          descricao?: string | null
          id?: string
          metadata?: Json | null
          pipeline_coluna_id?: string | null
          prioridade?: Database["public"]["Enums"]["prioridade"]
          status?: Database["public"]["Enums"]["status_solicitacao"]
          tipo?: string | null
          updated_at?: string
        }
        Update: {
          assunto?: string
          canal_origem?: Database["public"]["Enums"]["tipo_canal"]
          classificacao_ia?: Json | null
          contato_id?: string
          created_at?: string
          descricao?: string | null
          id?: string
          metadata?: Json | null
          pipeline_coluna_id?: string | null
          prioridade?: Database["public"]["Enums"]["prioridade"]
          status?: Database["public"]["Enums"]["status_solicitacao"]
          tipo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitacoes_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacoes_pipeline_coluna_id_fkey"
            columns: ["pipeline_coluna_id"]
            isOneToOne: false
            referencedRelation: "pipeline_colunas"
            referencedColumns: ["id"]
          },
        ]
      }
      tarefas: {
        Row: {
          concluida_at: string | null
          created_at: string
          descricao: string | null
          fila_id: string | null
          id: string
          metadata: Json | null
          prazo_at: string | null
          prioridade: Database["public"]["Enums"]["prioridade"]
          responsavel_nome: string | null
          solicitacao_id: string | null
          status: Database["public"]["Enums"]["status_tarefa"]
          titulo: string
          updated_at: string
        }
        Insert: {
          concluida_at?: string | null
          created_at?: string
          descricao?: string | null
          fila_id?: string | null
          id?: string
          metadata?: Json | null
          prazo_at?: string | null
          prioridade?: Database["public"]["Enums"]["prioridade"]
          responsavel_nome?: string | null
          solicitacao_id?: string | null
          status?: Database["public"]["Enums"]["status_tarefa"]
          titulo: string
          updated_at?: string
        }
        Update: {
          concluida_at?: string | null
          created_at?: string
          descricao?: string | null
          fila_id?: string | null
          id?: string
          metadata?: Json | null
          prazo_at?: string | null
          prioridade?: Database["public"]["Enums"]["prioridade"]
          responsavel_nome?: string | null
          solicitacao_id?: string | null
          status?: Database["public"]["Enums"]["status_tarefa"]
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefas_fila_id_fkey"
            columns: ["fila_id"]
            isOneToOne: false
            referencedRelation: "filas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_solicitacao_id_fkey"
            columns: ["solicitacao_id"]
            isOneToOne: false
            referencedRelation: "solicitacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      telefones_lojas: {
        Row: {
          ativo: boolean | null
          cod_empresa: string | null
          created_at: string | null
          departamento: string | null
          endereco: string | null
          horario_abertura: string | null
          horario_fechamento: string | null
          id: string
          nome_loja: string
          telefone: string
        }
        Insert: {
          ativo?: boolean | null
          cod_empresa?: string | null
          created_at?: string | null
          departamento?: string | null
          endereco?: string | null
          horario_abertura?: string | null
          horario_fechamento?: string | null
          id?: string
          nome_loja: string
          telefone: string
        }
        Update: {
          ativo?: boolean | null
          cod_empresa?: string | null
          created_at?: string | null
          departamento?: string | null
          endereco?: string | null
          horario_abertura?: string | null
          horario_fechamento?: string | null
          id?: string
          nome_loja?: string
          telefone?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      direcao_mensagem: "inbound" | "outbound" | "internal"
      estagio_funil: "lead" | "qualificado" | "proposta" | "fechado" | "perdido"
      prioridade: "critica" | "alta" | "normal" | "baixa"
      status_atendimento: "aguardando" | "em_atendimento" | "encerrado"
      status_solicitacao:
        | "aberta"
        | "classificada"
        | "em_atendimento"
        | "aguardando_execucao"
        | "concluida"
        | "cancelada"
        | "reaberta"
      status_tarefa: "pendente" | "em_andamento" | "concluida" | "cancelada"
      tipo_canal: "whatsapp" | "sistema" | "email" | "telefone"
      tipo_contato: "cliente" | "fornecedor" | "loja" | "colaborador"
      tipo_fila: "atendimento" | "execucao"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      direcao_mensagem: ["inbound", "outbound", "internal"],
      estagio_funil: ["lead", "qualificado", "proposta", "fechado", "perdido"],
      prioridade: ["critica", "alta", "normal", "baixa"],
      status_atendimento: ["aguardando", "em_atendimento", "encerrado"],
      status_solicitacao: [
        "aberta",
        "classificada",
        "em_atendimento",
        "aguardando_execucao",
        "concluida",
        "cancelada",
        "reaberta",
      ],
      status_tarefa: ["pendente", "em_andamento", "concluida", "cancelada"],
      tipo_canal: ["whatsapp", "sistema", "email", "telefone"],
      tipo_contato: ["cliente", "fornecedor", "loja", "colaborador"],
      tipo_fila: ["atendimento", "execucao"],
    },
  },
} as const
