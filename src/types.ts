export interface Dependent {
  id: string
  name: string
}

export interface Friend {
  id: string
  name: string
  avatar: string
  pixKey?: string
  isMe?: boolean
  dependents?: Dependent[]
  createdAt: string
}

export interface CreditCard {
  id: string
  name: string
  closingDay: number
  dueDay: number
}

export interface Expense {
  id: string
  title: string
  totalAmount: number
  date: string
  creditCardId?: string
  installmentsCount: number
  createdAt: string
}

export interface ExpenseInstallment {
  id: string
  expenseId: string
  installmentNumber: number
  amount: number
  dueDate: string
}

export interface ExpenseSplit {
  id: string
  expenseInstallmentId: string
  friendId: string
  dependentId?: string
  amountOwed: number
  isPaid: boolean
  paidAt?: string
}
