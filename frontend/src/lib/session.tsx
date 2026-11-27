
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, refreshSession, storeAccess } from './api'
import type { AuthResult, User } from './types'

type Session = {
  user: User | null; loading: boolean; accept: (result: AuthResult) => void;
  update: (user: User) => void; logout: () => Promise<void>
}
const Context = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const cache = useQueryClient()
  const clear = useCallback(() => { storeAccess(null); setUser(null); cache.clear() }, [cache])

  useEffect(() => {
    let active = true
    refreshSession().then(result => { if (active) setUser(result?.user ?? null) })
      .catch(() => undefined).finally(() => { if (active) setLoading(false) })
    window.addEventListener('documind:expired', clear)
    return () => { active = false; window.removeEventListener('documind:expired', clear) }
  }, [clear])

  function accept(result: AuthResult) {
    cache.clear()
    storeAccess(result.access_token)
    setUser(result.user)
  }
  async function logout() {
    const request = () => api('/auth/logout', { method: 'POST' })
    if (navigator.locks) await navigator.locks.request('documind-refresh', request)
    else await request()
    clear()
  }

  return <Context.Provider value={{ user, loading, accept, update: setUser, logout }}>{children}</Context.Provider>
}

export function useSession() {
  const value = useContext(Context)
  if (!value) throw new Error('SessionProvider is required')
  return value
}
