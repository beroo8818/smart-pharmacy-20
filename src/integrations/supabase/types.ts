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
      active_ingredient_dictionary: {
        Row: {
          active_ingredient: string | null
          approved: boolean
          confidence_score: number
          created_at: string
          created_by: string | null
          dosage_form: string | null
          id: string
          needs_review: boolean
          original_item_name: string
          scientific_name: string | null
          standard_name: string | null
          strength: string | null
          therapeutic_group_key: string | null
          trade_name: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          active_ingredient?: string | null
          approved?: boolean
          confidence_score?: number
          created_at?: string
          created_by?: string | null
          dosage_form?: string | null
          id?: string
          needs_review?: boolean
          original_item_name: string
          scientific_name?: string | null
          standard_name?: string | null
          strength?: string | null
          therapeutic_group_key?: string | null
          trade_name?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          active_ingredient?: string | null
          approved?: boolean
          confidence_score?: number
          created_at?: string
          created_by?: string | null
          dosage_form?: string | null
          id?: string
          needs_review?: boolean
          original_item_name?: string
          scientific_name?: string | null
          standard_name?: string | null
          strength?: string | null
          therapeutic_group_key?: string | null
          trade_name?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          action_ar: string | null
          alert_type: Database["public"]["Enums"]["alert_type"]
          created_at: string
          id: string
          item_master_id: string
          location_id: string
          message_ar: string
          month: string
          severity: Database["public"]["Enums"]["alert_severity"]
          status: string | null
          why_ar: string | null
        }
        Insert: {
          action_ar?: string | null
          alert_type: Database["public"]["Enums"]["alert_type"]
          created_at?: string
          id?: string
          item_master_id: string
          location_id: string
          message_ar: string
          month: string
          severity: Database["public"]["Enums"]["alert_severity"]
          status?: string | null
          why_ar?: string | null
        }
        Update: {
          action_ar?: string | null
          alert_type?: Database["public"]["Enums"]["alert_type"]
          created_at?: string
          id?: string
          item_master_id?: string
          location_id?: string
          message_ar?: string
          month?: string
          severity?: Database["public"]["Enums"]["alert_severity"]
          status?: string | null
          why_ar?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alerts_item_master_id_fkey"
            columns: ["item_master_id"]
            isOneToOne: false
            referencedRelation: "item_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          new_value: Json | null
          old_value: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      data_quality_issues: {
        Row: {
          created_at: string
          id: string
          issue_type: string
          message_ar: string
          row_no: number | null
          severity: Database["public"]["Enums"]["alert_severity"]
          status: Database["public"]["Enums"]["dqi_status"]
          suggested_fix: string | null
          upload_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          issue_type: string
          message_ar: string
          row_no?: number | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          status?: Database["public"]["Enums"]["dqi_status"]
          suggested_fix?: string | null
          upload_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          issue_type?: string
          message_ar?: string
          row_no?: number | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          status?: Database["public"]["Enums"]["dqi_status"]
          suggested_fix?: string | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_quality_issues_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      forecasts: {
        Row: {
          confidence: string | null
          created_at: string
          forecast_3_months: number | null
          forecast_next_month: number | null
          id: string
          item_master_id: string
          location_id: string
          method: string | null
          month: string
          notes_ar: string | null
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          forecast_3_months?: number | null
          forecast_next_month?: number | null
          id?: string
          item_master_id: string
          location_id: string
          method?: string | null
          month: string
          notes_ar?: string | null
        }
        Update: {
          confidence?: string | null
          created_at?: string
          forecast_3_months?: number | null
          forecast_next_month?: number | null
          id?: string
          item_master_id?: string
          location_id?: string
          method?: string | null
          month?: string
          notes_ar?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forecasts_item_master_id_fkey"
            columns: ["item_master_id"]
            isOneToOne: false
            referencedRelation: "item_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecasts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_ignored_rows: {
        Row: {
          created_at: string
          id: string
          preview: Json | null
          reason: string
          row_number: number | null
          sheet_name: string | null
          upload_batch_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          preview?: Json | null
          reason: string
          row_number?: number | null
          sheet_name?: string | null
          upload_batch_id: string
        }
        Update: {
          created_at?: string
          id?: string
          preview?: Json | null
          reason?: string
          row_number?: number | null
          sheet_name?: string | null
          upload_batch_id?: string
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          batch_no: string | null
          created_at: string
          created_by: string
          current_balance: number
          expiry_date: string | null
          id: string
          issued_quantity: number
          item_code: string | null
          item_name: string | null
          location_name: string
          location_type: string
          month: string
          scientific_name: string | null
          source_row_number: number | null
          source_sheet: string | null
          trade_name: string | null
          unit: string | null
          upload_batch_id: string
        }
        Insert: {
          batch_no?: string | null
          created_at?: string
          created_by: string
          current_balance?: number
          expiry_date?: string | null
          id?: string
          issued_quantity?: number
          item_code?: string | null
          item_name?: string | null
          location_name: string
          location_type: string
          month: string
          scientific_name?: string | null
          source_row_number?: number | null
          source_sheet?: string | null
          trade_name?: string | null
          unit?: string | null
          upload_batch_id: string
        }
        Update: {
          batch_no?: string | null
          created_at?: string
          created_by?: string
          current_balance?: number
          expiry_date?: string | null
          id?: string
          issued_quantity?: number
          item_code?: string | null
          item_name?: string | null
          location_name?: string
          location_type?: string
          month?: string
          scientific_name?: string | null
          source_row_number?: number | null
          source_sheet?: string | null
          trade_name?: string | null
          unit?: string | null
          upload_batch_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_upload_batch_id_fkey"
            columns: ["upload_batch_id"]
            isOneToOne: false
            referencedRelation: "upload_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      item_aliases: {
        Row: {
          alias_name: string
          confidence_score: number | null
          id: string
          item_master_id: string
          language: string | null
          source: string | null
        }
        Insert: {
          alias_name: string
          confidence_score?: number | null
          id?: string
          item_master_id: string
          language?: string | null
          source?: string | null
        }
        Update: {
          alias_name?: string
          confidence_score?: number | null
          id?: string
          item_master_id?: string
          language?: string | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_aliases_item_master_id_fkey"
            columns: ["item_master_id"]
            isOneToOne: false
            referencedRelation: "item_master"
            referencedColumns: ["id"]
          },
        ]
      }
      item_master: {
        Row: {
          active_ingredient_ar: string | null
          active_ingredient_en: string | null
          created_at: string
          dosage_form: string | null
          first_active_date: string | null
          id: string
          is_active: boolean
          item_code: string | null
          item_name_ar: string | null
          item_name_en: string | null
          normalized_item_key: string
          strength: string | null
          trade_name: string | null
          unit: string | null
          ven_class: string | null
        }
        Insert: {
          active_ingredient_ar?: string | null
          active_ingredient_en?: string | null
          created_at?: string
          dosage_form?: string | null
          first_active_date?: string | null
          id?: string
          is_active?: boolean
          item_code?: string | null
          item_name_ar?: string | null
          item_name_en?: string | null
          normalized_item_key: string
          strength?: string | null
          trade_name?: string | null
          unit?: string | null
          ven_class?: string | null
        }
        Update: {
          active_ingredient_ar?: string | null
          active_ingredient_en?: string | null
          created_at?: string
          dosage_form?: string | null
          first_active_date?: string | null
          id?: string
          is_active?: boolean
          item_code?: string | null
          item_name_ar?: string | null
          item_name_en?: string | null
          normalized_item_key?: string
          strength?: string | null
          trade_name?: string | null
          unit?: string | null
          ven_class?: string | null
        }
        Relationships: []
      }
      locations: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_location_id: string | null
          type: Database["public"]["Enums"]["location_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_location_id?: string | null
          type: Database["public"]["Enums"]["location_type"]
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_location_id?: string | null
          type?: Database["public"]["Enums"]["location_type"]
        }
        Relationships: [
          {
            foreignKeyName: "locations_parent_location_id_fkey"
            columns: ["parent_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_stock_movements: {
        Row: {
          batch_no: string | null
          closing_balance: number | null
          created_at: string
          expiry_date: string | null
          id: string
          issued_qty: number | null
          item_master_id: string
          lead_time_days: number | null
          location_id: string
          max_stock: number | null
          min_stock: number | null
          month: string
          opening_balance: number | null
          received_qty: number | null
          returns_qty: number | null
          transfer_in_qty: number | null
          transfer_out_qty: number | null
          unit_price: number | null
          uploaded_file_id: string | null
        }
        Insert: {
          batch_no?: string | null
          closing_balance?: number | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          issued_qty?: number | null
          item_master_id: string
          lead_time_days?: number | null
          location_id: string
          max_stock?: number | null
          min_stock?: number | null
          month: string
          opening_balance?: number | null
          received_qty?: number | null
          returns_qty?: number | null
          transfer_in_qty?: number | null
          transfer_out_qty?: number | null
          unit_price?: number | null
          uploaded_file_id?: string | null
        }
        Update: {
          batch_no?: string | null
          closing_balance?: number | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          issued_qty?: number | null
          item_master_id?: string
          lead_time_days?: number | null
          location_id?: string
          max_stock?: number | null
          min_stock?: number | null
          month?: string
          opening_balance?: number | null
          received_qty?: number | null
          returns_qty?: number | null
          transfer_in_qty?: number | null
          transfer_out_qty?: number | null
          unit_price?: number | null
          uploaded_file_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_stock_movements_item_master_id_fkey"
            columns: ["item_master_id"]
            isOneToOne: false
            referencedRelation: "item_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_stock_movements_uploaded_file_id_fkey"
            columns: ["uploaded_file_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          assigned_location_id: string | null
          created_at: string
          email: string | null
          id: string
          must_change_password: boolean
          name: string
        }
        Insert: {
          assigned_location_id?: string | null
          created_at?: string
          email?: string | null
          id: string
          must_change_password?: boolean
          name?: string
        }
        Update: {
          assigned_location_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          must_change_password?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_assigned_location_id_fkey"
            columns: ["assigned_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_actions: {
        Row: {
          acted_at: string
          acted_by: string
          created_at: string
          executed_qty: number | null
          from_location: string | null
          id: string
          item_key: string | null
          item_name: string | null
          match_review_required: boolean
          note: string | null
          override_reason: string | null
          override_unreviewed: boolean
          recommendation_key: string
          recommendation_type: string
          status: Database["public"]["Enums"]["recommendation_status"]
          suggested_qty: number | null
          therapeutic_group_key: string | null
          to_location: string | null
          updated_at: string
          upload_batch_id: string
        }
        Insert: {
          acted_at?: string
          acted_by: string
          created_at?: string
          executed_qty?: number | null
          from_location?: string | null
          id?: string
          item_key?: string | null
          item_name?: string | null
          match_review_required?: boolean
          note?: string | null
          override_reason?: string | null
          override_unreviewed?: boolean
          recommendation_key: string
          recommendation_type: string
          status?: Database["public"]["Enums"]["recommendation_status"]
          suggested_qty?: number | null
          therapeutic_group_key?: string | null
          to_location?: string | null
          updated_at?: string
          upload_batch_id: string
        }
        Update: {
          acted_at?: string
          acted_by?: string
          created_at?: string
          executed_qty?: number | null
          from_location?: string | null
          id?: string
          item_key?: string | null
          item_name?: string | null
          match_review_required?: boolean
          note?: string | null
          override_reason?: string | null
          override_unreviewed?: boolean
          recommendation_key?: string
          recommendation_type?: string
          status?: Database["public"]["Enums"]["recommendation_status"]
          suggested_qty?: number | null
          therapeutic_group_key?: string | null
          to_location?: string | null
          updated_at?: string
          upload_batch_id?: string
        }
        Relationships: []
      }
      stock_transactions: {
        Row: {
          created_at: string
          created_by: string
          from_location_name: string | null
          from_location_type: string | null
          id: string
          item_code: string | null
          item_key: string
          item_name: string | null
          note: string | null
          qty: number
          source_batch_id: string | null
          to_location_name: string | null
          to_location_type: string | null
          txn_date: string
          txn_type: Database["public"]["Enums"]["stock_txn_type"]
          unit: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          from_location_name?: string | null
          from_location_type?: string | null
          id?: string
          item_code?: string | null
          item_key: string
          item_name?: string | null
          note?: string | null
          qty: number
          source_batch_id?: string | null
          to_location_name?: string | null
          to_location_type?: string | null
          txn_date?: string
          txn_type: Database["public"]["Enums"]["stock_txn_type"]
          unit?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          from_location_name?: string | null
          from_location_type?: string | null
          id?: string
          item_code?: string | null
          item_key?: string
          item_name?: string | null
          note?: string | null
          qty?: number
          source_batch_id?: string | null
          to_location_name?: string | null
          to_location_type?: string | null
          txn_date?: string
          txn_type?: Database["public"]["Enums"]["stock_txn_type"]
          unit?: string | null
        }
        Relationships: []
      }
      transfers: {
        Row: {
          batch_no: string | null
          created_at: string
          from_location_id: string
          id: string
          item_master_id: string
          month: string
          qty: number
          reason: string | null
          status: Database["public"]["Enums"]["transfer_status"]
          to_location_id: string
          transfer_type: Database["public"]["Enums"]["transfer_type"]
        }
        Insert: {
          batch_no?: string | null
          created_at?: string
          from_location_id: string
          id?: string
          item_master_id: string
          month: string
          qty: number
          reason?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          to_location_id: string
          transfer_type: Database["public"]["Enums"]["transfer_type"]
        }
        Update: {
          batch_no?: string | null
          created_at?: string
          from_location_id?: string
          id?: string
          item_master_id?: string
          month?: string
          qty?: number
          reason?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          to_location_id?: string
          transfer_type?: Database["public"]["Enums"]["transfer_type"]
        }
        Relationships: [
          {
            foreignKeyName: "transfers_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_item_master_id_fkey"
            columns: ["item_master_id"]
            isOneToOne: false
            referencedRelation: "item_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_batches: {
        Row: {
          batch_kind: string
          created_at: string
          created_by: string
          file_name: string
          id: string
          issues_count: number
          month: string
          rows_ignored: number
          rows_saved: number
          snapshot_date: string | null
          status: string
        }
        Insert: {
          batch_kind?: string
          created_at?: string
          created_by: string
          file_name: string
          id?: string
          issues_count?: number
          month: string
          rows_ignored?: number
          rows_saved?: number
          snapshot_date?: string | null
          status?: string
        }
        Update: {
          batch_kind?: string
          created_at?: string
          created_by?: string
          file_name?: string
          id?: string
          issues_count?: number
          month?: string
          rows_ignored?: number
          rows_saved?: number
          snapshot_date?: string | null
          status?: string
        }
        Relationships: []
      }
      uploads: {
        Row: {
          error_count: number | null
          filename: string
          id: string
          status: Database["public"]["Enums"]["upload_status"]
          storage_path: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          error_count?: number | null
          filename: string
          id?: string
          status?: Database["public"]["Enums"]["upload_status"]
          storage_path?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          error_count?: number | null
          filename?: string
          id?: string
          status?: Database["public"]["Enums"]["upload_status"]
          storage_path?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      user_location: { Args: { _user_id: string }; Returns: string }
      user_location_name: { Args: { _user_id: string }; Returns: string }
      wipe_all_inventory_data: { Args: never; Returns: undefined }
    }
    Enums: {
      alert_severity: "low" | "medium" | "high"
      alert_type:
        | "shortage"
        | "overstock"
        | "deadstock"
        | "expiry"
        | "data"
        | "high_value_slow_moving"
      app_role:
        | "system_admin"
        | "pharmacy_manager"
        | "sub_pharmacist"
        | "warehouse_keeper"
        | "viewer"
      dqi_status: "open" | "fixed" | "ignored"
      location_type: "main_warehouse" | "sub_pharmacy"
      recommendation_status:
        | "new"
        | "approved"
        | "rejected"
        | "postponed"
        | "executed"
      stock_txn_type:
        | "warehouse_receipt"
        | "warehouse_issue_to_pharmacy"
        | "pharmacy_issue"
        | "pharmacy_transfer"
        | "warehouse_return"
        | "pharmacy_return_to_warehouse"
      transfer_status: "suggested" | "approved" | "done" | "cancelled"
      transfer_type: "main_to_sub" | "sub_to_main" | "sub_to_sub"
      upload_status: "pending" | "validated" | "approved" | "rejected"
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
      alert_severity: ["low", "medium", "high"],
      alert_type: [
        "shortage",
        "overstock",
        "deadstock",
        "expiry",
        "data",
        "high_value_slow_moving",
      ],
      app_role: [
        "system_admin",
        "pharmacy_manager",
        "sub_pharmacist",
        "warehouse_keeper",
        "viewer",
      ],
      dqi_status: ["open", "fixed", "ignored"],
      location_type: ["main_warehouse", "sub_pharmacy"],
      recommendation_status: [
        "new",
        "approved",
        "rejected",
        "postponed",
        "executed",
      ],
      stock_txn_type: [
        "warehouse_receipt",
        "warehouse_issue_to_pharmacy",
        "pharmacy_issue",
        "pharmacy_transfer",
        "warehouse_return",
        "pharmacy_return_to_warehouse",
      ],
      transfer_status: ["suggested", "approved", "done", "cancelled"],
      transfer_type: ["main_to_sub", "sub_to_main", "sub_to_sub"],
      upload_status: ["pending", "validated", "approved", "rejected"],
    },
  },
} as const
