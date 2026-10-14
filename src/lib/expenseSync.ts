import type { PersistedData } from '../domain/migration'
import type { Json } from '../types/database.types'
import { getSupabaseClient } from './supabase'

/** Sincroniza uma despesa e suas relações numa única RPC transacional. */
export async function syncLocalExpense(data: PersistedData, expenseId: string): Promise<boolean> {
  const expense = data.expenses.find((item) => item.id === expenseId)
  if (!expense) throw new Error('Despesa local não encontrada.')
  const installments = data.expenseInstallments.filter((item) => item.expenseId === expenseId)
  const installmentIds = new Set(installments.map((item) => item.id))
  const friendsById = new Map(data.friends.map((friend) => [friend.id, friend]))
  const splits = data.expenseSplits
    .filter((item) => installmentIds.has(item.expenseInstallmentId))
    .map((split) => ({ ...split, isMe: Boolean(friendsById.get(split.friendId)?.isMe) }))

  const client = getSupabaseClient()
  const { data: authData, error: authError } = await client.auth.getUser()
  if (authError) throw authError
  if (!authData.user) throw new Error('Entre na conta administradora para sincronizar despesas.')

  const { data: result, error } = await client.rpc('sync_local_expense', {
    p_data: { expense, installments, splits } as unknown as Json,
  })
  if (error) throw error
  return Boolean(result && typeof result === 'object' && !Array.isArray(result)
    && 'alreadySynced' in result && result.alreadySynced === true)
}
