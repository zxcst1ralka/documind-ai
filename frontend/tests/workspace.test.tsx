
import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { Brand, ErrorNotice, Skeleton } from '../src/components/ui'
import { authSchema } from '../src/pages/Auth'
import { CitationList } from '../src/pages/Chat'

describe('Авторизация', () => {
  it('проверяет email и длину пароля регистрации', () => {
    const form = authSchema(true)
    expect(form.safeParse({ name: 'Анна', email: 'anna@example.com', password: '123' }).success).toBe(false)
    expect(form.safeParse({ name: 'Анна', email: 'anna@example.com', password: 'password-example' }).success).toBe(true)
    expect(form.safeParse({ name: '', email: 'invalid', password: 'password-example' }).success).toBe(false)
  })
})

describe('Общие компоненты', () => {
  it('отображает загрузку, ошибку и повтор запроса', () => {
    const onRetry = vi.fn()
    render(<><Skeleton /><ErrorNotice message="Запрос не выполнен" retry={onRetry} /></>)
    expect(screen.getByRole('status', { name: 'Загрузка' })).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Запрос не выполнен')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
  it('показывает проверяемый источник и передаёт серверный идентификатор', () => {
    const source = { id: 'chunk', document_id: 'doc', name: 'Договор.pdf', location: 'Страница 2', page: 2, number: 3 }
    const select = vi.fn()
    render(<CitationList sources={[source]} onSelect={select} />)
    fireEvent.click(screen.getByRole('button', { name: /Договор.pdf · Страница 2/ }))
    expect(select).toHaveBeenCalledWith(source)
  })
  it('сохраняет ссылку бренда на кабинет', () => {
    render(<BrowserRouter><Brand route="/app" /></BrowserRouter>)
    expect(screen.getByRole('link', { name: 'DocuMind AI' })).toHaveAttribute('href', '/app')
  })
})
