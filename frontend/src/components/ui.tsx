
import * as Dialog from '@radix-ui/react-dialog'
import { Slot } from '@radix-ui/react-slot'
import * as Tooltip from '@radix-ui/react-tooltip'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx } from 'clsx'
import { AlertCircle, CheckCircle2, FileText, LoaderCircle, Moon, Sun, X } from 'lucide-react'
import { createContext, useContext, useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { Link } from 'react-router'
import { twMerge } from 'tailwind-merge'
import type { DocStatus } from '../lib/types'

export const cx = (...args: Parameters<typeof clsx>) => twMerge(clsx(...args))
const button = cva('button', {
  variants: { variant: { primary: 'button-primary', secondary: 'button-secondary', ghost: 'button-ghost',
    danger: 'button-danger' }, size: { normal: '', sm: 'button-small', icon: 'button-icon' } },
  defaultVariants: { variant: 'secondary', size: 'normal' },
})
export function Button({ variant, size, asChild, className, ...props }: ComponentProps<'button'> &
  VariantProps<typeof button> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cx(button({ variant, size }), className)} {...props} />
}
export function Tip({ children, text }: { children: ReactNode; text: string }) {
  return <Tooltip.Root delayDuration={350}><Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="tooltip" sideOffset={7}>{text}</Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root>
}
export function Modal({ title, description, open, onOpenChange, children, wide }: {
  title: string; description: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode; wide?: boolean
}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="modal-overlay" /><Dialog.Content className={cx('modal', wide && 'modal-wide')}>
      <div className="modal-heading"><div><Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description>{description}</Dialog.Description></div>
        <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Закрыть"><X size={18} /></Button></Dialog.Close>
      </div>{children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
}
export function Confirm({ title, description, open, busy, onClose, onConfirm }: {
  title: string; description: string; open: boolean; busy?: boolean; onClose: () => void; onConfirm: () => void
}) {
  return <Modal title={title} description={description} open={open} onOpenChange={value => { if (!value && !busy) onClose() }}>
    <div className="modal-actions"><Button onClick={onClose} disabled={busy}>Отмена</Button>
      <Button variant="danger" onClick={onConfirm} disabled={busy}>{busy && <Spinner />} Удалить</Button></div>
  </Modal>
}
export function Spinner() { return <LoaderCircle className="spinner" size={16} aria-hidden /> }
export function Skeleton({ count = 3 }: { count?: number }) {
  return <div className="skeleton-group" role="status" aria-label="Загрузка">{Array.from({ length: count }, (_, i) =>
    <div className="skeleton" key={i} />)}</div>
}
export function Empty({ icon = <FileText size={24} />, title, body, action }: {
  icon?: ReactNode; title: string; body: string; action?: ReactNode
}) {
  return <div className="empty"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{body}</p>{action}</div>
}
export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <div role="alert" className="error-notice"><AlertCircle size={17} /> <span>{message}</span>
    {retry && <Button size="sm" onClick={retry}>Повторить</Button>}</div>
}
const statusLabels: Record<DocStatus, string> = {
  uploaded: 'Загружен', queued: 'В очереди', processing: 'Обработка', ready: 'Готов', failed: 'Ошибка',
}
export const statuses = statusLabels
export const Badge = ({ status }: { status: DocStatus }) =>
  <span className={'status status-' + status}><i />{statusLabels[status]}</span>
export function FileIcon({ extension }: { extension: string }) {
  return <span className={'file-icon file-' + extension} aria-hidden><FileText size={17} /></span>
}
export function Brand({ route = '/' }: { route?: string }) {
  return <Link className="brand" to={route} aria-label="DocuMind AI"><img width="34" height="34" src="/brand.svg" alt="" />
    <span>DocuMind<span className="brand-ai"> AI</span></span></Link>
}

type Theme = 'dark' | 'light'
type UI = { theme: Theme; toggle: () => void; notify: (message: string, isError?: boolean) => void }
const Context = createContext<UI | null>(null)
export function UIProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem('documind-theme') === 'light' ? 'light' : 'dark')
  const [toast, setToast] = useState<{ message: string; isError: boolean; stamp: number } | null>(null)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101915' : '#f3f5ee')
    localStorage.setItem('documind-theme', theme)
  }, [theme])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4400)
    return () => clearTimeout(timer)
  }, [toast])
  return <Context.Provider value={{ theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    notify: (message, isError = false) => setToast({ message, isError, stamp: Date.now() }) }}>
    <Tooltip.Provider>{children}</Tooltip.Provider>
    {toast && <div className="toast" role={toast.isError ? 'alert' : 'status'}>
      {toast.isError ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}
      <span>{toast.message}</span><Button variant="ghost" size="icon" aria-label="Закрыть уведомление" onClick={() => setToast(null)}><X size={16} /></Button>
    </div>}
  </Context.Provider>
}
export function useUI() {
  const value = useContext(Context)
  if (!value) throw new Error('UIProvider is required')
  return value
}
export function ThemeToggle() {
  const { theme, toggle } = useUI()
  const label = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'
  return <Tip text={label}><Button variant="ghost" size="icon" onClick={toggle} aria-label={label}>
    {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
  </Button></Tip>
}
