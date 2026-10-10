import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { dateFromISO, generateExpenseRecords, validateExpenseInput } from '../domain/expense'
import { migratePersisted, normalizeFriends, type PersistedData } from '../domain/migration'
import type { CreditCard, Dependent, Friend } from '../types'

export interface ExpenseParticipantInput {
  friendId: string
  dependentId?: string
  amountOwed: number
}

export interface NewExpenseInput {
  title: string
  totalAmount: number
  date: string
  creditCardId?: string
  installmentsCount: number
  splits: ExpenseParticipantInput[]
}

export interface BackupEnvelope {
  format: 'pagaai-backup'
  version: 1
  exportedAt: string
  data: PersistedData
}

interface AppState extends PersistedData {
  addFriend: (friend: Omit<Friend, 'id' | 'createdAt'>) => string
  updateFriend: (friendId: string, updates: Pick<Friend, 'name' | 'avatar' | 'pixKey'>) => void
  deleteFriend: (friendId: string) => void
  addCreditCard: (card: Omit<CreditCard, 'id'>) => string
  updateCreditCard: (cardId: string, updates: Omit<CreditCard, 'id'>) => void
  deleteCreditCard: (cardId: string) => void
  addDependent: (friendId: string, name: string) => string
  updateDependent: (friendId: string, dependentId: string, name: string) => void
  deleteDependent: (friendId: string, dependentId: string) => void
  addExpense: (expense: NewExpenseInput) => string
  updateExpense: (expenseId: string, expense: NewExpenseInput) => void
  deleteExpense: (expenseId: string) => void
  markAsPaid: (splitId: string) => void
  restoreBackup: (input: unknown) => void
  ensureMe: () => void
}

export const STORAGE_ERROR_EVENT = 'pagaai:storage-error'
const ME_ID = '00000000-0000-4000-8000-000000000001'
let lastStorageWarning: string | null = null
const DEFAULT_ME: Friend = {
  id: ME_ID, name: 'Eu', avatar: '🙋', isMe: true, dependents: [], createdAt: '2026-01-01T00:00:00.000Z',
}
const newId = (): string => crypto.randomUUID()
const cents = (amount: number): number => Math.round(amount * 100)

const reportStorageError = (action: string, error: unknown) => {
  const message = action === 'write'
    ? 'O navegador não conseguiu salvar no localStorage. Os dados permanecem disponíveis nesta sessão, mas talvez não sobrevivam ao recarregamento. Exporte um backup.'
    : 'O navegador bloqueou o acesso ao localStorage. Os dados não podem ser garantidos após fechar esta sessão.'
  lastStorageWarning = message
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: { action, message, cause: error instanceof Error ? error.message : undefined } }))
}

export const getStorageWarning = (): string | null => lastStorageWarning

