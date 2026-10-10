import { useState, type FormEvent, type ReactNode } from 'react'
import type { CreditCard, Friend } from '../types'
import type { ExpenseParticipantInput, NewExpenseInput } from '../store/useAppStore'
import { allocateInstallmentShares } from '../domain/expense'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const inputClass = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/10'
const participantKey = (friendId: string, dependentId?: string) => `${friendId}:${dependentId ?? ''}`
const parseAmount = (value: string) => {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}
const localToday = () => {
  const date = new Date()
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

interface Participant {
  friendId: string
  dependentId?: string
}

export function ExpenseForm({ friends, cards, onSave, onCancel, initialData }: {
  friends: Friend[]
  cards: CreditCard[]
  onSave: (data: NewExpenseInput) => void
  onCancel: () => void
  initialData?: NewExpenseInput
}) {
  const me = friends.find((friend) => friend.isMe)
  const [title, setTitle] = useState(initialData?.title ?? '')
  const [date, setDate] = useState(initialData?.date ?? localToday())
  const [amount, setAmount] = useState(initialData?.totalAmount.toFixed(2) ?? '')
  const [creditCardId, setCreditCardId] = useState(initialData?.creditCardId ?? '')
  const [installmentsCount, setInstallmentsCount] = useState(String(initialData?.installmentsCount ?? 1))
  const [selected, setSelected] = useState<Participant[]>(() => initialData?.splits.map(({ friendId, dependentId }) => ({ friendId, ...(dependentId ? { dependentId } : {}) })) ?? (me ? [{ friendId: me.id }] : []))
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries((initialData?.splits ?? []).map((split) => [participantKey(split.friendId, split.dependentId), split.amountOwed.toFixed(2)])))

  const totalCents = parseAmount(amount)
  const shareEvenly = (participants: Participant[], cents: number) => Object.fromEntries(
    participants.map((participant, index) => [
      participantKey(participant.friendId, participant.dependentId),
      ((Math.floor(cents / participants.length) + (index < cents % participants.length ? 1 : 0)) / 100).toFixed(2),
    ]),
  )
  const updateParticipants = (participant: Participant) => {
    const key = participantKey(participant.friendId, participant.dependentId)
    const exists = selected.some((item) => participantKey(item.friendId, item.dependentId) === key)
    const next = exists
      ? selected.filter((item) => participantKey(item.friendId, item.dependentId) !== key)
      : [...selected, participant]
    setSelected(next)
    setAmounts((previous) => ({ ...previous, ...shareEvenly(next, totalCents) }))
  }
  const updateTotal = (value: string) => {
    setAmount(value)
    setAmounts((previous) => ({ ...previous, ...shareEvenly(selected, parseAmount(value)) }))
  }
  const totalSplitCents = selected.reduce((sum, participant) => {
    return sum + parseAmount(amounts[participantKey(participant.friendId, participant.dependentId)] ?? '0')
  }, 0)
  const installments = Number(installmentsCount)
  const isBalanced = selected.length > 0 && totalCents > 0 && totalSplitCents === totalCents
  const installmentShareCents = isBalanced && Number.isInteger(installments) && installments >= 1 && installments <= 48
    ? allocateInstallmentShares(totalCents, selected.map((participant) => parseAmount(amounts[participantKey(participant.friendId, participant.dependentId)] ?? '0')), installments)
    : undefined
  const formatInstallments = (values: number[]) => {
    const groups: { cents: number; count: number }[] = []
    values.forEach((cents) => {
      const last = groups[groups.length - 1]
      if (last?.cents === cents) last.count += 1
      else groups.push({ cents, count: 1 })
    })
    return groups.map(({ cents, count }) => `${currency.format(cents / 100)}${count > 1 ? ` × ${count}` : ''}`).join(' · ')
  }
  const toggle = (participant: Participant) => () => updateParticipants(participant)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isBalanced) return
    const splits: ExpenseParticipantInput[] = selected.map((participant) => ({
      ...participant,
      amountOwed: parseAmount(amounts[participantKey(participant.friendId, participant.dependentId)] ?? '0') / 100,
    }))
    onSave({
      title: title.trim(), date, totalAmount: totalCents / 100, installmentsCount: installments,
      ...(creditCardId ? { creditCardId } : {}), splits,
    })
  }

  const otherFriends = friends.filter((friend) => !friend.isMe)
  const renderChoice = (participant: Participant, label: string, avatar: string, nested = false) => {
    const key = participantKey(participant.friendId, participant.dependentId)
    const checked = selected.some((item) => participantKey(item.friendId, item.dependentId) === key)
    return <label key={key} className={`flex cursor-pointer items-center gap-2 rounded-lg py-2 pr-2 text-sm hover:bg-slate-50 ${nested ? 'ml-8 pl-2' : 'px-2'}`}>
      <input type="checkbox" checked={checked} onChange={toggle(participant)} className="size-4 accent-[#177a55]" />
      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-[#edf2ee] text-base">{avatar.startsWith('http') ? <img className="size-full object-cover" src={avatar} alt="" /> : avatar || label.slice(0, 1)}</span>
      <span className="min-w-0 truncate">{label}</span>
      {label === 'Eu' && <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand">Você</span>}
    </label>
  }

  return <form onSubmit={submit} className="space-y-4">
    <Field label="O que foi comprado?"><input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} placeholder="Ex.: Jantar de sexta" /></Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Data da compra"><input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} /></Field>
      <Field label="Valor total da compra (R$)"><input type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => updateTotal(event.target.value)} className={inputClass} placeholder="0,00" /></Field>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Forma de pagamento"><select value={creditCardId} onChange={(event) => setCreditCardId(event.target.value)} className={inputClass}><option value="">Pix</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}</select></Field>
      <Field label="Parcelas"><select value={installmentsCount} onChange={(event) => setInstallmentsCount(event.target.value)} className={inputClass}>{Array.from({ length: 48 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}x {count === 1 ? 'à vista' : ''}</option>)}</select></Field>
    </div>
    {installments > 1 && !creditCardId && <p className="-mt-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">Sem cartão, as parcelas vencem mensalmente a partir da data da compra.</p>}

    <div>
      <p className="mb-1 text-xs font-semibold text-slate-600">Quem participou?</p>
      <p className="mb-2 text-[11px] text-muted">“Eu” vem selecionado. Dependentes são cobrados do responsável.</p>
      <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-xl border border-slate-200 p-2">
        {me && renderChoice({ friendId: me.id }, me.name || 'Eu', me.avatar)}
        {otherFriends.map((friend) => <div key={friend.id}>
          {renderChoice({ friendId: friend.id }, friend.name, friend.avatar)}
          {friend.dependents?.map((dependent) => renderChoice({ friendId: friend.id, dependentId: dependent.id }, dependent.name, '👤', true))}
        </div>)}
      </div>
    </div>

    {selected.length > 0 && <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold text-slate-600">Cotas do total da compra</p><button type="button" onClick={() => setAmounts((old) => ({ ...old, ...shareEvenly(selected, totalCents) }))} className="text-xs font-semibold text-brand">Dividir igualmente</button></div>
      <p className="mb-3 text-[11px] text-muted">Informe quanto cada pessoa deve no total. O valor por parcela aparece abaixo.</p>
      <div className="space-y-2">{selected.map((participant) => {
        const friend = friends.find((item) => item.id === participant.friendId)
        const dependent = friend?.dependents?.find((item) => item.id === participant.dependentId)
        const key = participantKey(participant.friendId, participant.dependentId)
        const label = dependent ? `${dependent.name} · ${friend?.name}` : friend?.name ?? 'Participante'
        const participantIndex = selected.findIndex((item) => participantKey(item.friendId, item.dependentId) === key)
        const monthlyShares = installmentShareCents?.[participantIndex]
        return <div key={key} className="flex items-center gap-2"><div className="min-w-0 flex-1"><span className="block truncate text-sm">{label}</span>{monthlyShares && installments > 1 && <span className="block truncate text-[10px] text-muted">Por parcela: {formatInstallments(monthlyShares)}</span>}</div><div className="relative w-32 shrink-0"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">R$</span><input aria-label={`Valor devido por ${label}`} type="number" min="0" step="0.01" value={amounts[key] ?? ''} onChange={(event) => setAmounts((old) => ({ ...old, [key]: event.target.value }))} className={`${inputClass} pl-8 text-right`} /></div></div>
      })}</div>
      <div className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-xs"><span className="text-muted">Soma das divisões</span><b className={isBalanced ? 'text-brand' : 'text-rose-600'}>{currency.format(totalSplitCents / 100)} / {currency.format(totalCents / 100)}</b></div>
      {!isBalanced && <p className="mt-1 text-right text-[11px] text-rose-600">A soma precisa ser igual ao valor total.</p>}
      {isBalanced && installments > 1 && installmentShareCents && <p className="mt-2 text-[11px] text-muted">Cada parcela da compra: {formatInstallments(Array.from({ length: installments }, (_, index) => installmentShareCents.reduce((sum, shares) => sum + shares[index], 0)))}. Dependentes selecionados contam como cotas próprias; o valor é agrupado com o responsável.</p>}
    </div>}
    <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onCancel} className="h-10 rounded-xl px-4 text-sm font-medium text-slate-500 hover:bg-slate-100">Cancelar</button><button type="submit" disabled={!isBalanced || !title.trim() || !date} className="h-10 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-45">Salvar despesa</button></div>
  </form>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600">{label}</span>{children}</label>
}
