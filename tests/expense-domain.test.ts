import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateExpenseRecords, getFirstDueDate } from '../src/domain/expense.ts'
import { migratePersisted } from '../src/domain/migration.ts'
import type { CreditCard, Friend } from '../src/types.ts'

const card: CreditCard = { id: 'card-1', name: 'Cartão', closingDay: 25, dueDay: 5 }
const me: Friend = { id: 'me', name: 'Eu', avatar: '🙋', isMe: true, createdAt: '2026-01-01T00:00:00.000Z' }
const friend: Friend = { id: 'friend', name: 'Ana', avatar: '🙂', createdAt: '2026-01-01T00:00:00.000Z' }

test('compra até o fechamento usa o vencimento do ciclo seguinte', () => {
  assert.equal(getFirstDueDate('2026-10-25', card).toISOString().slice(0, 10), '2026-11-05')
})

test('compra depois do fechamento pula um ciclo adicional', () => {
  assert.equal(getFirstDueDate('2026-10-26', card).toISOString().slice(0, 10), '2026-12-05')
})

test('parcelas mantêm a divisão exata em centavos', () => {
  const records = generateExpenseRecords({
    title: 'Compra', totalAmount: 0.10, date: '2026-01-26', creditCardId: 'card-1', installmentsCount: 3,
    splits: [{ friendId: 'friend', amountOwed: 0.10 }],
  }, [me, friend], [card], 'expense-1', '2026-01-26T12:00:00.000Z')
  assert.deepEqual(records.installments.map((item) => item.dueDate), ['2026-03-05', '2026-04-05', '2026-05-05'])
  assert.equal(records.installments.reduce((sum, item) => sum + Math.round(item.amount * 100), 0), 10)
  assert.deepEqual(records.splits.map((split) => Math.round(split.amountOwed * 100)), [4, 3, 3])
})

test('Pix parcelado vence mensalmente no dia da compra, com limite no fim do mês', () => {
  const records = generateExpenseRecords({
    title: 'Compra Pix', totalAmount: 3, date: '2026-01-31', installmentsCount: 3,
    splits: [{ friendId: 'friend', amountOwed: 3 }],
  }, [me, friend], [], 'expense-2', '2026-01-31T12:00:00.000Z')
  assert.deepEqual(records.installments.map((item) => item.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31'])
})

test('centavos restantes são distribuídos às primeiras parcelas e totais permanecem iguais', () => {
  const records = generateExpenseRecords({
    title: 'Jantar', totalAmount: 10, date: '2026-05-10', installmentsCount: 3,
    splits: [{ friendId: 'me', amountOwed: 3.34 }, { friendId: 'friend', amountOwed: 6.66 }],
  }, [me, friend], [], 'expense-3', '2026-05-10T12:00:00.000Z')
  assert.deepEqual(records.installments.map((item) => Math.round(item.amount * 100)), [334, 333, 333])
  assert.equal(records.splits.reduce((sum, split) => sum + Math.round(split.amountOwed * 100), 0), 1000)
  assert.ok(records.splits.filter((split) => split.friendId === 'me').every((split) => split.isPaid))
})

test('migração cria “Eu” e converte despesas e divisões do formato antigo', () => {
  const oldState = {
    friends: [{ id: 'friend', name: 'Ana', avatar: '🙂', createdAt: '2025-01-01T00:00:00.000Z' }],
    creditCards: [],
    expenses: [{ id: 'old-expense', title: 'Almoço', totalAmount: 20, date: '2025-04-12', createdAt: '2025-04-12T12:00:00.000Z' }],
    expenseSplits: [{ id: 'old-split', expenseId: 'old-expense', friendId: 'friend', amountOwed: 20, isPaid: false }],
  }
  const defaultMe = { id: 'me', name: 'Eu', avatar: '🙋', isMe: true, createdAt: '2026-01-01T00:00:00.000Z' }
  const migrated = migratePersisted(oldState, () => 'new-installment', defaultMe)
  assert.equal(migrated.friends.find((item) => item.isMe)?.id, 'me')
  assert.equal(migrated.expenses[0].installmentsCount, 1)
  assert.equal(migrated.expenseInstallments[0].id, 'new-installment')
  assert.equal(migrated.expenseSplits[0].expenseInstallmentId, 'new-installment')
})
