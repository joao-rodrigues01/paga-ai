import { useState, type FormEvent } from 'react'
import { getAuthRedirectUrl, getSupabaseClient } from '../lib/supabase'

type RequestStatus = 'idle' | 'sending' | 'sent' | 'error'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<RequestStatus>('idle')
  const [message, setMessage] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedEmail = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setStatus('error')
      setMessage('Informe um endereço de e-mail válido.')
      return
    }

    setStatus('sending')
    setMessage('')
    try {
      const { error } = await getSupabaseClient().auth.signInWithOtp({
        email: normalizedEmail,
        options: { emailRedirectTo: getAuthRedirectUrl() },
      })
      if (error) throw error
      setStatus('sent')
      setMessage('Se o endereço puder receber acesso, enviaremos um link mágico. Confira sua caixa de entrada.')
    } catch (error) {
      setStatus('error')
      const errorMessage = error instanceof Error ? error.message : ''
      setMessage(/email rate limit exceeded/i.test(errorMessage)
        ? 'O limite de envio de e-mails do Supabase foi atingido. Aguarde a renovação do limite ou configure um SMTP próprio no Supabase.'
        : errorMessage || 'Não foi possível enviar o link. Tente novamente.')
    }
  }

  return <form onSubmit={submit} className="w-full max-w-sm space-y-4" noValidate>
    <div>
      <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-slate-700">E-mail</label>
      <input
        id="login-email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(event) => { setEmail(event.target.value); if (status !== 'idle') { setStatus('idle'); setMessage('') } }}
        aria-invalid={status === 'error'}
        aria-describedby={message ? 'login-message' : undefined}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
        placeholder="voce@exemplo.com"
      />
    </div>
    <button type="submit" disabled={status === 'sending'} className="h-11 w-full rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-wait disabled:opacity-60">
      {status === 'sending' ? 'Enviando link…' : 'Entrar por link mágico'}
    </button>
    <p id="login-message" role={status === 'error' ? 'alert' : 'status'} aria-live="polite" className={`min-h-5 text-sm ${status === 'error' ? 'text-rose-700' : 'text-slate-600'}`}>
      {message}
    </p>
  </form>
}
