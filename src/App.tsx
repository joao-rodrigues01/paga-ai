import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import {
  ArrowDownLeft, ArrowUpRight, Bell, CalendarDays, Check, ChevronRight,
  CircleHelp, CreditCard, Download, LayoutDashboard, Pencil, Plus, ReceiptText,
  Settings2, Share2, Trash2, Upload, UsersRound, Wallet, X,
} from 'lucide-react'
import { createBackupEnvelope, getStorageWarning, STORAGE_ERROR_EVENT, useAppStore } from './store/useAppStore'
import { ExpenseForm } from './components/ExpenseForm'
import { MigrationTool } from './components/MigrationTool'
import { SharedExpenses } from './components/SharedExpenses'
import { createFriendInviteLink } from './lib/friendships'
import type { CreditCard as CreditCardModel, Dependent, Friend } from './types'
import type { NewExpenseInput } from './store/useAppStore'

const navigation = [
  { label: 'Visão geral', icon: LayoutDashboard },
  { label: 'Despesas', icon: ReceiptText },
  { label: 'Amigos', icon: UsersRound },
  { label: 'Cartões', icon: CreditCard },
]
type Page = (typeof navigation)[number]['label']
type Modal = 'expense' | 'friend' | 'card' | 'dependent' | null
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const currentMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export default function App() {
  const [activePage, setActivePage] = useState<Page>('Visão geral')
  const [modal, setModal] = useState<Modal>(null)
  const [feedback, setFeedback] = useState(() => getStorageWarning() ?? '')
  const [feedbackIsError, setFeedbackIsError] = useState(() => Boolean(getStorageWarning()))
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null)
  const [editingFriendId, setEditingFriendId] = useState<string | null>(null)
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [editingDependent, setEditingDependent] = useState<{ friendId: string; dependentId?: string } | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const [monthFilter, setMonthFilter] = useState(currentMonth)
  const today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  const friends = useAppStore((state) => state.friends)
  const creditCards = useAppStore((state) => state.creditCards)
  const expenses = useAppStore((state) => state.expenses)
  const installments = useAppStore((state) => state.expenseInstallments)
  const splits = useAppStore((state) => state.expenseSplits)
  const markAsPaid = useAppStore((state) => state.markAsPaid)
  const installmentsById = new Map(installments.map((installment) => [installment.id, installment]))
  const monthInstallments = installments.filter((installment) => installment.dueDate.startsWith(monthFilter))
  const monthInstallmentIds = new Set(monthInstallments.map((installment) => installment.id))
  const monthSplits = splits.filter((split) => monthInstallmentIds.has(split.expenseInstallmentId))
  const collectibleSplits = monthSplits.filter((split) => !friends.find((friend) => friend.id === split.friendId)?.isMe)
  const pending = collectibleSplits.filter((split) => !split.isPaid).reduce((sum, split) => sum + split.amountOwed, 0)
  const received = collectibleSplits.filter((split) => split.isPaid).reduce((sum, split) => sum + split.amountOwed, 0)
  const total = pending + received
  const receivedPercent = total === 0 ? 0 : Math.round((received / total) * 100)
  const paidThisMonth = splits.filter((split) => split.isPaid && split.paidAt?.startsWith(monthFilter) && !friends.find((friend) => friend.id === split.friendId)?.isMe)
  const paidThisMonthTotal = paidThisMonth.reduce((sum, split) => sum + split.amountOwed, 0)
  const upcomingBills = useMemo(() => {
    return creditCards.flatMap((card) => {
      const cardExpenseIds = new Set(expenses.filter((expense) => expense.creditCardId === card.id).map((expense) => expense.id))
      const cardInstallments = monthInstallments.filter((installment) => cardExpenseIds.has(installment.expenseId))
      if (cardInstallments.length === 0) return []
      const due = new Date(`${cardInstallments.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0].dueDate}T12:00:00`)
      return [{ card, due, amount: cardInstallments.reduce((sum, installment) => sum + installment.amount, 0) }]
    }).sort((a, b) => a.due.getTime() - b.due.getTime())
  }, [creditCards, expenses, monthInstallments])

  const openModal = (next: Modal) => { setFeedback(''); setFeedbackIsError(false); setEditingExpenseId(null); setEditingFriendId(null); setEditingCardId(null); setEditingDependent(null); setModal(next) }
  const runAction = (action: () => void, success: string) => {
    try {
      action()
      const storageWarning = getStorageWarning()
      setFeedback(storageWarning ?? success)
      setFeedbackIsError(Boolean(storageWarning))
      setModal(null)
    }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Não foi possível concluir a ação.'); setFeedbackIsError(true); setModal(null) }
  }
  const exportBackup = () => {
    const state = useAppStore.getState()
    const data = { friends: state.friends, creditCards: state.creditCards, expenses: state.expenses, expenseInstallments: state.expenseInstallments, expenseSplits: state.expenseSplits }
    const blob = new Blob([JSON.stringify(createBackupEnvelope(data), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `pagaai-backup-${currentMonth()}.json`; anchor.click(); URL.revokeObjectURL(url)
    setFeedback('Backup JSON exportado.'); setFeedbackIsError(false)
  }
  const importBackupFile = async (file?: File) => {
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!window.confirm('Importar este backup substituirá todos os dados atuais neste navegador. Deseja continuar?')) return
      runAction(() => useAppStore.getState().restoreBackup(parsed), 'Backup importado com sucesso.')
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'O arquivo não pôde ser importado.'); setFeedbackIsError(true) }
  }
  const inviteFriend = async (friendId: string) => {
    try {
      const inviteUrl = await createFriendInviteLink(friendId)
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl)
        setFeedback('Link de amizade copiado. Envie-o diretamente ao seu amigo; ele expira em 7 dias.')
      } else {
        window.prompt('Copie e envie este link ao seu amigo. Ele expira em 7 dias:', inviteUrl)
      }
      setFeedbackIsError(false)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível criar o convite. Migre o contato para o Supabase primeiro.')
      setFeedbackIsError(true)
    }
  }
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string }>).detail
      setFeedback(detail.message)
      setFeedbackIsError(true)
    }
    window.addEventListener(STORAGE_ERROR_EVENT, listener)
    return () => window.removeEventListener(STORAGE_ERROR_EVENT, listener)
  }, [])
  const addButtonText: Record<Page, string> = {
    'Visão geral': 'Nova despesa', Despesas: 'Nova despesa', Amigos: 'Novo amigo', Cartões: 'Novo cartão',
  }
  const pageSubtitle: Record<Page, string> = {
    'Visão geral': 'Acompanhe suas despesas compartilhadas.',
    Despesas: 'Despesas deste navegador e gastos compartilhados com sua conta.',
    Amigos: 'Cadastre quem divide as contas com você.',
    Cartões: 'Organize os cartões e os vencimentos das faturas.',
  }
  const handleAddClick = () => openModal(activePage === 'Amigos' ? 'friend' : activePage === 'Cartões' ? 'card' : 'expense')
  const beginExpenseEdit = (expenseId: string) => {
    openModal('expense')
    setEditingExpenseId(expenseId)
  }
  const getExpenseEditorData = (expenseId: string): NewExpenseInput | undefined => {
    const expense = expenses.find((item) => item.id === expenseId)
    if (!expense) return undefined
    const installmentIds = new Set(installments.filter((item) => item.expenseId === expenseId).map((item) => item.id))
    const totals = new Map<string, NewExpenseInput['splits'][number]>()
    for (const split of splits.filter((item) => installmentIds.has(item.expenseInstallmentId))) {
      const key = `${split.friendId}:${split.dependentId ?? ''}`
      const current = totals.get(key)
      totals.set(key, { friendId: split.friendId, ...(split.dependentId ? { dependentId: split.dependentId } : {}), amountOwed: (current?.amountOwed ?? 0) + split.amountOwed })
    }
    return { title: expense.title, totalAmount: expense.totalAmount, date: expense.date, ...(expense.creditCardId ? { creditCardId: expense.creditCardId } : {}), installmentsCount: expense.installmentsCount, splits: [...totals.values()] }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[250px] flex-col border-r border-slate-200/80 bg-white px-5 py-7 lg:flex">
        <button className="mb-11 flex items-center gap-2.5 px-2 text-left" onClick={() => setActivePage('Visão geral')}>
          <span className="grid size-9 place-items-center rounded-xl bg-brand text-lg font-bold text-white">P</span>
          <span className="text-[19px] font-bold tracking-tight">Paga<span className="text-brand">Aí</span><span className="ml-1 text-base">💸</span></span>
        </button>
        <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Menu</p>
        <Navigation activePage={activePage} onChange={setActivePage} expenseCount={expenses.length} />
        <div className="mt-auto rounded-2xl bg-[#f5f8f6] p-4">
          <div className="mb-3 grid size-8 place-items-center rounded-lg bg-white text-brand shadow-sm"><CircleHelp size={16} /></div>
          <p className="text-sm font-semibold">Tudo sob controle?</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">Seus dados ficam salvos apenas neste navegador.</p>
          <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand">100% local <ChevronRight size={14} /></span>
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-500"><Settings2 size={17} /> Configurações</div>
      </aside>

      <div className="lg:pl-[250px]">
        <header className="sticky top-0 z-10 flex h-[70px] items-center justify-between border-b border-slate-200/70 bg-white/90 px-5 backdrop-blur md:px-9">
          <div className="flex items-center gap-2 lg:hidden"><span className="grid size-8 place-items-center rounded-lg bg-brand text-sm font-bold text-white">P</span><span className="font-bold">Paga<span className="text-brand">Aí</span> 💸</span></div>
          <div className="hidden text-sm text-slate-500 lg:block">Olá! <span className="font-semibold text-ink">Vamos organizar as contas?</span></div>
          <div className="ml-auto flex items-center gap-3"><button aria-label="Notificações" className="relative grid size-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><Bell size={18} /></button><span className="grid size-9 place-items-center rounded-full bg-[#e8eee9] text-sm font-semibold text-brand-dark">EU</span></div>
        </header>

        <main className="mx-auto max-w-[1240px] px-5 pb-28 pt-8 md:px-9 md:pt-10 lg:pb-12">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div><p className="mb-1 text-xs font-medium capitalize text-muted">{today}</p><h1 className="text-[26px] font-bold tracking-tight md:text-[30px]">{activePage}</h1><p className="mt-1 text-sm text-muted">{pageSubtitle[activePage]}</p></div>
            <button onClick={handleAddClick} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"><Plus size={17} /> {addButtonText[activePage]}</button>
          </div>

          <div className="mb-5 flex flex-wrap items-center justify-end gap-2"><input ref={importInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { void importBackupFile(event.target.files?.[0]); event.currentTarget.value = '' }} /><button onClick={exportBackup} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Download size={15} /> Exportar backup</button><button onClick={() => importInput.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Upload size={15} /> Importar backup</button><MigrationTool /></div>
          {feedback && <div role={feedbackIsError ? 'alert' : 'status'} className={`mb-4 rounded-xl border px-4 py-3 text-sm ${feedbackIsError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-brand/20 bg-brand-soft text-brand-dark'}`}>{feedback}</div>}

          {activePage === 'Visão geral' && <>
            <SharedExpenses />
            <div className="mb-3 flex justify-end"><label className="flex items-center gap-2 text-xs font-medium text-muted"><CalendarDays size={15} /> Mês de referência<input type="month" aria-label="Mês de referência" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-ink outline-none focus:border-brand" /></label></div>
            <section className="grid gap-4 md:grid-cols-3" aria-label="Resumo financeiro">
              <SummaryCard dark label="Total a receber" value={currency.format(pending)} icon={<Wallet size={18} />} foot="Em aberto com seus amigos" />
              <SummaryCard label="Já recebido" value={currency.format(received)} icon={<ArrowDownLeft size={18} />} foot="Valores pagos pelos participantes" />
              <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card md:p-6"><div className="flex items-center justify-between"><p className="text-sm text-muted">Resumo dos pagamentos</p><span className="grid size-9 place-items-center rounded-xl bg-[#f2f4f3] text-slate-500"><ReceiptText size={18} /></span></div><div className="mt-4 flex items-center gap-4"><div className="relative grid size-[66px] shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(#177a55 ${receivedPercent}%, #e9eeeb ${receivedPercent}% 100%)` }}><div className="grid size-[49px] place-items-center rounded-full bg-white text-xs font-bold">{receivedPercent}%</div></div><div className="space-y-2 text-xs"><p className="flex items-center gap-2 text-slate-600"><span className="size-2 rounded-full bg-brand" /> Recebido <b className="ml-auto">{currency.format(received)}</b></p><p className="flex items-center gap-2 text-slate-600"><span className="size-2 rounded-full bg-slate-200" /> Pendente <b className="ml-auto">{currency.format(pending)}</b></p></div></div></article>
            </section>
            <section className="mt-6 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
              <article className="min-h-[300px] rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card md:p-6"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Despesas recentes</h2><p className="mt-1 text-xs text-muted">Suas últimas movimentações compartilhadas</p></div><button onClick={() => setActivePage('Despesas')} className="text-xs font-semibold text-brand">Ver todas <ChevronRight className="inline" size={14} /></button></div>{expenses.length === 0 ? <EmptyState icon={<ReceiptText size={21} />} title="Nenhuma despesa por aqui" description="Adicione uma despesa para começar a acompanhar os valores." /> : <div className="mt-5 divide-y divide-slate-100">{expenses.slice(-5).reverse().map((expense) => <ExpenseRow key={expense.id} expenseId={expense.id} title={expense.title} amount={expense.totalAmount} date={expense.date} />)}</div>}</article>
              <article className="min-h-[300px] rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card md:p-6"><div><h2 className="font-semibold">Próximas faturas</h2><p className="mt-1 text-xs text-muted">Despesas de cartão por vencimento</p></div>{upcomingBills.length === 0 ? <EmptyState icon={<CreditCard size={21} />} title="Nenhuma fatura próxima" description="Cadastre um cartão e vincule despesas para acompanhar os vencimentos." /> : <div className="mt-5 space-y-3">{upcomingBills.map(({ card, due, amount }) => <div key={card.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-white text-brand"><CreditCard size={17} /></span><div><p className="text-sm font-medium">{card.name}</p><p className="text-xs text-muted">Vence em {due.toLocaleDateString('pt-BR')}</p></div></div><b className="text-sm">{currency.format(amount)}</b></div>)}</div>}</article>
            </section>
            <section className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card md:p-6"><div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="font-semibold">Histórico de pagamentos recebidos</h2><p className="mt-1 text-xs text-muted">Filtrado pela data em que o pagamento foi marcado</p></div><b className="text-lg text-brand">{currency.format(paidThisMonthTotal)}</b></div>{paidThisMonth.length === 0 ? <p className="py-8 text-center text-sm text-muted">Nenhum pagamento registrado neste mês.</p> : <div className="mt-3 divide-y divide-slate-100">{paidThisMonth.slice().sort((a, b) => (b.paidAt ?? '').localeCompare(a.paidAt ?? '')).map((split) => { const installment = installmentsById.get(split.expenseInstallmentId); const expense = expenses.find((item) => item.id === installment?.expenseId); const friend = friends.find((item) => item.id === split.friendId); const dependent = friend?.dependents?.find((item) => item.id === split.dependentId); return <div key={split.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{expense?.title ?? 'Despesa'} · {dependent?.name ?? friend?.name ?? 'Amigo'}</p><p className="text-xs text-muted">Pago em {split.paidAt ? new Date(split.paidAt).toLocaleDateString('pt-BR') : 'data desconhecida'}{installment ? ` · Parcela ${installment.installmentNumber}` : ''}</p></div><b className="text-sm">{currency.format(split.amountOwed)}</b></div>})}</div>}</section>
          </>}

          {activePage === 'Amigos' && <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card md:p-6"><SectionHeading title="Seus amigos" subtitle={`${friends.length} perfil${friends.length === 1 ? '' : 's'} cadastrado${friends.length === 1 ? '' : 's'}`} />{friends.length === 0 ? <EmptyState icon={<UsersRound size={21} />} title="Cadastre seu primeiro amigo" description="Depois você poderá incluir essa pessoa nas despesas compartilhadas." /> : <div className="mt-4 divide-y divide-slate-100">{friends.map((friend) => <div key={friend.id} className="py-4"><div className="flex flex-wrap items-center gap-3"><Avatar value={friend.avatar} name={friend.name} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{friend.name}{friend.isMe ? ' (você)' : ''}</p><p className="truncate text-xs text-muted">{friend.pixKey ? `Pix: ${friend.pixKey}` : 'Chave Pix não informada'}</p></div><div className="text-right"><p className="text-xs text-muted">Em aberto</p><b className="text-sm">{currency.format(splits.filter((split) => split.friendId === friend.id && !split.isPaid).reduce((sum, split) => sum + split.amountOwed, 0))}</b></div>{!friend.isMe && <div className="flex gap-1"><IconButton label={`Convidar ${friend.name}`} onClick={() => { void inviteFriend(friend.id) }}><Share2 size={15} /></IconButton><IconButton label={`Editar ${friend.name}`} onClick={() => { openModal('friend'); setEditingFriendId(friend.id) }}><Pencil size={15} /></IconButton><IconButton label={`Excluir ${friend.name}`} onClick={() => { if (window.confirm(`Excluir ${friend.name}?`)) runAction(() => useAppStore.getState().deleteFriend(friend.id), 'Amigo excluído.') }}><Trash2 size={15} /></IconButton></div>}</div>{!friend.isMe && <div className="ml-12 mt-2"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-500">Dependentes</p><button onClick={() => { openModal('dependent'); setEditingDependent({ friendId: friend.id }) }} className="text-xs font-semibold text-brand">+ Adicionar dependente</button></div>{friend.dependents?.map((dependent) => <div key={dependent.id} className="mt-1 flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5"><span className="min-w-0 flex-1 truncate text-xs">{dependent.name}</span><IconButton label={`Renomear ${dependent.name}`} onClick={() => { openModal('dependent'); setEditingDependent({ friendId: friend.id, dependentId: dependent.id }) }}><Pencil size={13} /></IconButton><IconButton label={`Remover ${dependent.name}`} onClick={() => { if (window.confirm(`Remover ${dependent.name}?`)) runAction(() => useAppStore.getState().deleteDependent(friend.id, dependent.id), 'Dependente removido.') }}><Trash2 size={13} /></IconButton></div>)}</div>}</div>)}</div>}</section>}

          {activePage === 'Cartões' && <section className="space-y-4">{creditCards.length === 0 ? <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card"><EmptyState icon={<CreditCard size={21} />} title="Cadastre seu primeiro cartão" description="Informe os dias de fechamento e vencimento para vincular despesas." /></div> : creditCards.map((card) => { const cardExpenses = expenses.filter((expense) => expense.creditCardId === card.id); return <article key={card.id} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card md:p-6"><div className="flex flex-wrap items-start gap-3"><span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand"><CreditCard size={18} /></span><div className="min-w-0 flex-1"><p className="font-semibold">{card.name}</p><p className="mt-1 text-xs text-muted">Fecha dia {card.closingDay} · vence dia {card.dueDay} · {cardExpenses.length} despesas vinculadas</p></div><IconButton label={`Editar cartão ${card.name}`} onClick={() => { openModal('card'); setEditingCardId(card.id) }}><Pencil size={15} /></IconButton><IconButton label={`Excluir cartão ${card.name}`} onClick={() => { if (window.confirm(`Excluir o cartão ${card.name}?`)) runAction(() => useAppStore.getState().deleteCreditCard(card.id), 'Cartão excluído.') }}><Trash2 size={15} /></IconButton></div>{cardExpenses.length > 0 && <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">{cardExpenses.map((expense) => { const items = installments.filter((item) => item.expenseId === expense.id).sort((a, b) => a.installmentNumber - b.installmentNumber); return <div key={expense.id}><p className="text-sm font-semibold">{expense.title} <span className="font-normal text-muted">· compra {new Date(`${expense.date}T12:00:00`).toLocaleDateString('pt-BR')}</span></p><div className="mt-2 grid gap-2 sm:grid-cols-2">{items.map((item) => { const itemSplits = splits.filter((split) => split.expenseInstallmentId === item.id); const paid = itemSplits.filter((split) => split.isPaid && !friends.find((friend) => friend.id === split.friendId)?.isMe).length; return <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"><span>Parcela {item.installmentNumber}/{expense.installmentsCount} · vence {new Date(`${item.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}</span><span className="text-right"><b>{currency.format(item.amount)}</b><span className="ml-2 text-muted">{paid}/{itemSplits.filter((split) => !friends.find((friend) => friend.id === split.friendId)?.isMe).length} pagos</span></span></div>})}</div></div>})}</div>}</article> })}</section>}

          {activePage === 'Despesas' && <><SharedExpenses /><section className="space-y-4">{expenses.length === 0 ? <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card"><EmptyState icon={<ReceiptText size={21} />} title="Nenhuma despesa local cadastrada" description="As despesas compartilhadas com sua conta aparecem acima. Crie uma despesa para registrar um novo gasto neste navegador." /></div> : expenses.slice().reverse().map((expense) => {
            const expenseInstallments = installments.filter((item) => item.expenseId === expense.id).sort((a, b) => a.installmentNumber - b.installmentNumber)
            const card = creditCards.find((item) => item.id === expense.creditCardId)
            const hasPayments = splits.some((split) => expenseInstallments.some((item) => item.id === split.expenseInstallmentId) && split.isPaid && !friends.find((friend) => friend.id === split.friendId)?.isMe)
            return <article key={expense.id} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card md:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand"><ReceiptText size={19} /></span><div><h2 className="font-semibold">{expense.title}</h2><p className="mt-1 text-xs text-muted">{new Date(`${expense.date}T12:00:00`).toLocaleDateString('pt-BR')} · {card?.name ?? 'Pix'} · {expense.installmentsCount}x</p></div></div><div className="flex items-center gap-2"><b className="mr-1 text-lg">{currency.format(expense.totalAmount)}</b><IconButton label={`Editar ${expense.title}`} disabled={hasPayments} onClick={() => beginExpenseEdit(expense.id)}><Pencil size={15} /></IconButton><IconButton label={`Excluir ${expense.title}`} disabled={hasPayments} onClick={() => { if (window.confirm(`Excluir a despesa ${expense.title} e todas as parcelas ainda não pagas?`)) runAction(() => useAppStore.getState().deleteExpense(expense.id), 'Despesa excluída.') }}><Trash2 size={15} /></IconButton></div></div>{hasPayments && <p className="mt-2 text-xs text-amber-700">Edição e exclusão bloqueadas para preservar pagamentos já registrados.</p>}<div className="mt-4 space-y-3">{expenseInstallments.map((installment) => <div key={installment.id} className="rounded-xl bg-slate-50 px-3 py-2"><div className="flex justify-between text-xs font-semibold"><span>Parcela {installment.installmentNumber}/{expense.installmentsCount}</span><span>{new Date(`${installment.dueDate}T12:00:00`).toLocaleDateString('pt-BR')} · {currency.format(installment.amount)}</span></div><div className="mt-1 divide-y divide-white">{splits.filter((split) => split.expenseInstallmentId === installment.id).map((split) => { const friend = friends.find((item) => item.id === split.friendId); const dependent = friend?.dependents?.find((item) => item.id === split.dependentId); return <div key={split.id} className="flex items-center gap-3 py-2"><Avatar value={friend?.avatar ?? '🙂'} name={friend?.name ?? 'Amigo removido'} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{dependent ? `${dependent.name} · ${friend?.name}` : friend?.name ?? 'Amigo removido'}</p><p className="text-xs text-muted">{friend?.isMe ? 'Sua parte' : split.isPaid ? `Pago${split.paidAt ? ` em ${new Date(split.paidAt).toLocaleDateString('pt-BR')}` : ''}` : 'Pendente'}</p></div><b className="mr-2 text-sm">{currency.format(split.amountOwed)}</b>{split.isPaid ? <span className="inline-flex items-center gap-1 rounded-lg bg-brand-soft px-2.5 py-2 text-xs font-semibold text-brand-dark"><Check size={14} /> Pago</span> : <button onClick={() => markAsPaid(split.id)} className="rounded-lg border border-brand/20 px-2.5 py-2 text-xs font-semibold text-brand hover:bg-brand-soft">Marcar como pago</button>}</div>})}</div></div>)}</div></article>
          })}</section></>}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-slate-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur lg:hidden" aria-label="Navegação inferior"><Navigation activePage={activePage} onChange={setActivePage} expenseCount={expenses.length} mobile /></nav>
      {modal && <ModalFrame title={modal === 'friend' ? editingFriendId ? 'Editar amigo' : 'Novo amigo' : modal === 'card' ? editingCardId ? 'Editar cartão' : 'Novo cartão' : modal === 'dependent' ? editingDependent?.dependentId ? 'Editar dependente' : 'Novo dependente' : editingExpenseId ? 'Editar despesa' : 'Nova despesa'} onClose={() => setModal(null)}>
        {modal === 'friend' && <FriendForm initial={friends.find((friend) => friend.id === editingFriendId)} onCancel={() => setModal(null)} onSave={(data) => runAction(() => { if (editingFriendId) useAppStore.getState().updateFriend(editingFriendId, data); else useAppStore.getState().addFriend(data) }, editingFriendId ? 'Amigo atualizado.' : 'Amigo cadastrado.')} />}
        {modal === 'card' && <CardForm initial={creditCards.find((card) => card.id === editingCardId)} lockDates={Boolean(editingCardId && expenses.some((expense) => expense.creditCardId === editingCardId))} onCancel={() => setModal(null)} onSave={(data) => runAction(() => { if (editingCardId) useAppStore.getState().updateCreditCard(editingCardId, data); else useAppStore.getState().addCreditCard(data) }, editingCardId ? 'Cartão atualizado.' : 'Cartão cadastrado.')} />}
        {modal === 'dependent' && editingDependent && <DependentForm initial={friends.find((friend) => friend.id === editingDependent.friendId)?.dependents?.find((dependent) => dependent.id === editingDependent.dependentId)} onCancel={() => setModal(null)} onSave={(name) => runAction(() => { if (editingDependent.dependentId) useAppStore.getState().updateDependent(editingDependent.friendId, editingDependent.dependentId, name); else useAppStore.getState().addDependent(editingDependent.friendId, name) }, editingDependent.dependentId ? 'Dependente atualizado.' : 'Dependente cadastrado.')} />}
        {modal === 'expense' && <ExpenseForm key={editingExpenseId ?? 'new-expense'} friends={friends} cards={creditCards} initialData={editingExpenseId ? getExpenseEditorData(editingExpenseId) : undefined} onCancel={() => setModal(null)} onSave={(data) => runAction(() => { if (editingExpenseId) useAppStore.getState().updateExpense(editingExpenseId, data); else useAppStore.getState().addExpense(data) }, editingExpenseId ? 'Despesa atualizada.' : 'Despesa cadastrada e parcelas salvas.')} />}
      </ModalFrame>}
    </div>
  )
}

function Navigation({ activePage, onChange, expenseCount, mobile = false }: { activePage: Page; onChange: (page: Page) => void; expenseCount: number; mobile?: boolean }) {
  return <div className={mobile ? 'grid grid-cols-4 w-full' : 'space-y-1'}>{navigation.map(({ label, icon: Icon }) => <button key={label} onClick={() => onChange(label)} className={mobile ? `flex flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] font-medium ${activePage === label ? 'text-brand' : 'text-slate-400'}` : `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition ${activePage === label ? 'bg-brand-soft text-brand-dark' : 'text-slate-500 hover:bg-slate-50 hover:text-ink'}`}><Icon size={mobile ? 19 : 17} strokeWidth={1.8} />{label}{!mobile && label === 'Despesas' && expenseCount > 0 && <span className="ml-auto text-xs text-slate-400">{expenseCount}</span>}</button>)}</div>
}

function IconButton({ label, onClick, children, disabled = false }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return <button type="button" aria-label={label} title={disabled ? `${label} indisponível após registrar pagamentos` : label} disabled={disabled} onClick={onClick} className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35">{children}</button>
}

function SummaryCard({ dark = false, label, value, icon, foot }: { dark?: boolean; label: string; value: string; icon: ReactNode; foot: string }) {
  return <article className={dark ? 'rounded-2xl bg-brand p-5 text-white shadow-card md:p-6' : 'rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card md:p-6'}><div className="flex items-center justify-between"><p className={dark ? 'text-sm text-white/75' : 'text-sm text-muted'}>{label}</p><span className={dark ? 'grid size-9 place-items-center rounded-xl bg-white/15' : 'grid size-9 place-items-center rounded-xl bg-brand-soft text-brand'}>{icon}</span></div><p className="mt-5 text-[28px] font-bold tracking-tight">{value}</p><div className={dark ? 'mt-4 flex items-center gap-1.5 text-xs text-white/75' : 'mt-4 text-xs text-muted'}>{dark && <ArrowUpRight size={14} />}{foot}</div></article>
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) { return <div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs text-muted">{subtitle}</p></div> }
function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) { return <div className="flex min-h-[218px] flex-col items-center justify-center px-5 text-center"><span className="mb-3 grid size-11 place-items-center rounded-2xl bg-[#f3f6f4] text-slate-400">{icon}</span><p className="text-sm font-semibold">{title}</p><p className="mt-1 max-w-[270px] text-xs leading-relaxed text-muted">{description}</p></div> }
function Avatar({ value, name }: { value: string; name: string }) { return <span aria-label={name} className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[#edf2ee] text-lg">{value.startsWith('http') ? <img className="size-full object-cover" src={value} alt="" /> : value || name.slice(0, 1).toUpperCase()}</span> }
function ExpenseRow({ expenseId, title, amount, date }: { expenseId: string; title: string; amount: number; date: string }) { return <div data-expense-id={expenseId} className="flex items-center justify-between py-3"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-brand"><ReceiptText size={17} /></span><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted">{new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR')}</p></div></div><b className="text-sm">{currency.format(amount)}</b></div> }

function ModalFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement
    dialogRef.current?.querySelector<HTMLElement>('input:not([type="hidden"]), select, button, [tabindex="0"]')?.focus()
    return () => { if (previousFocus instanceof HTMLElement) previousFocus.focus() }
  }, [])
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  return <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} onKeyDown={handleKeyDown} className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl outline-none sm:max-w-lg sm:rounded-3xl sm:p-6"><div className="mb-5 flex items-center justify-between"><h2 id="modal-title" className="text-lg font-bold">{title}</h2><button aria-label="Fechar" onClick={onClose} className="grid size-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><X size={19} /></button></div>{children}</section></div>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600">{label}</span>{children}</label> }
const inputClass = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/10'
function FormActions({ onCancel, saveLabel = 'Salvar', disabled = false }: { onCancel: () => void; saveLabel?: string; disabled?: boolean }) { return <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onCancel} className="h-10 rounded-xl px-4 text-sm font-medium text-slate-500 hover:bg-slate-100">Cancelar</button><button type="submit" disabled={disabled} className="h-10 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-45">{saveLabel}</button></div> }

function FriendForm({ initial, onSave, onCancel }: { initial?: Friend; onSave: (data: { name: string; avatar: string; pixKey?: string; dependents?: Dependent[] }) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? ''); const [avatar, setAvatar] = useState(initial?.avatar ?? '🙂'); const [pixKey, setPixKey] = useState(initial?.pixKey ?? ''); const [dependentNames, setDependentNames] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); onSave({ name: name.trim(), avatar: avatar.trim() || '🙂', ...(pixKey.trim() ? { pixKey: pixKey.trim() } : {}), ...(!initial ? { dependents: dependentNames.split(',').map((item) => item.trim()).filter(Boolean).map((dependentName) => ({ id: crypto.randomUUID(), name: dependentName })) } : {}) }) }
  return <form onSubmit={submit} className="space-y-4"><Field label="Nome"><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="Ex.: João Souza" /></Field><Field label="Avatar (emoji ou URL de imagem)"><input value={avatar} onChange={(event) => setAvatar(event.target.value)} className={inputClass} placeholder="🙂" /></Field><Field label="Chave Pix (opcional)"><input value={pixKey} onChange={(event) => setPixKey(event.target.value)} className={inputClass} placeholder="CPF, e-mail, telefone ou chave aleatória" /></Field>{!initial && <><Field label="Dependentes (opcional)"><input value={dependentNames} onChange={(event) => setDependentNames(event.target.value)} className={inputClass} placeholder="Ana, Pedro" /></Field><p className="-mt-2 text-[11px] text-muted">Separe os nomes por vírgula. Os valores deles serão cobrados deste responsável.</p></>}<FormActions onCancel={onCancel} saveLabel={initial ? 'Salvar alterações' : 'Cadastrar amigo'} /></form>
}

function CardForm({ initial, lockDates, onSave, onCancel }: { initial?: CreditCardModel; lockDates: boolean; onSave: (data: { name: string; closingDay: number; dueDay: number }) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? ''); const [closingDay, setClosingDay] = useState(initial ? String(initial.closingDay) : ''); const [dueDay, setDueDay] = useState(initial ? String(initial.dueDay) : '')
  const submit = (event: FormEvent) => { event.preventDefault(); onSave({ name: name.trim(), closingDay: Number(closingDay), dueDay: Number(dueDay) }) }
  return <form onSubmit={submit} className="space-y-4"><Field label="Nome do cartão"><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="Ex.: Nubank" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Dia de fechamento"><input type="number" min="1" max="31" required disabled={lockDates} value={closingDay} onChange={(event) => setClosingDay(event.target.value)} className={inputClass} placeholder="10" /></Field><Field label="Dia de vencimento"><input type="number" min="1" max="31" required disabled={lockDates} value={dueDay} onChange={(event) => setDueDay(event.target.value)} className={inputClass} placeholder="17" /></Field></div>{lockDates && <p className="text-xs text-amber-700">As datas ficam bloqueadas enquanto despesas estiverem vinculadas a este cartão.</p>}<FormActions onCancel={onCancel} saveLabel={initial ? 'Salvar alterações' : 'Cadastrar cartão'} /></form>
}

function DependentForm({ initial, onSave, onCancel }: { initial?: Dependent; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  return <form onSubmit={(event) => { event.preventDefault(); onSave(name.trim()) }} className="space-y-4"><Field label="Nome do dependente"><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="Ex.: Ana" /></Field><p className="text-xs text-muted">As partes deste dependente ficam vinculadas ao responsável pagador.</p><FormActions onCancel={onCancel} saveLabel={initial ? 'Salvar alterações' : 'Adicionar dependente'} /></form>
}
