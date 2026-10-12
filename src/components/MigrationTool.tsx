import { useState } from 'react'
import { Database } from 'lucide-react'
import type { Json } from '../types/database.types'
import { getSupabaseClient } from '../lib/supabase'

const STORAGE_KEY = 'pagaai-storage'
const ARRAY_FIELDS = ['friends', 'creditCards', 'expenses', 'expenseInstallments', 'expenseSplits'] as const
type BackupData = Record<(typeof ARRAY_FIELDS)[number], unknown[]>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readLocalBackup(): BackupData {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) throw new Error('Não encontrei dados PagaAí no localStorage deste navegador.')
  const parsed: unknown = JSON.parse(raw)
  let data: unknown = parsed

  // Zustand persist guarda { state, version }; o exportador do app usa { format, data }.
  if (isRecord(parsed) && parsed.format === 'pagaai-backup') data = parsed.data
  else if (isRecord(parsed) && isRecord(parsed.state)) data = parsed.state

  if (!isRecord(data) || !ARRAY_FIELDS.every((field) => Array.isArray(data[field]))) {
    throw new Error('O localStorage não contém um estado PagaAí compatível. Exporte ou importe um backup do app e tente novamente.')
  }
  return data as BackupData
}

export function MigrationTool() {
  const [busy, setBusy] = useState(false)

  const migrate = async () => {
    if (!window.confirm('Importar os dados deste navegador para sua conta Supabase? A operação preserva o localStorage e não substitui registros existentes.')) return
    setBusy(true)
    try {
      const data = readLocalBackup()
      const { data: result, error } = await getSupabaseClient().rpc('import_local_backup', { p_data: data as unknown as Json })
      if (error) throw error
      console.info('[PagaAí] Migração local concluída:', result)
    } catch (error) {
      console.error('[PagaAí] Falha na migração local:', error)
    } finally {
      setBusy(false)
    }
  }

  return <button type="button" onClick={() => void migrate()} disabled={busy}
    className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60">
    <Database size={15} /> {busy ? 'Migrando…' : 'Migrar dados ao Supabase'}
  </button>
}
