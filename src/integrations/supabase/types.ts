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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assessment_reports: {
        Row: {
          applied: boolean
          created_at: string
          estimated_level: string | null
          events_json: Json
          id: string
          learner_id: string
          probes_json: Json
          report_json: Json | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          applied?: boolean
          created_at?: string
          estimated_level?: string | null
          events_json?: Json
          id?: string
          learner_id: string
          probes_json?: Json
          report_json?: Json | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          applied?: boolean
          created_at?: string
          estimated_level?: string | null
          events_json?: Json
          id?: string
          learner_id?: string
          probes_json?: Json
          report_json?: Json | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_reports_learner_id_fkey"
            columns: ["learner_id"]
            isOneToOne: false
            referencedRelation: "learners"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmarks: {
        Row: {
          created_at: string
          date: string
          id: string
          learner_id: string
          notes: string | null
          scores_json: Json
        }
        Insert: {
          created_at?: string
          date?: string
          id?: string
          learner_id: string
          notes?: string | null
          scores_json?: Json
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          learner_id?: string
          notes?: string | null
          scores_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "benchmarks_learner_id_fkey"
            columns: ["learner_id"]
            isOneToOne: false
            referencedRelation: "learners"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_content: {
        Row: {
          allowed_gpc_ids: string[]
          cache_key: string
          content_json: Json
          created_at: string
          id: string
          learner_id: string | null
          type: Database["public"]["Enums"]["content_type"]
        }
        Insert: {
          allowed_gpc_ids?: string[]
          cache_key: string
          content_json: Json
          created_at?: string
          id?: string
          learner_id?: string | null
          type: Database["public"]["Enums"]["content_type"]
        }
        Update: {
          allowed_gpc_ids?: string[]
          cache_key?: string
          content_json?: Json
          created_at?: string
          id?: string
          learner_id?: string | null
          type?: Database["public"]["Enums"]["content_type"]
        }
        Relationships: [
          {
            foreignKeyName: "generated_content_learner_id_fkey"
            columns: ["learner_id"]
            isOneToOne: false
            referencedRelation: "learners"
            referencedColumns: ["id"]
          },
        ]
      }
      gpcs: {
        Row: {
          example_word: string
          grapheme: string
          id: string
          order_index: number
          phase: number
          sound_label: string
          type: Database["public"]["Enums"]["gpc_type"]
        }
        Insert: {
          example_word: string
          grapheme: string
          id?: string
          order_index: number
          phase: number
          sound_label: string
          type: Database["public"]["Enums"]["gpc_type"]
        }
        Update: {
          example_word?: string
          grapheme?: string
          id?: string
          order_index?: number
          phase?: number
          sound_label?: string
          type?: Database["public"]["Enums"]["gpc_type"]
        }
        Relationships: []
      }
      heart_words: {
        Row: {
          id: string
          order_index: number
          word: string
        }
        Insert: {
          id?: string
          order_index: number
          word: string
        }
        Update: {
          id?: string
          order_index?: number
          word?: string
        }
        Relationships: []
      }
      interference_items: {
        Row: {
          english_value: string
          example_word: string
          grapheme: string
          id: string
          note: string | null
          swedish_value: string
        }
        Insert: {
          english_value: string
          example_word: string
          grapheme: string
          id?: string
          note?: string | null
          swedish_value: string
        }
        Update: {
          english_value?: string
          example_word?: string
          grapheme?: string
          id?: string
          note?: string | null
          swedish_value?: string
        }
        Relationships: []
      }
      learner_gpc_status: {
        Row: {
          correct_streak: number
          gpc_id: string
          id: string
          last_seen: string | null
          learner_id: string
          leitner_box: number
          next_due_date: string
          status: Database["public"]["Enums"]["item_status"]
          updated_at: string
        }
        Insert: {
          correct_streak?: number
          gpc_id: string
          id?: string
          last_seen?: string | null
          learner_id: string
          leitner_box?: number
          next_due_date?: string
          status?: Database["public"]["Enums"]["item_status"]
          updated_at?: string
        }
        Update: {
          correct_streak?: number
          gpc_id?: string
          id?: string
          last_seen?: string | null
          learner_id?: string
          leitner_box?: number
          next_due_date?: string
          status?: Database["public"]["Enums"]["item_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "learner_gpc_status_gpc_id_fkey"
            columns: ["gpc_id"]
            isOneToOne: false
            referencedRelation: "gpcs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learner_gpc_status_learner_id_fkey"
            columns: ["learner_id"]
            isOneToOne: false
            referencedRelation: "learners"
            referencedColumns: ["id"]
          },
        ]
      }
      learner_heart_word_status: {
        Row: {
          correct_streak: number
          heart_word_id: string
          id: string
          last_seen: string | null
          learner_id: string
          leitner_box: number
          next_due_date: string
          status: Database["public"]["Enums"]["item_status"]
          updated_at: string
        }
        Insert: {
          correct_streak?: number
          heart_word_id: string
          id?: string
          last_seen?: string | null
          learner_id: string
          leitner_box?: number
          next_due_date?: string
          status?: Database["public"]["Enums"]["item_status"]
          updated_at?: string
        }
        Update: {
          correct_streak?: number
          heart_word_id?: string
          id?: string
          last_seen?: string | null
          learner_id?: string
          leitner_box?: number
          next_due_date?: string
          status?: Database["public"]["Enums"]["item_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "learner_heart_word_status_heart_word_id_fkey"
            columns: ["heart_word_id"]
            isOneToOne: false
            referencedRelation: "heart_words"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learner_heart_word_status_learner_id_fkey"
            columns: ["learner_id"]
            isOneToOne: false
            referencedRelation: "learners"
            referencedColumns: ["id"]
          },
        ]
      }
      learner_interference_status: {
        Row: {
          id: string
          interference_id: string
          learner_id: string
          status: Database["public"]["Enums"]["interference_status"]
          updated_at: string
        }
        Insert: {
          id?: string
          interference_id: string
          learner_id: string
          status?: Database["public"]["Enums"]["interference_status"]
          updated_at?: string
        }
        Update: {
          id?: string
          interference_id?: string
          learner_id?: string
          status?: Database["public"]["Enums"]["interference_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "learner_interference_status_interference_id_fkey"
            columns: ["interference_id"]
            isOneToOne: false
            referencedRelation: "interference_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learner_interference_status_learner_id_fkey"
            columns: ["learner_id"]
            isOneToOne: false
            referencedRelation: "learners"
            referencedColumns: ["id"]
          },
        ]
      }
      learners: {
        Row: {
          birthdate: string | null
          created_at: string
          garden_theme: string
          id: string
          name: string
          notes: string | null
          parent_id: string
          updated_at: string
        }
        Insert: {
          birthdate?: string | null
          created_at?: string
          garden_theme?: string
          id?: string
          name: string
          notes?: string | null
          parent_id: string
          updated_at?: string
        }
        Update: {
          birthdate?: string | null
          created_at?: string
          garden_theme?: string
          id?: string
          name?: string
          notes?: string | null
          parent_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      parent_settings: {
        Row: {
          active_learner_id: string | null
          created_at: string
          dyslexia_font: boolean
          parent_id: string
          pin_hash: string | null
          updated_at: string
        }
        Insert: {
          active_learner_id?: string | null
          created_at?: string
          dyslexia_font?: boolean
          parent_id: string
          pin_hash?: string | null
          updated_at?: string
        }
        Update: {
          active_learner_id?: string | null
          created_at?: string
          dyslexia_font?: boolean
          parent_id?: string
          pin_hash?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rewards: {
        Row: {
          badges_json: Json
          current_streak_days: number
          last_session_date: string | null
          learner_id: string
          longest_streak: number
          stars: number
          updated_at: string
        }
        Insert: {
          badges_json?: Json
          current_streak_days?: number
          last_session_date?: string | null
          learner_id: string
          longest_streak?: number
          stars?: number
          updated_at?: string
        }
        Update: {
          badges_json?: Json
          current_streak_days?: number
          last_session_date?: string | null
          learner_id?: string
          longest_streak?: number
          stars?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rewards_learner_id_fkey"
            columns: ["learner_id"]
            isOneToOne: true
            referencedRelation: "learners"
            referencedColumns: ["id"]
          },
        ]
      }
      session_events: {
        Row: {
          created_at: string
          id: string
          item_ref: string
          item_type: Database["public"]["Enums"]["session_item_type"]
          outcome: Database["public"]["Enums"]["outcome"]
          session_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_ref: string
          item_type: Database["public"]["Enums"]["session_item_type"]
          outcome: Database["public"]["Enums"]["outcome"]
          session_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_ref?: string
          item_type?: Database["public"]["Enums"]["session_item_type"]
          outcome?: Database["public"]["Enums"]["outcome"]
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          created_at: string
          date: string
          duration_seconds: number
          id: string
          learner_id: string
          parent_notes: string | null
          plan_json: Json
        }
        Insert: {
          created_at?: string
          date?: string
          duration_seconds?: number
          id?: string
          learner_id: string
          parent_notes?: string | null
          plan_json?: Json
        }
        Update: {
          created_at?: string
          date?: string
          duration_seconds?: number
          id?: string
          learner_id?: string
          parent_notes?: string | null
          plan_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "sessions_learner_id_fkey"
            columns: ["learner_id"]
            isOneToOne: false
            referencedRelation: "learners"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
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
      app_role: "parent"
      content_type:
        | "word_list"
        | "sentence"
        | "story"
        | "game_words"
        | "pseudowords"
      gpc_type: "single" | "digraph" | "split_digraph" | "vowel_team"
      interference_status: "still_confuses" | "resolving" | "secure"
      item_status: "not_started" | "learning" | "practising" | "secure"
      outcome: "got_it" | "hesitated" | "missed" | "self_corrected" | "prompted"
      session_item_type: "gpc" | "heart_word" | "decodable_word"
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
      app_role: ["parent"],
      content_type: [
        "word_list",
        "sentence",
        "story",
        "game_words",
        "pseudowords",
      ],
      gpc_type: ["single", "digraph", "split_digraph", "vowel_team"],
      interference_status: ["still_confuses", "resolving", "secure"],
      item_status: ["not_started", "learning", "practising", "secure"],
      outcome: ["got_it", "hesitated", "missed", "self_corrected", "prompted"],
      session_item_type: ["gpc", "heart_word", "decodable_word"],
    },
  },
} as const
