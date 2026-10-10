import { dateToISO, getFirstDueDate } from './expense.ts'
import type { CreditCard, Expense, ExpenseInstallment, ExpenseSplit, Friend } from '../types.ts'

export interface PersistedData {
  friends: Friend[]
  creditCards: CreditCard[]
  expenses: Expense[]
  expenseInstallments: ExpenseInstallment[]
  expenseSplits: ExpenseSplit[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

export const normalizeFriends = (value: unknown, defaultMe: Friend): Friend[] => {
  const friends = Array.isArray(value) ? value.filter((item): item is Friend =>
    Boolean(isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string'),
  ).map((friend) => ({ ...friend, dependents: Array.isArray(friend.dependents) ? friend.dependents : [] })) : []
  const meIndex = friends.findIndex((friend) => friend.isMe)
  if (meIndex < 0) return [defaultMe, ...friends]
  return friends.map((friend, index) => ({ ...friend, isMe: index === meIndex }))
}

export const migratePersisted = (persisted: unknown, newId: () => string, defaultMe: Friend): PersistedData => {
  const data = isRecord(persisted) ? persisted : {}
  const friends = normalizeFriends(data.friends, defaultMe)
  const creditCards = Array.isArray(data.creditCards) ? data.creditCards as CreditCard[] : []
  const rawExpenses = Array.isArray(data.expenses) ? data.expenses as Array<Partial<Expense> & { id: string; title: string; totalAmount: number; date: string }> : []
  const expenses: Expense[] = rawExpenses.map((expense) => ({
    ...expense,
    createdAt: expense.createdAt ?? new Date().toISOString(),
    installmentsCount: Number.isInteger(expense.installmentsCount) && (expense.installmentsCount ?? 0) > 0 ? expense.installmentsCount! : 1,
  }))
  const expenseInstallments = Array.isArray(data.expenseInstallments) ? [...data.expenseInstallments as ExpenseInstallment[]] : []
  const oldSplits = Array.isArray(data.expenseSplits) ? data.expenseSplits as Array<Partial<ExpenseSplit> & { id: string; friendId: string; amountOwed: number; isPaid: boolean; expenseId?: string }> : []
  const firstInstallment = new Map<string, ExpenseInstallment>()
  for (const installment of expenseInstallments) if (installment.installmentNumber === 1) firstInstallment.set(installment.expenseId, installment)
  for (const expense of expenses) {
    if (firstInstallment.has(expense.id)) continue
    const card = creditCards.find((item) => item.id === expense.creditCardId)
    const installment = {
      id: newId(), expenseId: expense.id, installmentNumber: 1, amount: expense.totalAmount,
      dueDate: dateToISO(getFirstDueDate(expense.date, card)),
    }
    expenseInstallments.push(installment)
    firstInstallment.set(expense.id, installment)
  }
  const expenseSplits: ExpenseSplit[] = oldSplits.flatMap((split) => {
    const installmentId = split.expenseInstallmentId ?? (split.expenseId ? firstInstallment.get(split.expenseId)?.id : undefined)
    return installmentId ? [{
      id: split.id, expenseInstallmentId: installmentId, friendId: split.friendId,
      ...(split.dependentId ? { dependentId: split.dependentId } : {}), amountOwed: split.amountOwed,
      isPaid: split.isPaid, ...(split.paidAt ? { paidAt: split.paidAt } : {}),
    }] : []
  })
  return { friends, creditCards, expenses, expenseInstallments, expenseSplits }
}
