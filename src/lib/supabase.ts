import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'

let client: SupabaseClient<Database> | undefined

/** Cria o cliente sob demanda para o MVP local continuar abrindo sem configuração Supabase. */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client

  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) {
    throw new Error('Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env.local.')
  }

  try {
    new URL(url)
  } catch {
    throw new Error('VITE_SUPABASE_URL precisa ser uma URL válida.')
  }

  client = createClient<Database>(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return client
}

export function getAuthRedirectUrl(): string {
  const configuredUrl = import.meta.env.VITE_SUPABASE_REDIRECT_URL?.trim()
  return configuredUrl || new URL(import.meta.env.BASE_URL, window.location.origin).toString()
}