const createSafeStorage = (): StateStorage => {
  const memory = new Map<string, string>()
  return {
    getItem: (name) => {
      if (memory.has(name)) return memory.get(name) ?? null
      try { const value = localStorage.getItem(name); lastStorageWarning = null; return value } catch (error) {
        reportStorageError('read', error)
        return null
      }
    },
    setItem: (name, value) => {
      try { localStorage.setItem(name, value); lastStorageWarning = null } catch (error) {
        memory.set(name, value)
        reportStorageError('write', error)
      }
    },
    removeItem: (name) => {
      memory.delete(name)
      try { localStorage.removeItem(name); lastStorageWarning = null } catch (error) { reportStorageError('remove', error) }
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const normalizeBackup = (input: unknown): PersistedData => {
  const envelope = isRecord(input) && input.format === 'pagaai-backup' ? input : undefined
  if (envelope && envelope.version !== 1) throw new Error('A versão deste backup não é compatível.')
  const data = envelope ? envelope.data : input
  if (!isRecord(data) || !['friends', 'creditCards', 'expenses', 'expenseInstallments', 'expenseSplits'].every((key) => Array.isArray(data[key]))) {
    throw new Error('O arquivo não contém um backup PagaAí válido.')
  }
  const normalized = migratePersisted(data, newId, DEFAULT_ME)
  const idsUnique = (items: Array<{ id: string }>) => new Set(items.map((item) => item.id)).size === items.length
  if (!idsUnique(normalized.friends) || !idsUnique(normalized.creditCards) || !idsUnique(normalized.expenses) || !idsUnique(normalized.expenseInstallments) || !idsUnique(normalized.expenseSplits)) {
    throw new Error('O backup contém identificadores duplicados.')
  }
  const friendById = new Map(normalized.friends.map((friend) => [friend.id, friend]))
  const expenseById = new Map(normalized.expenses.map((expense) => [expense.id, expense]))
  const installmentById = new Map(normalized.expenseInstallments.map((installment) => [installment.id, installment]))
  if (normalized.friends.some((friend) => !friend.name.trim() || typeof friend.avatar !== 'string' || !Array.isArray(friend.dependents) || friend.dependents.some((dependent) => !isRecord(dependent) || typeof dependent.id !== 'string' || typeof dependent.name !== 'string' || !dependent.name.trim()) || new Set(friend.dependents.map((dependent) => dependent.id)).size !== friend.dependents.length)) throw new Error('O backup contém um amigo ou dependente inválido.')
  if (normalized.creditCards.some((card) => typeof card.name !== 'string' || !card.name.trim() || !Number.isInteger(card.closingDay) || card.closingDay < 1 || card.closingDay > 31 || !Number.isInteger(card.dueDay) || card.dueDay < 1 || card.dueDay > 31)) throw new Error('O backup contém um cartão com dados inválidos.')
  if (normalized.expenses.some((expense) => typeof expense.title !== 'string' || !expense.title.trim() || !Number.isFinite(expense.totalAmount) || expense.totalAmount <= 0 || !Number.isInteger(expense.installmentsCount) || expense.installmentsCount < 1 || expense.installmentsCount > 48 || (expense.creditCardId && !normalized.creditCards.some((card) => card.id === expense.creditCardId)))) throw new Error('O backup contém uma despesa inválida.')
  for (const expense of normalized.expenses) dateFromISO(expense.date)
  if (normalized.expenseInstallments.some((item) => !expenseById.has(item.expenseId) || !Number.isInteger(item.installmentNumber) || item.installmentNumber < 1 || !Number.isFinite(item.amount) || item.amount < 0)) throw new Error('O backup contém uma parcela inválida.')
  for (const item of normalized.expenseInstallments) dateFromISO(item.dueDate)
  for (const split of normalized.expenseSplits) {
    const installment = installmentById.get(split.expenseInstallmentId)
    const friend = friendById.get(split.friendId)
    if (!installment || !friend || !Number.isFinite(split.amountOwed) || split.amountOwed < 0 || typeof split.isPaid !== 'boolean' || (split.paidAt && Number.isNaN(Date.parse(split.paidAt))) || (split.dependentId && !friend.dependents?.some((dependent) => dependent.id === split.dependentId))) throw new Error('O backup contém uma divisão sem relacionamento válido.')
  }
  for (const expense of normalized.expenses) {
    const expenseItems = normalized.expenseInstallments.filter((item) => item.expenseId === expense.id)
    if (expenseItems.length !== expense.installmentsCount || new Set(expenseItems.map((item) => item.installmentNumber)).size !== expense.installmentsCount || expenseItems.reduce((sum, item) => sum + cents(item.amount), 0) !== cents(expense.totalAmount)) throw new Error(`As parcelas da despesa “${expense.title}” não fecham com o total.`)
    for (const item of expenseItems) {
      const itemSplits = normalized.expenseSplits.filter((split) => split.expenseInstallmentId === item.id)
      const participantKeys = itemSplits.map((split) => `${split.friendId}:${split.dependentId ?? ''}`)
      if (new Set(participantKeys).size !== participantKeys.length) throw new Error(`A parcela ${item.installmentNumber} de “${expense.title}” tem participantes duplicados.`)
      if (itemSplits.reduce((sum, split) => sum + cents(split.amountOwed), 0) !== cents(item.amount)) throw new Error(`As divisões da parcela ${item.installmentNumber} de “${expense.title}” não fecham com o total.`)
    }
  }
  return normalized
}

export const useAppStore = create<AppState>()(persist((set, get) => ({
  friends: [DEFAULT_ME], creditCards: [], expenses: [], expenseInstallments: [], expenseSplits: [],
  addFriend: (friend) => {
    const id = newId()
    set((state) => ({ friends: [...state.friends, { ...friend, isMe: false, dependents: friend.dependents ?? [], id, createdAt: new Date().toISOString() }] }))
    return id
  },
  updateFriend: (friendId, updates) => {
    if (!updates.name.trim()) throw new Error('O nome do amigo é obrigatório.')
    set((state) => {
      if (!state.friends.some((friend) => friend.id === friendId)) throw new Error('Amigo não encontrado.')
      return { friends: state.friends.map((friend) => friend.id === friendId ? { ...friend, ...updates, name: updates.name.trim(), avatar: updates.avatar.trim() || '🙂', ...(updates.pixKey?.trim() ? { pixKey: updates.pixKey.trim() } : { pixKey: undefined }) } : friend) }
    })
  },
  deleteFriend: (friendId) => {
    const { friends, expenseSplits } = get()
    const friend = friends.find((item) => item.id === friendId)
    if (!friend) throw new Error('Amigo não encontrado.')
    if (friend.isMe) throw new Error('O perfil “Eu” não pode ser removido.')
    if (expenseSplits.some((split) => split.friendId === friendId)) throw new Error('Este amigo participa de despesas. Remova ou ajuste essas despesas antes de excluí-lo.')
    set((state) => ({ friends: state.friends.filter((item) => item.id !== friendId) }))
  },
  addCreditCard: (card) => {
    validateCard(card)
    const id = newId()
    set((state) => ({ creditCards: [...state.creditCards, { ...card, id }] }))
    return id
  },
  updateCreditCard: (cardId, updates) => {
    validateCard(updates)
    const { expenses, creditCards } = get()
    const card = creditCards.find((item) => item.id === cardId)
    if (!card) throw new Error('Cartão não encontrado.')
    const used = expenses.some((expense) => expense.creditCardId === cardId)
    if (used && (card.closingDay !== updates.closingDay || card.dueDay !== updates.dueDay)) throw new Error('As datas deste cartão já são usadas por despesas. Altere somente o nome ou desvincule as despesas primeiro.')
    set((state) => ({ creditCards: state.creditCards.map((item) => item.id === cardId ? { ...updates, id: cardId, name: updates.name.trim() } : item) }))
  },
  deleteCreditCard: (cardId) => {
    if (!get().creditCards.some((card) => card.id === cardId)) throw new Error('Cartão não encontrado.')
    if (get().expenses.some((expense) => expense.creditCardId === cardId)) throw new Error('Este cartão está vinculado a despesas. Desvincule-as antes de excluí-lo.')
    set((state) => ({ creditCards: state.creditCards.filter((card) => card.id !== cardId) }))
  },
  addDependent: (friendId, name) => {
    const dependent: Dependent = { id: newId(), name: name.trim() }
    if (!dependent.name) throw new Error('Informe o nome do dependente.')
    if (!get().friends.some((friend) => friend.id === friendId)) throw new Error('Responsável não encontrado.')
    set((state) => ({ friends: state.friends.map((friend) => friend.id === friendId ? { ...friend, dependents: [...(friend.dependents ?? []), dependent] } : friend) }))
    return dependent.id
  },
  updateDependent: (friendId, dependentId, name) => {
    if (!name.trim()) throw new Error('O nome do dependente é obrigatório.')
    set((state) => {
      const friend = state.friends.find((item) => item.id === friendId)
      if (!friend?.dependents?.some((item) => item.id === dependentId)) throw new Error('Dependente não encontrado.')
      return { friends: state.friends.map((item) => item.id === friendId ? { ...item, dependents: item.dependents?.map((dependent) => dependent.id === dependentId ? { ...dependent, name: name.trim() } : dependent) } : item) }
    })
  },
  deleteDependent: (friendId, dependentId) => {
    const { friends, expenseSplits } = get()
    const friend = friends.find((item) => item.id === friendId)
    if (!friend?.dependents?.some((dependent) => dependent.id === dependentId)) throw new Error('Dependente não encontrado.')
    if (expenseSplits.some((split) => split.friendId === friendId && split.dependentId === dependentId)) throw new Error('Este dependente participa de despesas. Ajuste essas despesas antes de removê-lo.')
    set((state) => ({ friends: state.friends.map((item) => item.id === friendId ? { ...item, dependents: item.dependents?.filter((dependent) => dependent.id !== dependentId) } : item) }))
  },
  addExpense: (input) => {
    const records = generateExpenseRecords(input, get().friends, get().creditCards, newId(), new Date().toISOString())
    set((state) => ({ expenses: [...state.expenses, records.expense], expenseInstallments: [...state.expenseInstallments, ...records.installments], expenseSplits: [...state.expenseSplits, ...records.splits] }))
    return records.expense.id
  },
  updateExpense: (expenseId, input) => {
    const state = get()
    const existing = state.expenses.find((expense) => expense.id === expenseId)
    if (!existing) throw new Error('Despesa não encontrada.')
    const installmentIds = new Set(state.expenseInstallments.filter((item) => item.expenseId === expenseId).map((item) => item.id))
    if (state.expenseSplits.some((split) => installmentIds.has(split.expenseInstallmentId) && split.isPaid && !state.friends.find((friend) => friend.id === split.friendId)?.isMe)) throw new Error('Esta despesa já tem pagamentos registrados e não pode ser editada para preservar o histórico.')
    const records = generateExpenseRecords(input, state.friends, state.creditCards, expenseId, existing.createdAt)
    set((current) => ({
      expenses: current.expenses.map((expense) => expense.id === expenseId ? records.expense : expense),
      expenseInstallments: [...current.expenseInstallments.filter((item) => item.expenseId !== expenseId), ...records.installments],
      expenseSplits: [...current.expenseSplits.filter((split) => !installmentIds.has(split.expenseInstallmentId)), ...records.splits],
    }))
  },
  deleteExpense: (expenseId) => {
    const state = get()
    const installmentIds = new Set(state.expenseInstallments.filter((item) => item.expenseId === expenseId).map((item) => item.id))
    if (!state.expenses.some((expense) => expense.id === expenseId)) throw new Error('Despesa não encontrada.')
    if (state.expenseSplits.some((split) => installmentIds.has(split.expenseInstallmentId) && split.isPaid && !state.friends.find((friend) => friend.id === split.friendId)?.isMe)) throw new Error('Esta despesa tem pagamentos registrados e não pode ser excluída.')
    set((current) => ({
      expenses: current.expenses.filter((expense) => expense.id !== expenseId),
      expenseInstallments: current.expenseInstallments.filter((item) => item.expenseId !== expenseId),
      expenseSplits: current.expenseSplits.filter((split) => !installmentIds.has(split.expenseInstallmentId)),
    }))
  },
  markAsPaid: (splitId) => set((state) => ({
    expenseSplits: state.expenseSplits.map((split) => split.id === splitId && !split.isPaid ? { ...split, isPaid: true, paidAt: new Date().toISOString() } : split),
  })),
  restoreBackup: (input) => {
    const restored = normalizeBackup(input)
    set(restored)
  },
      ensureMe: () => set((state) => ({ friends: normalizeFriends(state.friends, DEFAULT_ME) })),
}), {
  name: 'pagaai-storage', storage: createJSONStorage(() => createSafeStorage()), version: 3,
  migrate: (persisted) => migratePersisted(persisted, newId, DEFAULT_ME),
  onRehydrateStorage: () => (state) => state?.ensureMe(),
}))

function validateCard(card: Omit<CreditCard, 'id'>): void {
  if (!card.name.trim()) throw new Error('O nome do cartão é obrigatório.')
  if (!Number.isInteger(card.closingDay) || card.closingDay < 1 || card.closingDay > 31 || !Number.isInteger(card.dueDay) || card.dueDay < 1 || card.dueDay > 31) throw new Error('Os dias de fechamento e vencimento devem estar entre 1 e 31.')
}

export const createBackupEnvelope = (data: PersistedData): BackupEnvelope => ({
  format: 'pagaai-backup', version: 1, exportedAt: new Date().toISOString(), data,
})

export const validateExpenseForStore = validateExpenseInput
