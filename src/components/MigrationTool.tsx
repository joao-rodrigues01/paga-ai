import { useState } from 'react'
import { Database } from 'lucide-react'
import type { Json } from '../types/database.types'
import { getSupabaseClient } from '../lib/supabase'
import { syncLocalExpense } from '../lib/expenseSync'
import type { PersistedData } from '../domain/migration'

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

  const syncFriendsAndExpenses = async (data: BackupData) => {
    const client = getSupabaseClient()
    const { data: friendResult, error: friendError } = await client.rpc('sync_local_friends', {
      p_friends: data.friends as Json,
    })
    if (friendError) throw friendError

    const persistedData = data as unknown as PersistedData
    let syncedExpenses = 0
    for (const expense of persistedData.expenses) {
      await syncLocalExpense(persistedData, expense.id)
      syncedExpenses += 1
    }
    return { friendResult, syncedExpenses }
  }

  const migrate = async () => {
    if (!window.confirm('Importar ou sincronizar seus dados locais no Supabase? Despesas já sincronizadas não serão duplicadas. O localStorage será preservado.')) return
    setBusy(true)
    try {
      const data = readLocalBackup()
      const { data: result, error } = await getSupabaseClient().rpc('import_local_backup', { p_data: data as unknown as Json })
      if (!error && isRecord(result) && result.alreadyImported === true) {
        const syncResult = await syncFriendsAndExpenses(data)
        console.info('[PagaAí] Amigos, dependentes e despesas locais sincronizados:', syncResult)
        return
      }
      if (error) {
        // Uma importação anterior pode ter sido feita antes do registro de controle
        // da RPC. Em conflito de unicidade, sincronizamos apenas a lista de amigos.
        if (error.code !== '23505') throw error
        const syncResult = await syncFriendsAndExpenses(data)
        console.info('[PagaAí] Havia registros existentes. Amigos, dependentes e despesas locais foram sincronizados sem duplicação:', syncResult)
        return
      }
      console.info('[PagaAí] Migração inicial concluída:', result)
    } catch (error) {
      console.error('[PagaAí] Falha na migração local:', error)
    } finally {
      setBusy(false)
    }
  }

  return <button type="button" onClick={() => void migrate()} disabled={busy}
    className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60">
    <Database size={15} /> {busy ? 'Sincronizando…' : 'Migrar / sincronizar dados'}
  </button>
}
