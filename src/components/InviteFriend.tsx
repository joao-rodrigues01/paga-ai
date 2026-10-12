import { useState } from 'react'
import { acceptFriendInvite } from '../lib/friendships'

export function InviteFriend({ token }: { token: string }) {
  const [message, setMessage] = useState('Este convite associa sua conta às despesas compartilhadas com você.')
  const [error, setError] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)

  const accept = async () => {
    setBusy(true)
    setError(false)
    try {
      await acceptFriendInvite(token)
      const url = new URL(window.location.href)
      url.searchParams.delete('invite')
      window.history.replaceState({}, '', url)
      setAccepted(true)
      setMessage('Amizade aceita. Abra o Dashboard para consultar as despesas e parcelas compartilhadas com você.')
    } catch (reason) {
      setError(true)
      setMessage(reason instanceof Error ? reason.message : 'Não foi possível aceitar o convite.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="grid min-h-screen place-items-center bg-[#f6f8f6] px-5 py-10">
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-card sm:p-9">
      <p className="text-2xl font-bold tracking-tight text-brand">PagaAí <span aria-hidden="true">💸</span></p>
      <h1 className="mt-5 text-xl font-semibold text-slate-900">Convite de amizade</h1>
      <p role={error ? 'alert' : 'status'} aria-live="polite" className={`mt-2 text-sm ${error ? 'text-rose-700' : 'text-slate-600'}`}>{message}</p>
      {!accepted && <button type="button" onClick={() => void accept()} disabled={busy} className="mt-5 inline-flex h-10 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Aceitando…' : 'Aceitar convite'}</button>}
      {accepted && <a href={import.meta.env.BASE_URL} className="mt-5 inline-flex h-10 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white">Abrir PagaAí</a>}
    </section>
  </main>
}
