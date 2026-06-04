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
      app_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      atendimentos: {
        Row: {
          atendente_nome: string | null
          atendente_user_id: string | null
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
          atendente_user_id?: string | null
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
          atendente_user_id?: string | null
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
      autorizacoes_excecao: {
        Row: {
          autorizador_id: string
          autorizador_nome: string | null
          autorizador_role: string | null
          contexto: Json
          created_at: string
          id: string
          justificativa_resposta: string | null
          motivo_solicitacao: string | null
          processo_chave: string
          referencia_id: string
          referencia_tipo: string
          respondido_at: string | null
          solicitante_id: string
          solicitante_nome: string | null
          status: string
          updated_at: string
        }
        Insert: {
          autorizador_id: string
          autorizador_nome?: string | null
          autorizador_role?: string | null
          contexto?: Json
          created_at?: string
          id?: string
          justificativa_resposta?: string | null
          motivo_solicitacao?: string | null
          processo_chave: string
          referencia_id: string
          referencia_tipo: string
          respondido_at?: string | null
          solicitante_id: string
          solicitante_nome?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          autorizador_id?: string
          autorizador_nome?: string | null
          autorizador_role?: string | null
          contexto?: Json
          created_at?: string
          id?: string
          justificativa_resposta?: string | null
          motivo_solicitacao?: string | null
          processo_chave?: string
          referencia_id?: string
          referencia_tipo?: string
          respondido_at?: string | null
          solicitante_id?: string
          solicitante_nome?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      bot_fluxos: {
        Row: {
          acao_final: Json
          ativo: boolean
          chave: string
          created_at: string
          descricao: string | null
          etapas: Json
          id: string
          nome: string
          setor_destino_id: string | null
          tipo_bot: string
          updated_at: string
        }
        Insert: {
          acao_final?: Json
          ativo?: boolean
          chave: string
          created_at?: string
          descricao?: string | null
          etapas?: Json
          id?: string
          nome: string
          setor_destino_id?: string | null
          tipo_bot?: string
          updated_at?: string
        }
        Update: {
          acao_final?: Json
          ativo?: boolean
          chave?: string
          created_at?: string
          descricao?: string | null
          etapas?: Json
          id?: string
          nome?: string
          setor_destino_id?: string | null
          tipo_bot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_fluxos_setor_destino_id_fkey"
            columns: ["setor_destino_id"]
            isOneToOne: false
            referencedRelation: "setores"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_menu_opcoes: {
        Row: {
          ativo: boolean
          cargos_visiveis: string[]
          chave: string
          created_at: string
          descricao: string | null
          emoji: string
          fluxo: string
          id: string
          ordem: number
          parent_id: string | null
          setor_id: string | null
          tipo: string
          tipo_bot: string
          titulo: string
          updated_at: string
          usuarios_visiveis: string[]
        }
        Insert: {
          ativo?: boolean
          cargos_visiveis?: string[]
          chave: string
          created_at?: string
          descricao?: string | null
          emoji?: string
          fluxo: string
          id?: string
          ordem?: number
          parent_id?: string | null
          setor_id?: string | null
          tipo?: string
          tipo_bot?: string
          titulo: string
          updated_at?: string
          usuarios_visiveis?: string[]
        }
        Update: {
          ativo?: boolean
          cargos_visiveis?: string[]
          chave?: string
          created_at?: string
          descricao?: string | null
          emoji?: string
          fluxo?: string
          id?: string
          ordem?: number
          parent_id?: string | null
          setor_id?: string | null
          tipo?: string
          tipo_bot?: string
          titulo?: string
          updated_at?: string
          usuarios_visiveis?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "bot_menu_opcoes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "bot_menu_opcoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_menu_opcoes_setor_id_fkey"
            columns: ["setor_id"]
            isOneToOne: false
            referencedRelation: "setores"
            referencedColumns: ["id"]
          },
        ]
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
      cashback_config: {
        Row: {
          atualizado_em: string
          fator_resgate: number
          id: string
          percentual: number
          prorrogacao_dias: number
          validade_dias: number
        }
        Insert: {
          atualizado_em?: string
          fator_resgate?: number
          id?: string
          percentual?: number
          prorrogacao_dias?: number
          validade_dias?: number
        }
        Update: {
          atualizado_em?: string
          fator_resgate?: number
          id?: string
          percentual?: number
          prorrogacao_dias?: number
          validade_dias?: number
        }
        Relationships: []
      }
      cashback_credito: {
        Row: {
          contato_id: string | null
          criado_em: string
          data_expiracao: string | null
          data_geracao: string | null
          id: string
          inscricao_id: string | null
          liberado_em: string | null
          prorrogado: boolean
          saldo: number | null
          status: string
          valor_base: number | null
          valor_gerado: number | null
        }
        Insert: {
          contato_id?: string | null
          criado_em?: string
          data_expiracao?: string | null
          data_geracao?: string | null
          id?: string
          inscricao_id?: string | null
          liberado_em?: string | null
          prorrogado?: boolean
          saldo?: number | null
          status?: string
          valor_base?: number | null
          valor_gerado?: number | null
        }
        Update: {
          contato_id?: string | null
          criado_em?: string
          data_expiracao?: string | null
          data_geracao?: string | null
          id?: string
          inscricao_id?: string | null
          liberado_em?: string | null
          prorrogado?: boolean
          saldo?: number | null
          status?: string
          valor_base?: number | null
          valor_gerado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cashback_credito_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashback_credito_inscricao_id_fkey"
            columns: ["inscricao_id"]
            isOneToOne: false
            referencedRelation: "regua_inscricao"
            referencedColumns: ["id"]
          },
        ]
      }
      cashback_resgate: {
        Row: {
          contato_id: string | null
          credito_id: string | null
          data_uso: string
          id: string
          numero_venda_uso: string | null
          valor_usado: number | null
        }
        Insert: {
          contato_id?: string | null
          credito_id?: string | null
          data_uso?: string
          id?: string
          numero_venda_uso?: string | null
          valor_usado?: number | null
        }
        Update: {
          contato_id?: string | null
          credito_id?: string | null
          data_uso?: string
          id?: string
          numero_venda_uso?: string | null
          valor_usado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cashback_resgate_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashback_resgate_credito_id_fkey"
            columns: ["credito_id"]
            isOneToOne: false
            referencedRelation: "cashback_credito"
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
      confirmacoes_estoque: {
        Row: {
          codigo_produto: string
          created_at: string
          demanda_id: string | null
          descricao_peca: string | null
          foto_url: string | null
          id: string
          loja_nome: string
          loja_telefone: string | null
          metadata: Json
          numero_curto: number
          observacao_estoque: string | null
          pipeline_coluna_id: string | null
          protocolo: string
          proximo_lembrete_at: string | null
          referencia: string
          respondida_at: string | null
          respondida_por: string | null
          resposta_loja: string | null
          resposta_observacao: string | null
          solicitante_id: string | null
          solicitante_nome: string | null
          status: string
          tentativas_lembrete: number
          updated_at: string
        }
        Insert: {
          codigo_produto: string
          created_at?: string
          demanda_id?: string | null
          descricao_peca?: string | null
          foto_url?: string | null
          id?: string
          loja_nome: string
          loja_telefone?: string | null
          metadata?: Json
          numero_curto?: number
          observacao_estoque?: string | null
          pipeline_coluna_id?: string | null
          protocolo: string
          proximo_lembrete_at?: string | null
          referencia: string
          respondida_at?: string | null
          respondida_por?: string | null
          resposta_loja?: string | null
          resposta_observacao?: string | null
          solicitante_id?: string | null
          solicitante_nome?: string | null
          status?: string
          tentativas_lembrete?: number
          updated_at?: string
        }
        Update: {
          codigo_produto?: string
          created_at?: string
          demanda_id?: string | null
          descricao_peca?: string | null
          foto_url?: string | null
          id?: string
          loja_nome?: string
          loja_telefone?: string | null
          metadata?: Json
          numero_curto?: number
          observacao_estoque?: string | null
          pipeline_coluna_id?: string | null
          protocolo?: string
          proximo_lembrete_at?: string | null
          referencia?: string
          respondida_at?: string | null
          respondida_por?: string | null
          resposta_loja?: string | null
          resposta_observacao?: string | null
          solicitante_id?: string | null
          solicitante_nome?: string | null
          status?: string
          tentativas_lembrete?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "confirmacoes_estoque_pipeline_coluna_id_fkey"
            columns: ["pipeline_coluna_id"]
            isOneToOne: false
            referencedRelation: "pipeline_colunas"
            referencedColumns: ["id"]
          },
        ]
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
      contato_ponte: {
        Row: {
          ativo: boolean
          contato_id: string
          conversa_id: string
          created_at: string
          id: string
          responsavel_user_id: string
          setor_id: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          contato_id: string
          conversa_id: string
          created_at?: string
          id?: string
          responsavel_user_id: string
          setor_id?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          contato_id?: string
          conversa_id?: string
          created_at?: string
          id?: string
          responsavel_user_id?: string
          setor_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      contatos: {
        Row: {
          ativo: boolean
          ciclo_funil: number
          created_at: string
          data_nascimento: string | null
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
          ciclo_funil?: number
          created_at?: string
          data_nascimento?: string | null
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
          ciclo_funil?: number
          created_at?: string
          data_nascimento?: string | null
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
      conversas_grupo: {
        Row: {
          avatar_url: string | null
          created_at: string
          criado_por: string
          id: string
          nome: string
          origem_ref: string | null
          participantes: string[]
          tipo_origem: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          criado_por: string
          id?: string
          nome: string
          origem_ref?: string | null
          participantes?: string[]
          tipo_origem?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          criado_por?: string
          id?: string
          nome?: string
          origem_ref?: string | null
          participantes?: string[]
          tipo_origem?: string
          updated_at?: string
        }
        Relationships: []
      }
      cron_jobs: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          expressao_cron: string
          funcao_alvo: string
          id: string
          nome: string
          payload: Json
          pg_cron_job_id: number | null
          ultimo_disparo: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          expressao_cron?: string
          funcao_alvo: string
          id?: string
          nome: string
          payload?: Json
          pg_cron_job_id?: number | null
          ultimo_disparo?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          expressao_cron?: string
          funcao_alvo?: string
          id?: string
          nome?: string
          payload?: Json
          pg_cron_job_id?: number | null
          ultimo_disparo?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      demanda_mensagens: {
        Row: {
          anexo_mime: string | null
          anexo_url: string | null
          autor_id: string | null
          autor_nome: string | null
          conteudo: string
          created_at: string
          deletada_at: string | null
          deletada_por: string | null
          demanda_id: string
          direcao: string
          editada_at: string | null
          encaminhada_ao_cliente: boolean
          id: string
          metadata: Json | null
          tipo_conteudo: string
          visto_pela_loja_at: string | null
          visto_por_loja_user_id: string | null
        }
        Insert: {
          anexo_mime?: string | null
          anexo_url?: string | null
          autor_id?: string | null
          autor_nome?: string | null
          conteudo: string
          created_at?: string
          deletada_at?: string | null
          deletada_por?: string | null
          demanda_id: string
          direcao: string
          editada_at?: string | null
          encaminhada_ao_cliente?: boolean
          id?: string
          metadata?: Json | null
          tipo_conteudo?: string
          visto_pela_loja_at?: string | null
          visto_por_loja_user_id?: string | null
        }
        Update: {
          anexo_mime?: string | null
          anexo_url?: string | null
          autor_id?: string | null
          autor_nome?: string | null
          conteudo?: string
          created_at?: string
          deletada_at?: string | null
          deletada_por?: string | null
          demanda_id?: string
          direcao?: string
          editada_at?: string | null
          encaminhada_ao_cliente?: boolean
          id?: string
          metadata?: Json | null
          tipo_conteudo?: string
          visto_pela_loja_at?: string | null
          visto_por_loja_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demanda_mensagens_demanda_id_fkey"
            columns: ["demanda_id"]
            isOneToOne: false
            referencedRelation: "demandas_loja"
            referencedColumns: ["id"]
          },
        ]
      }
      demandas_loja: {
        Row: {
          assunto: string | null
          atendimento_cliente_id: string | null
          contato_cliente_id: string | null
          created_at: string
          encerrada_at: string | null
          id: string
          loja_nome: string
          loja_telefone: string
          metadata: Json | null
          numero_curto: number
          origem: string
          pergunta: string
          protocolo: string
          setor_destino_id: string | null
          solicitante_id: string | null
          solicitante_nome: string | null
          status: string
          tipo_chave: string | null
          ultima_mensagem_loja_at: string | null
          updated_at: string
          vista_pelo_operador: boolean
        }
        Insert: {
          assunto?: string | null
          atendimento_cliente_id?: string | null
          contato_cliente_id?: string | null
          created_at?: string
          encerrada_at?: string | null
          id?: string
          loja_nome: string
          loja_telefone: string
          metadata?: Json | null
          numero_curto?: number
          origem?: string
          pergunta: string
          protocolo: string
          setor_destino_id?: string | null
          solicitante_id?: string | null
          solicitante_nome?: string | null
          status?: string
          tipo_chave?: string | null
          ultima_mensagem_loja_at?: string | null
          updated_at?: string
          vista_pelo_operador?: boolean
        }
        Update: {
          assunto?: string | null
          atendimento_cliente_id?: string | null
          contato_cliente_id?: string | null
          created_at?: string
          encerrada_at?: string | null
          id?: string
          loja_nome?: string
          loja_telefone?: string
          metadata?: Json | null
          numero_curto?: number
          origem?: string
          pergunta?: string
          protocolo?: string
          setor_destino_id?: string | null
          solicitante_id?: string | null
          solicitante_nome?: string | null
          status?: string
          tipo_chave?: string | null
          ultima_mensagem_loja_at?: string | null
          updated_at?: string
          vista_pelo_operador?: boolean
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
      feriados: {
        Row: {
          ativo: boolean
          created_at: string
          data: string
          fecha_todas: boolean
          id: string
          metadata: Json
          nome: string
          recorrente: boolean
          tipo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          data: string
          fecha_todas?: boolean
          id?: string
          metadata?: Json
          nome: string
          recorrente?: boolean
          tipo?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          data?: string
          fecha_todas?: boolean
          id?: string
          metadata?: Json
          nome?: string
          recorrente?: boolean
          tipo?: string
          updated_at?: string
        }
        Relationships: []
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
      fluxo_responsaveis: {
        Row: {
          ativo: boolean
          created_at: string
          fluxo_chave: string
          id: string
          nome: string
          telefone: string
          tipo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          fluxo_chave: string
          id?: string
          nome: string
          telefone: string
          tipo?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          fluxo_chave?: string
          id?: string
          nome?: string
          telefone?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: []
      }
      ia_auditorias: {
        Row: {
          atendimento_id: string | null
          categorias: Json
          contato_id: string | null
          contato_nome: string | null
          contato_telefone: string | null
          created_at: string
          diagnostico: string | null
          flags_heuristicos: Json
          fonte: string
          id: string
          ignorado_at: string | null
          ignorado_motivo: string | null
          ignorado_por: string | null
          problemas: Json
          run_id: string
          score_global: number | null
          severidade: string
          status: string
          transcricao_resumo: string | null
          updated_at: string
        }
        Insert: {
          atendimento_id?: string | null
          categorias?: Json
          contato_id?: string | null
          contato_nome?: string | null
          contato_telefone?: string | null
          created_at?: string
          diagnostico?: string | null
          flags_heuristicos?: Json
          fonte?: string
          id?: string
          ignorado_at?: string | null
          ignorado_motivo?: string | null
          ignorado_por?: string | null
          problemas?: Json
          run_id: string
          score_global?: number | null
          severidade?: string
          status?: string
          transcricao_resumo?: string | null
          updated_at?: string
        }
        Update: {
          atendimento_id?: string | null
          categorias?: Json
          contato_id?: string | null
          contato_nome?: string | null
          contato_telefone?: string | null
          created_at?: string
          diagnostico?: string | null
          flags_heuristicos?: Json
          fonte?: string
          id?: string
          ignorado_at?: string | null
          ignorado_motivo?: string | null
          ignorado_por?: string | null
          problemas?: Json
          run_id?: string
          score_global?: number | null
          severidade?: string
          status?: string
          transcricao_resumo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ia_auditorias_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ia_auditorias_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_auditorias_acoes: {
        Row: {
          alvo_id: string | null
          alvo_tabela: string
          auditoria_id: string
          created_at: string
          desfeita: boolean
          desfeita_at: string | null
          desfeita_por: string | null
          id: string
          payload: Json
          tipo: string
        }
        Insert: {
          alvo_id?: string | null
          alvo_tabela: string
          auditoria_id: string
          created_at?: string
          desfeita?: boolean
          desfeita_at?: string | null
          desfeita_por?: string | null
          id?: string
          payload?: Json
          tipo: string
        }
        Update: {
          alvo_id?: string | null
          alvo_tabela?: string
          auditoria_id?: string
          created_at?: string
          desfeita?: boolean
          desfeita_at?: string | null
          desfeita_por?: string | null
          id?: string
          payload?: Json
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "ia_auditorias_acoes_auditoria_id_fkey"
            columns: ["auditoria_id"]
            isOneToOne: false
            referencedRelation: "ia_auditorias"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_auditorias_grupos: {
        Row: {
          acoes_propostas: Json
          applied_at: string | null
          auditoria_ids: string[]
          created_at: string
          descricao: string | null
          id: string
          ignorado_motivo: string | null
          run_id: string
          severidade: string
          status: string
          titulo: string
          updated_at: string
        }
        Insert: {
          acoes_propostas?: Json
          applied_at?: string | null
          auditoria_ids?: string[]
          created_at?: string
          descricao?: string | null
          id?: string
          ignorado_motivo?: string | null
          run_id: string
          severidade?: string
          status?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          acoes_propostas?: Json
          applied_at?: string | null
          auditoria_ids?: string[]
          created_at?: string
          descricao?: string | null
          id?: string
          ignorado_motivo?: string | null
          run_id?: string
          severidade?: string
          status?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      ia_auditorias_runs: {
        Row: {
          amostra_limpos_pct: number
          created_at: string
          erro: string | null
          finalizado_at: string | null
          id: string
          iniciado_por: string | null
          janela_fim: string
          janela_inicio: string
          metadata: Json
          severidade_minima: string
          status: string
          total_atendimentos: number
          total_avaliados_llm: number
          total_flagged: number
        }
        Insert: {
          amostra_limpos_pct?: number
          created_at?: string
          erro?: string | null
          finalizado_at?: string | null
          id?: string
          iniciado_por?: string | null
          janela_fim: string
          janela_inicio: string
          metadata?: Json
          severidade_minima?: string
          status?: string
          total_atendimentos?: number
          total_avaliados_llm?: number
          total_flagged?: number
        }
        Update: {
          amostra_limpos_pct?: number
          created_at?: string
          erro?: string | null
          finalizado_at?: string | null
          id?: string
          iniciado_por?: string | null
          janela_fim?: string
          janela_inicio?: string
          metadata?: Json
          severidade_minima?: string
          status?: string
          total_atendimentos?: number
          total_avaliados_llm?: number
          total_flagged?: number
        }
        Relationships: []
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
          atendimento_id: string | null
          avaliacao: string
          avaliador_id: string | null
          created_at: string | null
          id: string
          mensagem_id: string | null
          motivo: string | null
          resposta_corrigida: string | null
        }
        Insert: {
          atendimento_id?: string | null
          avaliacao: string
          avaliador_id?: string | null
          created_at?: string | null
          id?: string
          mensagem_id?: string | null
          motivo?: string | null
          resposta_corrigida?: string | null
        }
        Update: {
          atendimento_id?: string | null
          avaliacao?: string
          avaliador_id?: string | null
          created_at?: string | null
          id?: string
          mensagem_id?: string | null
          motivo?: string | null
          resposta_corrigida?: string | null
        }
        Relationships: []
      }
      ia_instrucoes_prompt: {
        Row: {
          ativo: boolean
          categoria: string
          created_at: string
          id: string
          instrucao: string
          origem: string
          origem_ref: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          id?: string
          instrucao: string
          origem?: string
          origem_ref?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          id?: string
          instrucao?: string
          origem?: string
          origem_ref?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ia_mensagens_fixas: {
        Row: {
          ativo: boolean
          chave: string
          created_at: string
          descricao: string | null
          texto: string
          updated_at: string
          updated_by: string | null
          variaveis: string[]
        }
        Insert: {
          ativo?: boolean
          chave: string
          created_at?: string
          descricao?: string | null
          texto: string
          updated_at?: string
          updated_by?: string | null
          variaveis?: string[]
        }
        Update: {
          ativo?: boolean
          chave?: string
          created_at?: string
          descricao?: string | null
          texto?: string
          updated_at?: string
          updated_by?: string | null
          variaveis?: string[]
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
      lembretes: {
        Row: {
          atendimento_id: string | null
          contato_id: string
          created_at: string
          data_disparo: string
          id: string
          mensagem: string
          status: string
          updated_at: string
        }
        Insert: {
          atendimento_id?: string | null
          contato_id: string
          created_at?: string
          data_disparo: string
          id?: string
          mensagem: string
          status?: string
          updated_at?: string
        }
        Update: {
          atendimento_id?: string | null
          contato_id?: string
          created_at?: string
          data_disparo?: string
          id?: string
          mensagem?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lembretes_atendimento_id_fkey"
            columns: ["atendimento_id"]
            isOneToOne: false
            referencedRelation: "atendimentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lembretes_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      loja_feriado_politica: {
        Row: {
          ativo: boolean
          created_at: string
          escopo: string
          feriado_id: string | null
          horario_custom: Json | null
          id: string
          loja_id: string
          politica: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          escopo: string
          feriado_id?: string | null
          horario_custom?: Json | null
          id?: string
          loja_id: string
          politica: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          escopo?: string
          feriado_id?: string | null
          horario_custom?: Json | null
          id?: string
          loja_id?: string
          politica?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loja_feriado_politica_feriado_id_fkey"
            columns: ["feriado_id"]
            isOneToOne: false
            referencedRelation: "feriados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loja_feriado_politica_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "telefones_lojas"
            referencedColumns: ["id"]
          },
        ]
      }
      lojas_cidades: {
        Row: {
          ativo: boolean
          cidade: string
          created_at: string
          id: string
          loja_id: string
          loja_nome: string
          regiao: string | null
        }
        Insert: {
          ativo?: boolean
          cidade: string
          created_at?: string
          id?: string
          loja_id: string
          loja_nome: string
          regiao?: string | null
        }
        Update: {
          ativo?: boolean
          cidade?: string
          created_at?: string
          id?: string
          loja_id?: string
          loja_nome?: string
          regiao?: string | null
        }
        Relationships: []
      }
      mensagens: {
        Row: {
          atendimento_id: string
          conteudo: string
          created_at: string
          deletada_at: string | null
          deletada_por: string | null
          direcao: Database["public"]["Enums"]["direcao_mensagem"]
          editada_at: string | null
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
          deletada_at?: string | null
          deletada_por?: string | null
          direcao?: Database["public"]["Enums"]["direcao_mensagem"]
          editada_at?: string | null
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
          deletada_at?: string | null
          deletada_por?: string | null
          direcao?: Database["public"]["Enums"]["direcao_mensagem"]
          editada_at?: string | null
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
      mensagens_internas: {
        Row: {
          anexo_tipo: string | null
          anexo_url: string | null
          conteudo: string
          conversa_id: string
          created_at: string
          deletada_at: string | null
          deletada_por: string | null
          destinatario_id: string
          editada_at: string | null
          id: string
          lida: boolean
          metadata: Json
          remetente_id: string
        }
        Insert: {
          anexo_tipo?: string | null
          anexo_url?: string | null
          conteudo: string
          conversa_id: string
          created_at?: string
          deletada_at?: string | null
          deletada_por?: string | null
          destinatario_id: string
          editada_at?: string | null
          id?: string
          lida?: boolean
          metadata?: Json
          remetente_id: string
        }
        Update: {
          anexo_tipo?: string | null
          anexo_url?: string | null
          conteudo?: string
          conversa_id?: string
          created_at?: string
          deletada_at?: string | null
          deletada_por?: string | null
          destinatario_id?: string
          editada_at?: string | null
          id?: string
          lida?: boolean
          metadata?: Json
          remetente_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_internas_destinatario_id_fkey"
            columns: ["destinatario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_internas_remetente_id_fkey"
            columns: ["remetente_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes: {
        Row: {
          created_at: string
          id: string
          lida: boolean
          mensagem: string | null
          referencia_id: string | null
          setor_id: string | null
          tipo: string
          titulo: string
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lida?: boolean
          mensagem?: string | null
          referencia_id?: string | null
          setor_id?: string | null
          tipo?: string
          titulo: string
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lida?: boolean
          mensagem?: string | null
          referencia_id?: string | null
          setor_id?: string | null
          tipo?: string
          titulo?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_setor_id_fkey"
            columns: ["setor_id"]
            isOneToOne: false
            referencedRelation: "setores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pagamentos_link: {
        Row: {
          alias_loja: string | null
          atendimento_id: string | null
          authorization_code: string | null
          bandeira: string | null
          cliente_nome: string | null
          cliente_telefone: string | null
          cod_empresa: string | null
          comprovante_anexo_id: string | null
          comprovante_recebido_at: string | null
          contato_id: string | null
          created_at: string
          descricao: string | null
          enviado_at: string | null
          expirado_at: string | null
          id: string
          last4: string | null
          link_url: string | null
          loja_nome: string | null
          metadata: Json
          nsu: string | null
          pago_at: string | null
          parcelas: number | null
          payment_link_id: string
          solicitacao_id: string | null
          status: string
          tid: string | null
          updated_at: string
          valor: number | null
        }
        Insert: {
          alias_loja?: string | null
          atendimento_id?: string | null
          authorization_code?: string | null
          bandeira?: string | null
          cliente_nome?: string | null
          cliente_telefone?: string | null
          cod_empresa?: string | null
          comprovante_anexo_id?: string | null
          comprovante_recebido_at?: string | null
          contato_id?: string | null
          created_at?: string
          descricao?: string | null
          enviado_at?: string | null
          expirado_at?: string | null
          id?: string
          last4?: string | null
          link_url?: string | null
          loja_nome?: string | null
          metadata?: Json
          nsu?: string | null
          pago_at?: string | null
          parcelas?: number | null
          payment_link_id: string
          solicitacao_id?: string | null
          status?: string
          tid?: string | null
          updated_at?: string
          valor?: number | null
        }
        Update: {
          alias_loja?: string | null
          atendimento_id?: string | null
          authorization_code?: string | null
          bandeira?: string | null
          cliente_nome?: string | null
          cliente_telefone?: string | null
          cod_empresa?: string | null
          comprovante_anexo_id?: string | null
          comprovante_recebido_at?: string | null
          contato_id?: string | null
          created_at?: string
          descricao?: string | null
          enviado_at?: string | null
          expirado_at?: string | null
          id?: string
          last4?: string | null
          link_url?: string | null
          loja_nome?: string | null
          metadata?: Json
          nsu?: string | null
          pago_at?: string | null
          parcelas?: number | null
          payment_link_id?: string
          solicitacao_id?: string | null
          status?: string
          tid?: string | null
          updated_at?: string
          valor?: number | null
        }
        Relationships: []
      }
      pagamentos_link_eventos: {
        Row: {
          created_at: string
          id: string
          pagamento_id: string
          payload: Json
          status_anterior: string | null
          status_novo: string
        }
        Insert: {
          created_at?: string
          id?: string
          pagamento_id: string
          payload?: Json
          status_anterior?: string | null
          status_novo: string
        }
        Update: {
          created_at?: string
          id?: string
          pagamento_id?: string
          payload?: Json
          status_anterior?: string | null
          status_novo?: string
        }
        Relationships: [
          {
            foreignKeyName: "pagamentos_link_eventos_pagamento_id_fkey"
            columns: ["pagamento_id"]
            isOneToOne: false
            referencedRelation: "pagamentos_link"
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
      pipeline_card_eventos: {
        Row: {
          coluna_anterior_id: string | null
          coluna_nova_id: string | null
          created_at: string
          descricao: string | null
          entidade: string
          entidade_id: string
          id: string
          metadata: Json
          tipo: string
          usuario_id: string | null
          usuario_nome: string | null
        }
        Insert: {
          coluna_anterior_id?: string | null
          coluna_nova_id?: string | null
          created_at?: string
          descricao?: string | null
          entidade: string
          entidade_id: string
          id?: string
          metadata?: Json
          tipo: string
          usuario_id?: string | null
          usuario_nome?: string | null
        }
        Update: {
          coluna_anterior_id?: string | null
          coluna_nova_id?: string | null
          created_at?: string
          descricao?: string | null
          entidade?: string
          entidade_id?: string
          id?: string
          metadata?: Json
          tipo?: string
          usuario_id?: string | null
          usuario_nome?: string | null
        }
        Relationships: []
      }
      pipeline_colunas: {
        Row: {
          ativo: boolean
          cor: string
          created_at: string
          grupo_funil: string | null
          id: string
          nome: string
          ordem: number
          setor_id: string | null
          tipo_acao: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cor?: string
          created_at?: string
          grupo_funil?: string | null
          id?: string
          nome: string
          ordem?: number
          setor_id?: string | null
          tipo_acao?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cor?: string
          created_at?: string
          grupo_funil?: string | null
          id?: string
          nome?: string
          ordem?: number
          setor_id?: string | null
          tipo_acao?: string | null
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
      pricing_lentes_contato: {
        Row: {
          active: boolean
          combo_3mais1: boolean
          created_at: string
          cylinder_axes_disponiveis: string | null
          cylinder_max: number | null
          cylinder_min: number | null
          descarte: string
          dias_por_unidade: number
          dk: number | null
          fornecedor: string
          id: number
          is_color: boolean
          is_dnz: boolean
          is_toric: boolean
          material: string | null
          observacoes: string | null
          price_brl: number
          priority: number
          produto: string
          sphere_max: number | null
          sphere_min: number | null
          unidades_por_caixa: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          combo_3mais1?: boolean
          created_at?: string
          cylinder_axes_disponiveis?: string | null
          cylinder_max?: number | null
          cylinder_min?: number | null
          descarte: string
          dias_por_unidade?: number
          dk?: number | null
          fornecedor: string
          id?: number
          is_color?: boolean
          is_dnz?: boolean
          is_toric?: boolean
          material?: string | null
          observacoes?: string | null
          price_brl: number
          priority?: number
          produto: string
          sphere_max?: number | null
          sphere_min?: number | null
          unidades_por_caixa?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          combo_3mais1?: boolean
          created_at?: string
          cylinder_axes_disponiveis?: string | null
          cylinder_max?: number | null
          cylinder_min?: number | null
          descarte?: string
          dias_por_unidade?: number
          dk?: number | null
          fornecedor?: string
          id?: number
          is_color?: boolean
          is_dnz?: boolean
          is_toric?: boolean
          material?: string | null
          observacoes?: string | null
          price_brl?: number
          priority?: number
          produto?: string
          sphere_max?: number | null
          sphere_min?: number | null
          unidades_por_caixa?: number
          updated_at?: string
        }
        Relationships: []
      }
      pricing_table_lentes: {
        Row: {
          active: boolean | null
          add_max: number | null
          add_min: number | null
          blue: boolean | null
          brand: string
          category: string
          created_at: string | null
          cylinder_max: number | null
          cylinder_min: number | null
          diameter: number | null
          family: string
          id: number
          index_name: string
          min_fitting_height: number | null
          photo: boolean | null
          price_brl: number
          priority: number | null
          source_catalog: string | null
          source_page: string | null
          sphere_max: number | null
          sphere_min: number | null
          treatment: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          add_max?: number | null
          add_min?: number | null
          blue?: boolean | null
          brand: string
          category: string
          created_at?: string | null
          cylinder_max?: number | null
          cylinder_min?: number | null
          diameter?: number | null
          family: string
          id?: number
          index_name: string
          min_fitting_height?: number | null
          photo?: boolean | null
          price_brl: number
          priority?: number | null
          source_catalog?: string | null
          source_page?: string | null
          sphere_max?: number | null
          sphere_min?: number | null
          treatment: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          add_max?: number | null
          add_min?: number | null
          blue?: boolean | null
          brand?: string
          category?: string
          created_at?: string | null
          cylinder_max?: number | null
          cylinder_min?: number | null
          diameter?: number | null
          family?: string
          id?: number
          index_name?: string
          min_fitting_height?: number | null
          photo?: boolean | null
          price_brl?: number
          priority?: number | null
          source_catalog?: string | null
          source_page?: string | null
          sphere_max?: number | null
          sphere_min?: number | null
          treatment?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      processos_excecao: {
        Row: {
          ativo: boolean
          chave: string
          created_at: string
          descricao: string | null
          id: string
          niveis_autorizadores: string[]
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          chave: string
          created_at?: string
          descricao?: string | null
          id?: string
          niveis_autorizadores?: string[]
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          chave?: string
          created_at?: string
          descricao?: string | null
          id?: string
          niveis_autorizadores?: string[]
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          ativo: boolean
          avatar_url: string | null
          cargo: string | null
          cargo_loja: string | null
          created_at: string
          email: string | null
          id: string
          lojas: string[]
          lojas_responsaveis: string[]
          metadata: Json
          nome: string
          setor_id: string | null
          tipo_usuario: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          avatar_url?: string | null
          cargo?: string | null
          cargo_loja?: string | null
          created_at?: string
          email?: string | null
          id: string
          lojas?: string[]
          lojas_responsaveis?: string[]
          metadata?: Json
          nome: string
          setor_id?: string | null
          tipo_usuario?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          avatar_url?: string | null
          cargo?: string | null
          cargo_loja?: string | null
          created_at?: string
          email?: string | null
          id?: string
          lojas?: string[]
          lojas_responsaveis?: string[]
          metadata?: Json
          nome?: string
          setor_id?: string | null
          tipo_usuario?: string
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
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      regua_inscricao: {
        Row: {
          canal_consentimento: string | null
          cod_empresa: string | null
          consentimento_at: string | null
          consentimento_status: string
          contato_id: string | null
          cpf: string | null
          criado_em: string
          data_entrega_ancora: string | null
          id: string
          nome_cliente: string | null
          numero_venda: string
          origem: string | null
          status: string
          usuario_lancamento: string | null
          valor_status: string
          valor_total_informado: number | null
          valor_total_validado: number | null
          whatsapp: string | null
        }
        Insert: {
          canal_consentimento?: string | null
          cod_empresa?: string | null
          consentimento_at?: string | null
          consentimento_status?: string
          contato_id?: string | null
          cpf?: string | null
          criado_em?: string
          data_entrega_ancora?: string | null
          id?: string
          nome_cliente?: string | null
          numero_venda: string
          origem?: string | null
          status?: string
          usuario_lancamento?: string | null
          valor_status?: string
          valor_total_informado?: number | null
          valor_total_validado?: number | null
          whatsapp?: string | null
        }
        Update: {
          canal_consentimento?: string | null
          cod_empresa?: string | null
          consentimento_at?: string | null
          consentimento_status?: string
          contato_id?: string | null
          cpf?: string | null
          criado_em?: string
          data_entrega_ancora?: string | null
          id?: string
          nome_cliente?: string | null
          numero_venda?: string
          origem?: string | null
          status?: string
          usuario_lancamento?: string | null
          valor_status?: string
          valor_total_informado?: number | null
          valor_total_validado?: number | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "regua_inscricao_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      regua_os: {
        Row: {
          classificacao: string
          data_entrega: string | null
          id: string
          inscricao_id: string
          os_numero: string
          reconciliado_at: string | null
        }
        Insert: {
          classificacao?: string
          data_entrega?: string | null
          id?: string
          inscricao_id: string
          os_numero: string
          reconciliado_at?: string | null
        }
        Update: {
          classificacao?: string
          data_entrega?: string | null
          id?: string
          inscricao_id?: string
          os_numero?: string
          reconciliado_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "regua_os_inscricao_id_fkey"
            columns: ["inscricao_id"]
            isOneToOne: false
            referencedRelation: "regua_inscricao"
            referencedColumns: ["id"]
          },
        ]
      }
      regua_touchpoint: {
        Row: {
          canal: string | null
          data_prevista: string
          enviado_at: string | null
          id: string
          inscricao_id: string
          status: string
          status_entrega: string | null
          template_key: string | null
          tipo: string
        }
        Insert: {
          canal?: string | null
          data_prevista: string
          enviado_at?: string | null
          id?: string
          inscricao_id: string
          status?: string
          status_entrega?: string | null
          template_key?: string | null
          tipo: string
        }
        Update: {
          canal?: string | null
          data_prevista?: string
          enviado_at?: string | null
          id?: string
          inscricao_id?: string
          status?: string
          status_entrega?: string | null
          template_key?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "regua_touchpoint_inscricao_id_fkey"
            columns: ["inscricao_id"]
            isOneToOne: false
            referencedRelation: "regua_inscricao"
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
      solicitacao_anexos: {
        Row: {
          created_at: string | null
          descricao: string | null
          id: string
          mime_type: string | null
          solicitacao_id: string
          storage_path: string
          tamanho_bytes: number | null
          tipo: string
          url_publica: string
        }
        Insert: {
          created_at?: string | null
          descricao?: string | null
          id?: string
          mime_type?: string | null
          solicitacao_id: string
          storage_path: string
          tamanho_bytes?: number | null
          tipo?: string
          url_publica: string
        }
        Update: {
          created_at?: string | null
          descricao?: string | null
          id?: string
          mime_type?: string | null
          solicitacao_id?: string
          storage_path?: string
          tamanho_bytes?: number | null
          tipo?: string
          url_publica?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitacao_anexos_solicitacao_id_fkey"
            columns: ["solicitacao_id"]
            isOneToOne: false
            referencedRelation: "solicitacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitacao_comentarios: {
        Row: {
          autor_id: string | null
          autor_nome: string | null
          conteudo: string
          created_at: string
          id: string
          solicitacao_id: string
          tipo: string
        }
        Insert: {
          autor_id?: string | null
          autor_nome?: string | null
          conteudo: string
          created_at?: string
          id?: string
          solicitacao_id: string
          tipo?: string
        }
        Update: {
          autor_id?: string | null
          autor_nome?: string | null
          conteudo?: string
          created_at?: string
          id?: string
          solicitacao_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitacao_comentarios_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacao_comentarios_solicitacao_id_fkey"
            columns: ["solicitacao_id"]
            isOneToOne: false
            referencedRelation: "solicitacoes"
            referencedColumns: ["id"]
          },
        ]
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
          protocolo: string | null
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
          protocolo?: string | null
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
          protocolo?: string | null
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
          cargo: string | null
          cod_empresa: string | null
          created_at: string | null
          departamento: string | null
          endereco: string | null
          google_profile_url: string | null
          horario_abertura: string | null
          horario_fechamento: string | null
          horarios_semana: Json
          id: string
          nome_colaborador: string | null
          nome_loja: string
          setor_destino_id: string | null
          telefone: string
          tipo: string
        }
        Insert: {
          ativo?: boolean | null
          cargo?: string | null
          cod_empresa?: string | null
          created_at?: string | null
          departamento?: string | null
          endereco?: string | null
          google_profile_url?: string | null
          horario_abertura?: string | null
          horario_fechamento?: string | null
          horarios_semana?: Json
          id?: string
          nome_colaborador?: string | null
          nome_loja: string
          setor_destino_id?: string | null
          telefone: string
          tipo?: string
        }
        Update: {
          ativo?: boolean | null
          cargo?: string | null
          cod_empresa?: string | null
          created_at?: string | null
          departamento?: string | null
          endereco?: string | null
          google_profile_url?: string | null
          horario_abertura?: string | null
          horario_fechamento?: string | null
          horarios_semana?: Json
          id?: string
          nome_colaborador?: string | null
          nome_loja?: string
          setor_destino_id?: string | null
          telefone?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "telefones_lojas_setor_destino_id_fkey"
            columns: ["setor_destino_id"]
            isOneToOne: false
            referencedRelation: "setores"
            referencedColumns: ["id"]
          },
        ]
      }
      template_aliases: {
        Row: {
          alias: string
          atualizado_em: string
          descricao: string | null
          template_nome: string
        }
        Insert: {
          alias: string
          atualizado_em?: string
          descricao?: string | null
          template_nome: string
        }
        Update: {
          alias?: string
          atualizado_em?: string
          descricao?: string | null
          template_nome?: string
        }
        Relationships: []
      }
      user_acessos: {
        Row: {
          acesso_total: boolean
          created_at: string
          lojas: string[] | null
          modulos: Json
          setores: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          acesso_total?: boolean
          created_at?: string
          lojas?: string[] | null
          modulos?: Json
          setores?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          acesso_total?: boolean
          created_at?: string
          lojas?: string[] | null
          modulos?: Json
          setores?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          loja_nome: string | null
          role: Database["public"]["Enums"]["app_role"]
          setor_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          loja_nome?: string | null
          role: Database["public"]["Enums"]["app_role"]
          setor_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          loja_nome?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          setor_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_setor_id_fkey"
            columns: ["setor_id"]
            isOneToOne: false
            referencedRelation: "setores"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          body: string
          categoria: string
          created_at: string
          descontinuado: boolean
          funcao_alvo: string | null
          id: string
          idioma: string
          motivo_rejeicao: string | null
          nome: string
          status: string
          ultima_sincronizacao: string | null
          updated_at: string
          variaveis: Json
        }
        Insert: {
          body: string
          categoria: string
          created_at?: string
          descontinuado?: boolean
          funcao_alvo?: string | null
          id?: string
          idioma?: string
          motivo_rejeicao?: string | null
          nome: string
          status?: string
          ultima_sincronizacao?: string | null
          updated_at?: string
          variaveis?: Json
        }
        Update: {
          body?: string
          categoria?: string
          created_at?: string
          descontinuado?: boolean
          funcao_alvo?: string | null
          id?: string
          idioma?: string
          motivo_rejeicao?: string | null
          nome?: string
          status?: string
          ultima_sincronizacao?: string | null
          updated_at?: string
          variaveis?: Json
        }
        Relationships: []
      }
    }
    Views: {
      funil_metricas_vendas: {
        Row: {
          ciclo_funil: number | null
          coluna_nome: string | null
          grupo_funil: string | null
          grupo_ordem: number | null
          total_contatos: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      calcular_membros_grupo: {
        Args: { _ref: string; _tipo: string }
        Returns: string[]
      }
      cashback_confirmar_credito: {
        Args: { _inscricao_id: string; _valor_validado: number }
        Returns: Json
      }
      cashback_consultar_saldo: { Args: { _contato_id: string }; Returns: Json }
      cashback_registrar_resgate: {
        Args: {
          _cashback_usado: number
          _cod_empresa: string
          _contato_id: string
          _numero_venda: string
          _usuario_lancamento?: string
          _valor_informado: number
        }
        Returns: Json
      }
      desanitize_corporate_contact: {
        Args: { _telefone: string }
        Returns: Json
      }
      fn_send_push: {
        Args: {
          _body: string
          _tag?: string
          _title: string
          _url?: string
          _user_ids: string[]
        }
        Returns: undefined
      }
      get_menu_opcoes_para_cargo:
        | {
            Args: { _cargo: string; _parent_id: string; _tipo_bot: string }
            Returns: {
              ativo: boolean
              cargos_visiveis: string[]
              chave: string
              created_at: string
              descricao: string | null
              emoji: string
              fluxo: string
              id: string
              ordem: number
              parent_id: string | null
              setor_id: string | null
              tipo: string
              tipo_bot: string
              titulo: string
              updated_at: string
              usuarios_visiveis: string[]
            }[]
            SetofOptions: {
              from: "*"
              to: "bot_menu_opcoes"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: {
              _cargo: string
              _parent_id: string
              _tipo_bot: string
              _user_id?: string
            }
            Returns: {
              ativo: boolean
              cargos_visiveis: string[]
              chave: string
              created_at: string
              descricao: string | null
              emoji: string
              fluxo: string
              id: string
              ordem: number
              parent_id: string | null
              setor_id: string | null
              tipo: string
              tipo_bot: string
              titulo: string
              updated_at: string
              usuarios_visiveis: string[]
            }[]
            SetofOptions: {
              from: "*"
              to: "bot_menu_opcoes"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      get_menu_opcoes_para_usuario: {
        Args: { _parent_id: string; _tipo_bot: string; _user_id: string }
        Returns: {
          ativo: boolean
          cargos_visiveis: string[]
          chave: string
          created_at: string
          descricao: string | null
          emoji: string
          fluxo: string
          id: string
          ordem: number
          parent_id: string | null
          setor_id: string | null
          tipo: string
          tipo_bot: string
          titulo: string
          updated_at: string
          usuarios_visiveis: string[]
        }[]
        SetofOptions: {
          from: "*"
          to: "bot_menu_opcoes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_template_by_alias: { Args: { _alias: string }; Returns: string }
      get_user_setor_ids: { Args: { _user_id: string }; Returns: string[] }
      grupo_id_from_conversa: {
        Args: { _conversa_id: string }
        Returns: string
      }
      has_modulo: {
        Args: { _modulo: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      infer_brand_from_bin: { Args: { bin_raw: string }; Returns: string }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_group_member: {
        Args: { _grupo_id: string; _user_id: string }
        Returns: boolean
      }
      loja_status_no_dia: {
        Args: { _data: string; _loja_id: string }
        Returns: Json
      }
      next_contato_anonimo: { Args: never; Returns: number }
      nextval_protocolo: { Args: never; Returns: number }
      pode_conversar_1a1: {
        Args: { _destinatario: string; _remetente: string }
        Returns: boolean
      }
      pode_gerenciar_usuarios: { Args: { _uid: string }; Returns: boolean }
      regua_registrar_venda: {
        Args: {
          p_cod_empresa: string
          p_cpf_digits: string
          p_nome: string
          p_numero_venda: string
          p_usuario_lancamento: string
          p_valor: number
          p_whatsapp_digits: string
        }
        Returns: Json
      }
      resolve_responsavel_setor: {
        Args: { _setor_id: string }
        Returns: string
      }
      resolver_destinatarios_atendimento: {
        Args: { _atendimento_id: string }
        Returns: string[]
      }
      resolver_destinatarios_loja: {
        Args: { _loja_nome: string }
        Returns: {
          setor_id: string
          user_id: string
        }[]
      }
      resolver_destinatarios_loja_por_nivel: {
        Args: { _loja_nome: string; _nivel: string }
        Returns: {
          user_id: string
        }[]
      }
      sanitize_corporate_contact: { Args: { _telefone: string }; Returns: Json }
      schedule_cron_job: {
        Args: { cron_expression: string; job_name: string; sql_command: string }
        Returns: number
      }
      set_bot_menu_visibility_for_user: {
        Args: { _opcao_ids: string[]; _user_id: string }
        Returns: undefined
      }
      setup_contato_ponte: { Args: { _contato_id: string }; Returns: string }
      unique_responsavel_setor: { Args: { _setor_id: string }; Returns: string }
      unschedule_cron_job: { Args: { job_name: string }; Returns: undefined }
    }
    Enums: {
      app_role:
        | "admin"
        | "operador"
        | "setor_usuario"
        | "supervisao"
        | "diretoria"
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
      app_role: [
        "admin",
        "operador",
        "setor_usuario",
        "supervisao",
        "diretoria",
      ],
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
