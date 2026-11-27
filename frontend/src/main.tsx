
import '@fontsource-variable/inter'
import '@fontsource/pt-serif/cyrillic-400-italic.css'
import '@fontsource/pt-serif/cyrillic-700.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes } from 'react-router'
import { Button, Empty, Skeleton, UIProvider } from './components/ui'
import Workspace from './components/Workspace'
import { ApiError } from './lib/api'
import { SessionProvider } from './lib/session'
import Auth from './pages/Auth'
import Landing from './pages/Landing'
import './styles.css'
import './workspace.css'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Library = lazy(() => import('./pages/Library'))
const Document = lazy(() => import('./pages/Document'))
const Chat = lazy(() => import('./pages/Chat'))
const Analysis = lazy(() => import('./pages/Workbench').then(module => ({ default: module.AnalysisPage })))
const Compare = lazy(() => import('./pages/Workbench').then(module => ({ default: module.ComparePage })))
const Reports = lazy(() => import('./pages/Workbench').then(module => ({ default: module.ReportsPage })))
const Settings = lazy(() => import('./pages/Settings'))

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 2000, retry: (count, error) =>
    count < 1 && (!(error instanceof ApiError) || error.status >= 500) } },
})

createRoot(document.getElementById('root')!).render(<StrictMode>
  <QueryClientProvider client={queryClient}><SessionProvider><UIProvider><BrowserRouter>
    <Suspense fallback={<div className="startup"><Skeleton count={3} /></div>}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Auth key="login" register={false} />} />
        <Route path="/register" element={<Auth key="register" register />} />
        <Route path="/app" element={<Workspace />}>
          <Route index element={<Dashboard />} />
          <Route path="documents" element={<Library />} />
          <Route path="documents/:id" element={<Document />} />
          <Route path="chat/:id?" element={<Chat />} />
          <Route path="analysis/:id?" element={<Analysis />} />
          <Route path="compare/:id?" element={<Compare />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<main className="startup"><Empty title="Страница не найдена" body="Проверьте адрес страницы."
          action={<Button asChild><Link to="/">На главную</Link></Button>} /></main>} />
      </Routes>
    </Suspense>
  </BrowserRouter></UIProvider></SessionProvider></QueryClientProvider>
</StrictMode>)
