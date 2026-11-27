
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ChevronRight, FileChartColumn, FolderOpen, GitCompareArrows, HardDrive, LayoutGrid, LogOut, Menu,
  MessageSquareText, Settings, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router'
import { api } from '../lib/api'
import { errorMessage, formatBytes } from '../lib/format'
import { useSession } from '../lib/session'
import type { Summary } from '../lib/types'
import { Brand, Button, Modal, Skeleton, ThemeToggle, Tip, useUI } from './ui'

const nav = [
  { path: '/app', title: 'Обзор', icon: LayoutGrid },
  { path: '/app/documents', title: 'Документы', icon: FolderOpen },
  { path: '/app/chat', title: 'AI-чат', icon: MessageSquareText },
  { path: '/app/analysis', title: 'Анализ', icon: Sparkles },
  { path: '/app/compare', title: 'Сравнение', icon: GitCompareArrows },
  { path: '/app/reports', title: 'Отчёты', icon: FileChartColumn },
  { path: '/app/settings', title: 'Настройки', icon: Settings },
]

export function useSummary() {
  return useQuery({ queryKey: ['summary'], queryFn: () => api<Summary>('/dashboard/summary'), refetchInterval: 15000 })
}

function Navigation({ onChoose }: { onChoose?: () => void }) {
  return <nav className="workspace-nav" aria-label="Рабочее пространство">{nav.map(({ path, title, icon: Icon }, index) =>
    <NavLink key={path} to={path} end={index === 0} onClick={onChoose} className={index === 6 ? 'nav-settings' : undefined}>
      <Icon size={17} /><span>{title}</span>
    </NavLink>)}</nav>
}

export default function Workspace() {
  const { user, loading, logout } = useSession()
  const { notify } = useUI()
  const { pathname } = useLocation()
  const [menu, setMenu] = useState(false)
  const summary = useQuery({ queryKey: ['summary'], queryFn: () => api<Summary>('/dashboard/summary'),
    enabled: Boolean(user), refetchInterval: 15000 })
  if (loading) return <div className="startup"><Brand /><Skeleton count={2} /></div>
  if (!user) return <Navigate to="/login" replace />
  const active = [...nav].reverse().find(item => pathname.startsWith(item.path))
  const glyph = user.name.trim().charAt(0).toUpperCase()
  const ai = summary.data?.ai
  const storage = summary.data?.storage
  const capacity = summary.data?.limits.max_storage_mb
  const signOut = () => logout().catch(error => notify(errorMessage(error), true))
  return <div className="workspace">
    <aside className="workspace-side">
      <div className="workspace-brand"><Brand route="/app" /></div>
      <span className="workspace-nav-label">Рабочее пространство</span>
      <Navigation />
      <div className="sidebar-bottom">
        {storage !== undefined && capacity !== undefined && <Link className="sidebar-quota" to="/app/documents">
          <div><HardDrive size={16} /><strong>Хранилище</strong></div>
          <progress aria-label="Заполненность хранилища" value={storage} max={capacity * 1024 ** 2} />
          <small>{formatBytes(storage)} из {capacity} МБ</small>
        </Link>}
        <a className="sidebar-docs" href="/api/v1/docs"><BookOpen size={16} /> Документация API</a>
        <div className="sidebar-user"><Link className="user-info" to="/app/settings"><span className="avatar">{glyph}</span>
          <span><b>{user.name}</b><small>{user.read_only ? 'Демо-аккаунт' : user.email}</small></span></Link>
          <Tip text="Выйти"><Button variant="ghost" size="icon" onClick={signOut} aria-label="Выйти"><LogOut size={17} /></Button></Tip>
        </div>
      </div>
    </aside>
    <div className="workspace-main">
      <header className="workspace-header">
        <Button className="mobile-menu" variant="ghost" size="icon" onClick={() => setMenu(true)} aria-label="Меню"><Menu size={21} /></Button>
        <div className="breadcrumbs"><Link to="/app">Пространство</Link><ChevronRight size={13} /><span>{active?.title}</span></div>
        <div className="workspace-header-actions"><span className="ai-indicator" data-active={Boolean(ai?.available)}>
          <i />{ai?.available ? (ai.provider === 'mock' ? 'Тестовый AI' : 'AI доступен') : 'AI недоступен'}</span>
          <ThemeToggle /><Link className="avatar header-avatar" to="/app/settings" aria-label="Настройки профиля">{glyph}</Link></div>
      </header>
      {user.read_only && <div className="demo-banner">Демонстрационный режим · только чтение</div>}
      <main className="workspace-content"><Outlet /></main>
    </div>
    <Modal title="Навигация" description="Разделы рабочего пространства" open={menu} onOpenChange={setMenu}>
      <Navigation onChoose={() => setMenu(false)} />
      <div className="modal-actions"><Button onClick={signOut}><LogOut size={16} /> Выйти</Button></div>
    </Modal>
  </div>
}
