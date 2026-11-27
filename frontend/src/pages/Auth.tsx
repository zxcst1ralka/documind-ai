
import { zodResolver } from '@hookform/resolvers/zod'
import { Fingerprint, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router'
import { z } from 'zod'
import { Brand, Button, ErrorNotice, Spinner, ThemeToggle } from '../components/ui'
import { api, json } from '../lib/api'
import { errorMessage } from '../lib/format'
import { useSession } from '../lib/session'
import type { AuthResult } from '../lib/types'

export function authSchema(register: boolean) {
  return z.object({
    name: register ? z.string().trim().min(1, 'Введите ваше имя').max(100) : z.string().optional(),
    email: z.email('Введите корректный email'),
    password: z.string().min(register ? 12 : 1, register ? 'Минимум 12 символов' : 'Введите пароль').max(128),
  })
}

export default function Auth({ register }: { register: boolean }) {
  const { user, accept } = useSession()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const form = useForm<z.infer<ReturnType<typeof authSchema>>>({ resolver: zodResolver(authSchema(register)) })
  if (user) return <Navigate to="/app" replace />
  const submit = form.handleSubmit(async fields => {
    setError('')
    try {
      const result = await api<AuthResult>(register ? '/auth/register' : '/auth/login', json('POST', fields))
      accept(result)
      navigate('/app', { replace: true })
    } catch (error) { setError(errorMessage(error)) }
  })
  return <main className="auth-page">
    <header><Brand /><ThemeToggle /></header>
    <div className="auth-card"><div className="feature-icon"><Fingerprint size={22} /></div>
      <h1>{register ? 'Создайте аккаунт' : 'Вход в DocuMind AI'}</h1>
      <p>{register ? 'Откройте личную библиотеку и начните работу с документами.' : 'Продолжите работу в своём пространстве.'}</p>
      <form className="form" onSubmit={submit} noValidate>
        {register && <label>Имя<input {...form.register('name')} autoComplete="name" placeholder="Ваше имя" />
          {form.formState.errors.name && <span className="field-error">{form.formState.errors.name.message}</span>}</label>}
        <label>Email<input {...form.register('email')} autoComplete="email" type="email" placeholder="name@example.com" />
          {form.formState.errors.email && <span className="field-error">{form.formState.errors.email.message}</span>}</label>
        <label>Пароль<input {...form.register('password')} type="password"
          autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? 'Минимум 12 символов' : 'Введите пароль'} />
          {form.formState.errors.password && <span className="field-error">{form.formState.errors.password.message}</span>}</label>
        {error && <ErrorNotice message={error} />}
        <Button variant="primary" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting && <Spinner />}
          {register ? 'Создать аккаунт' : 'Войти'}</Button>
      </form>
      <div className="auth-alternate">{register ? 'Уже есть аккаунт?' : 'Впервые здесь?'}{' '}
        <Link to={register ? '/login' : '/register'}>{register ? 'Войти' : 'Зарегистрироваться'}</Link></div>
      <div className="auth-note"><LockKeyhole size={14} /> Документы доступны в вашей личной библиотеке</div>
    </div>
  </main>
}
