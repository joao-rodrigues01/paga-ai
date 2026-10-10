import type { CreditCard, Expense, ExpenseInstallment, ExpenseSplit, Friend } from '../types'
import type { ExpenseParticipantInput, NewExpenseInput } from '../store/useAppStore'

export interface GeneratedExpenseRecords {
  expense: Expense
  installments: ExpenseInstallment[]
  splits: ExpenseSplit[]
}

export const toCents = (value: number): number => Math.round(value * 100)
const asLocalDate = (year: number, monthIndex: number, day: number): Date =>
  new Date(year, monthIndex, Math.min(day, new Date(year, monthIndex + 1, 0).getDate()), 12)
export const dateToISO = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
export const dateFromISO = (value: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('Informe uma data válida para a despesa.')
  const [, yearValue, monthValue, dayValue] = match
  const year = Number(yearValue)
  const month = Number(monthValue)
  const day = Number(dayValue)
  const date = asLocalDate(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('Informe uma data válida para a despesa.')
  }
  return date
}

export const getFirstDueDate = (purchaseDate: string, card?: CreditCard): Date => {
  const purchase = dateFromISO(purchaseDate)
  if (!card) return purchase
  const closingMonth = new Date(purchase.getFullYear(), purchase.getMonth() + (purchase.getDate() > card.closingDay ? 1 : 0), 1)
  const dueMonthOffset = card.dueDay <= card.closingDay ? 1 : 0
  return asLocalDate(closingMonth.getFullYear(), closingMonth.getMonth() + dueMonthOffset, card.dueDay)
}

export const validateExpenseInput = (input: NewExpenseInput, friends: Friend[], cards: CreditCard[]): void => {
  if (!input.title.trim()) throw new Error('Informe um título para a despesa.')
  if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0) throw new Error('O valor total deve ser maior que zero.')
  if (!Number.isInteger(input.installmentsCount) || input.installmentsCount < 1 || input.installmentsCount > 48) throw new Error('O número de parcelas deve estar entre 1 e 48.')
  dateFromISO(input.date)
  if (input.splits.length === 0) throw new Error('Selecione ao menos um participante.')
  const participantKeys = input.splits.map(({ friendId, dependentId }) => `${friendId}:${dependentId ?? ''}`)
  if (new Set(participantKeys).size !== input.splits.length) throw new Error('Cada participante pode aparecer apenas uma vez.')
  if (input.splits.some((split) => !Number.isFinite(split.amountOwed) || split.amountOwed < 0)) throw new Error('Os valores da divisão devem ser válidos e não negativos.')
  if (input.splits.reduce((sum, split) => sum + toCents(split.amountOwed), 0) !== toCents(input.totalAmount)) throw new Error('A soma das divisões precisa ser igual ao valor total.')
  for (const split of input.splits) {
    const friend = friends.find((item) => item.id === split.friendId)
    if (!friend) throw new Error('A divisão contém um participante inexistente.')
    if (split.dependentId && !friend.dependents?.some((dependent) => dependent.id === split.dependentId)) throw new Error('O dependente não pertence ao responsável selecionado.')
  }
  if (input.creditCardId && !cards.some((card) => card.id === input.creditCardId)) throw new Error('O cartão selecionado não existe.')
}

/**
 * Allocates cents across installments while keeping both dimensions exact:
 * each participant retains their full share and every card installment adds
 * up to the installment charge for the expense.
 */
