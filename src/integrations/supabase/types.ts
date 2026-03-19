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
      canais: {
        Row: {
          contato_id: string
          created_at: string
          id: string
          identificador: string
          metadata: Json | null
          principal: boolean
          tipo: Database["public"]["Enums"]["tipo_canal"]
        }
        Insert: {
          contato_id: string
          created_at?: string
          id?: string
          identificador: string
          metadata?: Json | null
          principal?: boolean
          tipo: Database["public"]["Enums"]["tipo_canal"]
        }
        Update: {
          contato_id?: string
          created_at?: string
          id?: string
          identificador?: string
          metadata?: Json | null
          principal?: boolean
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
      contatos: {
        Row: {
          ativo: boolean
          created_at: string
          documento: string | null
          email: string | null
          id: string
          metadata: Json | null
          nome: string
          tags: string[] | null
          telefone: string | null
          tipo: Database["public"]["Enums"]["tipo_contato"]
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          documento?: string | null
          email?: string | null
          id?: string
          metadata?: Json | null
          nome: string
          tags?: string[] | null
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["tipo_contato"]
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          documento?: string | null
          email?: string | null
          id?: string
          metadata?: Json | null
          nome?: string
          tags?: string[] | null
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["tipo_contato"]
          updated_at?: string
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
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      prioridade: "critica" | "alta" | "normal" | "baixa"
      status_solicitacao:
        | "aberta"
        | "classificada"
        | "em_atendimento"
        | "aguardando_execucao"
        | "concluida"
        | "cancelada"
        | "reaberta"
      tipo_canal: "whatsapp" | "sistema" | "email" | "telefone"
      tipo_contato: "cliente" | "fornecedor" | "loja" | "colaborador"
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
      prioridade: ["critica", "alta", "normal", "baixa"],
      status_solicitacao: [
        "aberta",
        "classificada",
        "em_atendimento",
        "aguardando_execucao",
        "concluida",
        "cancelada",
        "reaberta",
      ],
      tipo_canal: ["whatsapp", "sistema", "email", "telefone"],
      tipo_contato: ["cliente", "fornecedor", "loja", "colaborador"],
    },
  },
} as const
