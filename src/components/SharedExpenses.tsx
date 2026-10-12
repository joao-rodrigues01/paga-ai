import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Clock3, ReceiptText, RefreshCw } from 'lucide-react'
import { getSupabaseClient } from '../lib/supabase'
import type { Database } from '../types/database.types'

type Friendship = Database['public']['Tables']['friendships']['Row']
type Split = Database['public']['Tables']['expense_splits']['Row']
type Installment = Database['public']['Tables']['expense_installments']['Row']
type Expense = Database['public']['Tables']['expenses']['Row']

type ShareView = {
  split: Split
  memberName: string
}

type InstallmentView = {
  installment: Installment
  shares: ShareView[]
}

type ExpenseView = {
  expense: Expense
  installments: InstallmentView[]
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; expenses: ExpenseView[] }

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
type FriendshipView = Pick<Friendship, 'id' | 'friend_name'>

function expenseDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR')
}

export function SharedExpenses() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoadState({ status: 'loading' })
      try {
        const client = getSupabaseClient()
        const { data: userData, error: userError } = await client.auth.getUser()
        if (userError) throw userError
        if (!userData.user) throw new Error('Entre na sua conta para consultar despesas compartilhadas.')

        const { data: friendships, error: friendshipError } = await client
          .from('friendships')
          .select('id, friend_name')
          .eq('friend_profile_id', userData.user.id)
          .eq('status', 'accepted')
        if (friendshipError) throw friendshipError

        const accepted = (friendships ?? []) as FriendshipView[]
        if (accepted.length === 0) {
          if (active) setLoadState({ status: 'ready', expenses: [] })
          return
        }

        const friendshipIds = accepted.map((friendship) => friendship.id)
        const { data: splits, error: splitError } = await client
          .from('expense_splits')
          .select('id, installment_id, payer_profile_id, payer_contact_id, friendship_id, profile_id, dependent_id, amount_owed, is_paid, paid_at, created_at, updated_at')
          .eq('profile_id', userData.user.id)
          .in('friendship_id', friendshipIds)
        if (splitError) throw splitError

        const acceptedSplits = (splits ?? []) as Split[]
        if (acceptedSplits.length === 0) {
          if (active) setLoadState({ status: 'ready', expenses: [] })
          return
        }

        const installmentIds = [...new Set(acceptedSplits.map((split) => split.installment_id))]
        const { data: installments, error: installmentError } = await client
          .from('expense_installments')
          .select('id, expense_id, installment_number, amount, due_date')
          .in('id', installmentIds)
        if (installmentError) throw installmentError

        const installmentRows = (installments ?? []) as Installment[]
        const expenseIds = [...new Set(installmentRows.map((installment) => installment.expense_id))]
        const { data: expenses, error: expenseError } = await client
          .from('expenses')
          .select('id, title, total_amount, date, group_id, created_by, credit_card_id, payment_method, installments_count, created_at, updated_at')
          .in('id', expenseIds)
        if (expenseError) throw expenseError

        const dependentIds = [...new Set(acceptedSplits.flatMap((split) => split.dependent_id ? [split.dependent_id] : []))]
        const dependentNames = new Map<string, string>()
        if (dependentIds.length > 0) {
          const { data: dependents, error: dependentError } = await client
            .from('dependents')
            .select('id, name')
            .in('id', dependentIds)
          if (dependentError) throw dependentError
          for (const dependent of dependents ?? []) dependentNames.set(dependent.id, dependent.name)
        }

        const friendshipNames = new Map(accepted.map((friendship) => [friendship.id, friendship.friend_name]))
        const expensesById = new Map(((expenses ?? []) as Expense[]).map((expense) => [expense.id, expense]))
        const installmentsByExpense = new Map<string, InstallmentView[]>()
        for (const installment of installmentRows) {
          installmentsByExpense.set(installment.expense_id, [
            ...(installmentsByExpense.get(installment.expense_id) ?? []),
            { installment, shares: [] },
          ])
        }

        const installmentViewById = new Map<string, InstallmentView>()
        for (const rows of installmentsByExpense.values()) {
          for (const row of rows) installmentViewById.set(row.installment.id, row)
        }
        for (const split of acceptedSplits) {
          const installmentView = installmentViewById.get(split.installment_id)
          if (!installmentView) continue
          const responsibleName = friendshipNames.get(split.friendship_id ?? '') ?? 'Responsável'
          const dependentName = split.dependent_id ? dependentNames.get(split.dependent_id) : undefined
          installmentView.shares.push({
            split,
            memberName: dependentName ? `${dependentName} · dependente de ${responsibleName}` : responsibleName,
          })
        }

        const result: ExpenseView[] = [...installmentsByExpense.entries()].flatMap(([expenseId, rows]) => {
          const expense = expensesById.get(expenseId)
          if (!expense) return []
          return [{
            expense,
            installments: rows.sort((a, b) => a.installment.installment_number - b.installment.installment_number),
          }]
        }).sort((a, b) => b.expense.date.localeCompare(a.expense.date))

        if (active) setLoadState({ status: 'ready', expenses: result })
      } catch (error) {
        if (active) setLoadState({ status: 'error', message: error instanceof Error ? error.message : 'Não foi possível carregar as despesas compartilhadas.' })
      }
    }

    void load()
    return () => { active = false }
  }, [reloadKey])

  if (loadState.status === 'loading') return <section className="mb-6 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card md:p-6" aria-live="polite"><p className="text-sm text-muted">Carregando despesas compartilhadas…</p></section>
  if (loadState.status === 'error') return <section className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 md:p-6" role="alert"><div className="flex items-start gap-3"><CircleAlert size={18} className="mt-0.5 shrink-0 text-rose-700" /><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-rose-900">Não foi possível carregar seus compartilhamentos</h2><p className="mt-1 break-words text-sm text-rose-800">{loadState.message}</p></div><button type="button" onClick={() => setReloadKey((key) => key + 1)} className="rounded-lg p-2 text-rose-800 hover:bg-rose-100" aria-label="Tentar carregar novamente"><RefreshCw size={16} /></button></div></section>
  if (loadState.expenses.length === 0) return null

  return <section className="mb-6 space-y-4" aria-labelledby="shared-expenses-title">
    <div><h2 id="shared-expenses-title" className="text-lg font-semibold">Despesas compartilhadas com você</h2><p className="mt-1 text-sm text-muted">Parcelas e valores que seus amigos dividiram com sua conta.</p></div>
    {loadState.expenses.map(({ expense, installments }) => {
      const expenseShares = installments.flatMap((installment) => installment.shares)
      const totalOwed = expenseShares.reduce((sum, share) => sum + share.split.amount_owed, 0)
      const totalPending = expenseShares.filter((share) => !share.split.is_paid).reduce((sum, share) => sum + share.split.amount_owed, 0)
      return <article key={expense.id} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><ReceiptText size={18} /></span><div className="min-w-0"><h3 className="truncate font-semibold">{expense.title}</h3><p className="mt-1 text-xs text-muted">Compra em {expenseDate(expense.date)} · total {currency.format(expense.total_amount)}</p></div></div>
          <div className="text-right"><p className="text-xs text-muted">Sua parte</p><b className="text-sm">{currency.format(totalOwed)}</b><p className="mt-1 text-xs text-muted">{currency.format(totalPending)} pendente</p></div>
        </div>
        <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
          {installments.map(({ installment, shares }) => <div key={installment.id} className="py-3">
            <div className="mb-2 flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-600">Parcela {installment.installment_number}/{expense.installments_count} · vence {expenseDate(installment.due_date)}</p><span className="text-xs text-muted">Parcela total {currency.format(installment.amount)}</span></div>
            <div className="space-y-2">{shares.map(({ split, memberName }) => <div key={split.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"><div className="min-w-0"><p className="truncate text-xs font-medium">{memberName}</p><p className="text-[11px] text-muted">{split.is_paid ? `Pago${split.paid_at ? ` em ${expenseDate(split.paid_at.slice(0, 10))}` : ''}` : 'Pendente'}</p></div><div className="flex items-center gap-2"><b className="text-sm">{currency.format(split.amount_owed)}</b>{split.is_paid ? <CheckCircle2 size={16} className="text-brand" aria-label="Pago" /> : <Clock3 size={16} className="text-amber-600" aria-label="Pendente" />}</div></div>)}</div>
          </div>)}
        </div>
      </article>
    })}
  </section>
}