export const allocateInstallmentShares = (
  totalCents: number,
  participantTotalsCents: number[],
  installmentsCount: number,
): number[][] => {
  if (installmentsCount < 1 || participantTotalsCents.length === 0) throw new Error('A divisão precisa ter participantes e parcelas válidos.')
  if (participantTotalsCents.reduce((sum, share) => sum + share, 0) !== totalCents) throw new Error('A soma das cotas não corresponde ao total da despesa.')

  const participantCount = participantTotalsCents.length
  const basePerInstallment = Math.floor(totalCents / installmentsCount)
  const installmentRemainder = totalCents % installmentsCount
  const installmentTotals = Array.from({ length: installmentsCount }, (_, index) => basePerInstallment + (index < installmentRemainder ? 1 : 0))
  const participantBases = participantTotalsCents.map((amount) => Math.floor(amount / installmentsCount))
  const participantRemainders = participantTotalsCents.map((amount) => amount % installmentsCount)
  const columnRemainders = installmentTotals.map((amount) => amount - participantBases.reduce((sum, base) => sum + base, 0))
  if (columnRemainders.some((amount) => amount < 0 || amount > participantCount)) throw new Error('Não foi possível distribuir os centavos entre as parcelas.')

  type Edge = { to: number; reverse: number; capacity: number }
  const source = 0
  const firstParticipant = 1
  const firstInstallment = firstParticipant + participantCount
  const sink = firstInstallment + installmentsCount
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => [])
  const addEdge = (from: number, to: number, capacity: number): Edge => {
    const forward: Edge = { to, reverse: graph[to].length, capacity }
    const reverse: Edge = { to: from, reverse: graph[from].length, capacity: 0 }
    graph[from].push(forward)
    graph[to].push(reverse)
    return forward
  }
  const extraEdges: Edge[][] = participantTotalsCents.map((_, participantIndex) =>
    Array.from({ length: installmentsCount }, (_, installmentIndex) =>
      addEdge(firstParticipant + participantIndex, firstInstallment + installmentIndex, 1),
    ),
  )
  participantRemainders.forEach((remainder, index) => addEdge(source, firstParticipant + index, remainder))
  columnRemainders.forEach((remainder, index) => addEdge(firstInstallment + index, sink, remainder))

  let flow = 0
  const requiredFlow = participantRemainders.reduce((sum, remainder) => sum + remainder, 0)
  while (flow < requiredFlow) {
    const parentNode = Array<number>(graph.length).fill(-1)
    const parentEdge = Array<number>(graph.length).fill(-1)
    const queue = [source]
    parentNode[source] = source
    for (let cursor = 0; cursor < queue.length && parentNode[sink] === -1; cursor += 1) {
      const node = queue[cursor]
      graph[node].forEach((edge, edgeIndex) => {
        if (edge.capacity > 0 && parentNode[edge.to] === -1) {
          parentNode[edge.to] = node
          parentEdge[edge.to] = edgeIndex
          queue.push(edge.to)
        }
      })
    }
    if (parentNode[sink] === -1) throw new Error('Não foi possível distribuir os centavos sem alterar as cotas.')
    let node = sink
    while (node !== source) {
      const parent = parentNode[node]
      const edge = graph[parent][parentEdge[node]]
      edge.capacity -= 1
      graph[node][edge.reverse].capacity += 1
      node = parent
    }
    flow += 1
  }

  return participantTotalsCents.map((_, participantIndex) =>
    Array.from({ length: installmentsCount }, (_, installmentIndex) =>
      participantBases[participantIndex] + (extraEdges[participantIndex][installmentIndex].capacity === 0 ? 1 : 0),
    ),
  )
}

export const generateExpenseRecords = (
  input: NewExpenseInput,
  friends: Friend[],
  cards: CreditCard[],
  expenseId: string,
  createdAt: string,
): GeneratedExpenseRecords => {
  validateExpenseInput(input, friends, cards)
  const expenseInput = {
    title: input.title, totalAmount: input.totalAmount, date: input.date,
    ...(input.creditCardId ? { creditCardId: input.creditCardId } : {}),
    installmentsCount: input.installmentsCount,
  }
  const record: Expense = { ...expenseInput, id: expenseId, createdAt }
  const card = input.creditCardId ? cards.find((item) => item.id === input.creditCardId) : undefined
  const firstDueDate = getFirstDueDate(input.date, card)
  const installmentDueDay = card?.dueDay ?? dateFromISO(input.date).getDate()
  const installmentSharesCents = allocateInstallmentShares(
    toCents(input.totalAmount), input.splits.map((split) => toCents(split.amountOwed)), input.installmentsCount,
  )
  const installmentTotalsCents = Array.from({ length: input.installmentsCount }, (_, installmentIndex) =>
    installmentSharesCents.reduce((sum, participantShares) => sum + participantShares[installmentIndex], 0),
  )
  const installments: ExpenseInstallment[] = []
  const generatedSplits: ExpenseSplit[] = []

  for (let installmentIndex = 0; installmentIndex < input.installmentsCount; installmentIndex += 1) {
    const dueDate = asLocalDate(firstDueDate.getFullYear(), firstDueDate.getMonth() + installmentIndex, installmentDueDay)
    const pendingSplits: ExpenseSplit[] = input.splits.map((split: ExpenseParticipantInput, participantIndex) => {
      const shareCents = installmentSharesCents[participantIndex][installmentIndex]
      const friend = friends.find((item) => item.id === split.friendId)!
      return {
        id: crypto.randomUUID(), expenseInstallmentId: '', friendId: split.friendId,
        ...(split.dependentId ? { dependentId: split.dependentId } : {}),
        amountOwed: shareCents / 100, isPaid: Boolean(friend.isMe),
        ...(friend.isMe ? { paidAt: new Date().toISOString() } : {}),
      }
    })
    const installment: ExpenseInstallment = {
      id: crypto.randomUUID(), expenseId, installmentNumber: installmentIndex + 1,
      amount: installmentTotalsCents[installmentIndex] / 100, dueDate: dateToISO(dueDate),
    }
    installments.push(installment)
    generatedSplits.push(...pendingSplits.map((split) => ({ ...split, expenseInstallmentId: installment.id })))
  }
  return { expense: record, installments, splits: generatedSplits }
}
