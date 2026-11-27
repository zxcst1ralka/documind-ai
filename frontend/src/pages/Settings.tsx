
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LockKeyhole, LogOut, Monitor, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Button, ErrorNotice, Skeleton, Spinner, ThemeToggle, useUI } from '../components/ui'
import { useSummary } from '../components/Workspace'
import { api, json } from '../lib/api'
import { errorMessage, formatDate } from '../lib/format'
import { useSession } from '../lib/session'
import type { AuthResult, User } from '../lib/types'

type Session = { id: string; created_at: string; expires_at: string; current: boolean }

export default function SettingsPage() {
  const { user, accept, update, logout } = useSession()
  const { theme, notify } = useUI()
  const [name, setName] = useState(user?.name ?? '')
  const [old, setOld] = useState('')
  const [next, setNext] = useState('')
  const cache = useQueryClient()
  const summary = useSummary()
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<Session[]>('/auth/sessions') })
  const profile = useMutation({ mutationFn: () => api<User>('/auth/me', json('PATCH', { name })),
    onSuccess: result => { update(result); notify('Профиль обновлён') } })
  const password = useMutation({ mutationFn: () => api<AuthResult>('/auth/password', json('POST', { current_password: old, new_password: next })),
    onSuccess: result => { accept(result); setOld(''); setNext(''); notify('Пароль изменён. Остальные сессии отозваны.') } })
  const revoke = useMutation({ mutationFn: (id: string) => api('/auth/sessions/' + id, { method: 'DELETE' }),
    onSuccess: () => { notify('Сессия завершена'); void cache.invalidateQueries({ queryKey: ['sessions'] }) },
    onError: error => notify(error.message, true) })

  return <div className="screen">
    <div className="page-heading"><div><h1>Настройки</h1><p>Профиль, безопасность и тема интерфейса.</p></div>
      <Button onClick={() => logout().catch(error => notify(errorMessage(error), true))}><LogOut size={16} /> Выйти</Button></div>
    <div className="settings-grid">
      <section className="panel"><div className="panel-heading"><h2><UserRound size={18} /> Личный профиль</h2></div>
        <form className="panel-form form" onSubmit={e => { e.preventDefault(); profile.mutate() }}>
          <label>Email<input value={user?.email ?? ''} readOnly /></label>
          <label>Имя<input value={name} onChange={e => setName(e.target.value)} maxLength={100} readOnly={user?.read_only} required /></label>
          {profile.error && <ErrorNotice message={profile.error.message} />}
          {!user?.read_only && <Button disabled={profile.isPending || !name.trim() || name.trim() === user?.name} variant="primary">Сохранить профиль</Button>}
        </form></section>
      {!user?.read_only && <section className="panel"><div className="panel-heading"><h2><LockKeyhole size={18} /> Смена пароля</h2></div>
        <form className="panel-form form" onSubmit={e => { e.preventDefault(); password.mutate() }}>
          <label>Текущий пароль<input value={old} onChange={e => setOld(e.target.value)} type="password" required autoComplete="current-password" maxLength={128} /></label>
          <label>Новый пароль<input value={next} onChange={e => setNext(e.target.value)} type="password" required minLength={12} maxLength={128}
            autoComplete="new-password" placeholder="Минимум 12 символов" /></label>
          {password.error && <ErrorNotice message={password.error.message} />}
          <Button disabled={password.isPending || !old || next.length < 12} variant="primary">{password.isPending && <Spinner />} Обновить пароль</Button>
        </form></section>}
      <section className="panel"><div className="panel-heading"><h2><Monitor size={18} /> Интерфейс и AI</h2></div>
        <div className="panel-form form">
          <div className="settings-row"><div><strong>Тема интерфейса</strong><p>{theme === 'dark' ? 'Тёмная' : 'Светлая'}</p></div><ThemeToggle /></div>
          <div className="settings-row"><div><strong>AI-провайдер</strong><p>{summary.data?.ai.model || 'Модель не настроена'}</p></div>
            <span className="ai-indicator" data-active={Boolean(summary.data?.ai.available)}><i />{summary.data?.ai.available ? 'Доступен' : 'Недоступен'}</span></div>
        </div></section>
      <section className="panel"><div className="panel-heading"><h2><LockKeyhole size={18} /> Активные сессии</h2></div>
        <div className="panel-form form">{sessions.isLoading && <Skeleton />}
          {sessions.error && <ErrorNotice message={sessions.error.message} />}
          {sessions.data?.map(item => <div key={item.id} className="settings-row">
            <div><strong>{item.current ? 'Текущая сессия' : 'Другая сессия'}</strong><p>{formatDate(item.created_at)}</p></div>
            {!item.current && !user?.read_only && <Button size="sm" onClick={() => revoke.mutate(item.id)} disabled={revoke.isPending}>Завершить</Button>}
          </div>)}</div>
      </section>
    </div>
  </div>
}
