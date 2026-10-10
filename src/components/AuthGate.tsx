import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import App from '../App'
import { LoginForm } from './LoginForm'
import { getSupabaseClient } from '../lib/supabase'

type AuthState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; user: User | null }

export function AuthGate() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    let client
    try {
      client = getSupabaseClient()
    } catch (error) {
      setAuth({ status: 'error', message: error instanceof Error ? error.message : 'Configuração Supabase ausente.' })
      return
    }

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (active) setAuth({ status: 'ready', user: session?.user ?? null })
    })
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setAuth({ status: 'error', message: error.message })
      else setAuth({ status: 'ready', user: data.session?.user ?? null })
    }).catch((error: unknown) => {
      if (active) setAuth({ status: 'error', message: error instanceof Error ? error.message : 'Não foi possível verificar sua sessão.' })
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    try {
      const { error } = await getSupabaseClient().auth.signOut()
      if (error) setAuth({ status: 'error', message: error.message })
    } catch (error) {
      setAuth({ status: 'error', message: error instanceof Error ? error.message : 'Não foi possível sair da conta.' })
    }
  }

  if (auth.status === 'loading') return <CenteredMessage>Verificando sua sessão…</CenteredMessage>
  if (auth.status === 'error') return <CenteredMessage>
    <h1 className="text-xl font-semibold text-slate-900">Não foi possível conectar</h1>
    <p role="alert" className="mt-2 text-sm text-rose-700">{auth.message}</p>
    <p className="mt-3 text-sm text-slate-600">Confira o <code>.env.local</code>, aplique <code>supabase/schema.sql</code> no Supabase e reinicie o servidor Vite.</p>
  </CenteredMessage>
  if (!auth.user) return <main className="grid min-h-screen place-items-center bg-[#f6f8f6] px-5 py-10">
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-card sm:p-9">
      <div className="mb-7"><p className="text-2xl font-bold tracking-tight text-brand">PagaAí <span aria-hidden="true">💸</span></p><h1 className="mt-5 text-xl font-semibold text-slate-900">Entre na sua conta</h1><p className="mt-1 text-sm text-slate-500">Enviaremos um link seguro para seu e-mail.</p></div>
      <LoginForm />
    </section>
  </main>

  return <>
    <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-6">
      <span>Login ativo · seus dados ainda ficam somente neste navegador e não foram sincronizados.</span>
      <button type="button" onClick={() => void signOut()} className="font-semibold underline underline-offset-2">Sair</button>
    </div>
    <App />
  </>
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-screen place-items-center bg-[#f6f8f6] px-5"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-card">{children}</section></main>
}
