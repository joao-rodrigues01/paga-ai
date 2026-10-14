export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; name: string; avatar_url: string | null; pix_key: string | null; created_at: string; updated_at: string }
        Insert: { id: string; name?: string; avatar_url?: string | null; pix_key?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; name?: string; avatar_url?: string | null; pix_key?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      dependents: {
        Row: { id: string; profile_id: string | null; contact_id: string | null; name: string; created_at: string; updated_at: string }
        Insert: { id?: string; profile_id?: string | null; contact_id?: string | null; name: string; created_at?: string; updated_at?: string }
        Update: { id?: string; profile_id?: string | null; contact_id?: string | null; name?: string; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'dependents_contact_id_fkey'; columns: ['contact_id']; isOneToOne: false; referencedRelation: 'contacts'; referencedColumns: ['id'] },
          { foreignKeyName: 'dependents_profile_id_fkey'; columns: ['profile_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }
        ]
      }
      groups: {
        Row: { id: string; name: string; created_by: string; created_at: string; updated_at: string }
        Insert: { id?: string; name: string; created_by: string; created_at?: string; updated_at?: string }
        Update: { id?: string; name?: string; created_by?: string; created_at?: string; updated_at?: string }
        Relationships: [{ foreignKeyName: 'groups_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }]
      }
      contacts: {
        Row: { id: string; owner_profile_id: string | null; group_id: string | null; name: string; avatar: string; pix_key: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; owner_profile_id?: string | null; group_id?: string | null; name: string; avatar?: string; pix_key?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; owner_profile_id?: string | null; group_id?: string | null; name?: string; avatar?: string; pix_key?: string | null; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'contacts_group_id_fkey'; columns: ['group_id']; isOneToOne: false; referencedRelation: 'groups'; referencedColumns: ['id'] },
          { foreignKeyName: 'contacts_owner_profile_id_fkey'; columns: ['owner_profile_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }
        ]
      }
      friendships: {
        Row: { id: string; user_id: string; friend_profile_id: string | null; friend_name: string; status: 'pending' | 'accepted'; invite_token_hash: string | null; invite_expires_at: string | null; accepted_at: string | null; created_at: string; updated_at: string }
        Insert: { id: string; user_id: string; friend_profile_id?: string | null; friend_name: string; status?: 'pending' | 'accepted'; invite_token_hash?: string | null; invite_expires_at?: string | null; accepted_at?: string | null; created_at?: string; updated_at?: string }
        Update: { friend_profile_id?: string | null; friend_name?: string; status?: 'pending' | 'accepted'; invite_token_hash?: string | null; invite_expires_at?: string | null; accepted_at?: string | null; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'friendships_id_fkey'; columns: ['id']; isOneToOne: true; referencedRelation: 'contacts'; referencedColumns: ['id'] },
          { foreignKeyName: 'friendships_user_id_fkey'; columns: ['user_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'friendships_friend_profile_id_fkey'; columns: ['friend_profile_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }
        ]
      }
      group_members: {
        Row: { group_id: string; profile_id: string; role: string; joined_at: string }
        Insert: { group_id: string; profile_id: string; role?: string; joined_at?: string }
        Update: { group_id?: string; profile_id?: string; role?: string; joined_at?: string }
        Relationships: [
          { foreignKeyName: 'group_members_group_id_fkey'; columns: ['group_id']; isOneToOne: false; referencedRelation: 'groups'; referencedColumns: ['id'] },
          { foreignKeyName: 'group_members_profile_id_fkey'; columns: ['profile_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }
        ]
      }
      credit_cards: {
        Row: { id: string; owner_profile_id: string | null; group_id: string | null; name: string; closing_day: number; due_day: number; created_at: string; updated_at: string }
        Insert: { id?: string; owner_profile_id?: string | null; group_id?: string | null; name: string; closing_day: number; due_day: number; created_at?: string; updated_at?: string }
        Update: { id?: string; owner_profile_id?: string | null; group_id?: string | null; name?: string; closing_day?: number; due_day?: number; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'credit_cards_group_id_fkey'; columns: ['group_id']; isOneToOne: false; referencedRelation: 'groups'; referencedColumns: ['id'] },
          { foreignKeyName: 'credit_cards_owner_profile_id_fkey'; columns: ['owner_profile_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }
        ]
      }
      expenses: {
        Row: { id: string; title: string; total_amount: number; date: string; group_id: string | null; created_by: string; credit_card_id: string | null; payment_method: string; installments_count: number; created_at: string; updated_at: string }
        Insert: { id?: string; title: string; total_amount: number; date: string; group_id?: string | null; created_by: string; credit_card_id?: string | null; payment_method: string; installments_count: number; created_at?: string; updated_at?: string }
        Update: { id?: string; title?: string; total_amount?: number; date?: string; group_id?: string | null; created_by?: string; credit_card_id?: string | null; payment_method?: string; installments_count?: number; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'expenses_credit_card_id_fkey'; columns: ['credit_card_id']; isOneToOne: false; referencedRelation: 'credit_cards'; referencedColumns: ['id'] },
          { foreignKeyName: 'expenses_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'expenses_group_id_fkey'; columns: ['group_id']; isOneToOne: false; referencedRelation: 'groups'; referencedColumns: ['id'] }
        ]
      }
      expense_installments: {
        Row: { id: string; expense_id: string; installment_number: number; amount: number; due_date: string }
        Insert: { id?: string; expense_id: string; installment_number: number; amount: number; due_date: string }
        Update: { id?: string; expense_id?: string; installment_number?: number; amount?: number; due_date?: string }
        Relationships: [{ foreignKeyName: 'expense_installments_expense_id_fkey'; columns: ['expense_id']; isOneToOne: false; referencedRelation: 'expenses'; referencedColumns: ['id'] }]
      }
      expense_splits: {
        Row: { id: string; installment_id: string; payer_profile_id: string | null; payer_contact_id: string | null; friendship_id: string | null; profile_id: string | null; dependent_id: string | null; amount_owed: number; is_paid: boolean; paid_at: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; installment_id: string; payer_profile_id?: string | null; payer_contact_id?: string | null; friendship_id?: string | null; profile_id?: string | null; dependent_id?: string | null; amount_owed: number; is_paid?: boolean; paid_at?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; installment_id?: string; payer_profile_id?: string | null; payer_contact_id?: string | null; friendship_id?: string | null; profile_id?: string | null; dependent_id?: string | null; amount_owed?: number; is_paid?: boolean; paid_at?: string | null; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'expense_splits_dependent_id_payer_profile_id_fkey'; columns: ['dependent_id', 'payer_profile_id']; isOneToOne: false; referencedRelation: 'dependents'; referencedColumns: ['id', 'profile_id'] },
          { foreignKeyName: 'expense_splits_dependent_id_payer_contact_id_fkey'; columns: ['dependent_id', 'payer_contact_id']; isOneToOne: false; referencedRelation: 'dependents'; referencedColumns: ['id', 'contact_id'] },
          { foreignKeyName: 'expense_splits_installment_id_fkey'; columns: ['installment_id']; isOneToOne: false; referencedRelation: 'expense_installments'; referencedColumns: ['id'] },
          { foreignKeyName: 'expense_splits_friendship_id_fkey'; columns: ['friendship_id']; isOneToOne: false; referencedRelation: 'friendships'; referencedColumns: ['id'] },
          { foreignKeyName: 'expense_splits_profile_id_fkey'; columns: ['profile_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'expense_splits_payer_contact_id_fkey'; columns: ['payer_contact_id']; isOneToOne: false; referencedRelation: 'contacts'; referencedColumns: ['id'] },
          { foreignKeyName: 'expense_splits_payer_profile_id_fkey'; columns: ['payer_profile_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      get_own_pix_key: { Args: Record<PropertyKey, never>; Returns: string | null }
      mark_expense_split_paid: { Args: { p_split_id: string }; Returns: Database['public']['Tables']['expense_splits']['Row'] }
      create_friend_invite: { Args: { p_friendship_id: string }; Returns: string }
      accept_friend_invite: { Args: { p_token: string }; Returns: string }
      import_local_backup: { Args: { p_data: Json }; Returns: Json }
      sync_local_friends: { Args: { p_friends: Json }; Returns: Json }
      sync_local_expense: { Args: { p_data: Json }; Returns: Json }
      mark_shared_expense_paid: { Args: { p_expense_id: string; p_installment_number?: number | null }; Returns: number }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
