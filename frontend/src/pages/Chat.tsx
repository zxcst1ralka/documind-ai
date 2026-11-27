
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Copy, FileText, MessageSquareText, Pencil, Plus, RefreshCw, Send, Sparkles, Square, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import remarkGfm from 'remark-gfm'
import { SourceContent, SourceDialog } from '../components/SourcePanel'
import { Button, Confirm, Empty, ErrorNotice, FileIcon, Modal, Skeleton, Spinner, Tip, useUI } from '../components/ui'
import { useSummary } from '../components/Workspace'
import { api, json, streamReply } from '../lib/api'
import { errorMessage } from '../lib/format'
import { useSession } from '../lib/session'
import type { Chat, Message, Source } from '../lib/types'
import { useDocuments } from './Library'

const prompts = ['Кратко перескажи документ.', 'Выдели основные положения.', 'Найди сроки и суммы.',
  'Какие обязательства указаны?', 'Какие потенциальные риски есть в документе?']

function ChatPicker({ initial, onClose, onSuccess }: { initial: string | null; onClose: () => void; onSuccess: (id: string) => void }) {
  const docs = useDocuments()
  const cache = useQueryClient()
  const [selected, setSelected] = useState<string[]>(initial ? [initial] : [])
  const [title, setTitle] = useState('')
  const ready = docs.data?.filter(doc => doc.status === 'ready') ?? []
  const ids = selected.filter(id => ready.some(doc => doc.id === id))
  const create = useMutation({ mutationFn: () => api<Chat>('/chats', json('POST', {
    document_ids: ids, title: title.trim() || (ids.length === 1 ? ready.find(doc => doc.id === ids[0])?.name.slice(0, 100) : 'Новый чат'),
  })), onSuccess: result => {
    void cache.invalidateQueries({ queryKey: ['chats'] })
    void cache.invalidateQueries({ queryKey: ['summary'] })
    onSuccess(result.id)
  } })
  return <Modal title="Новый чат" description="Выберите готовые документы для поиска ответов." open
    onOpenChange={open => { if (!open && !create.isPending) onClose() }}>
    <form className="form" onSubmit={event => { event.preventDefault(); if (ids.length) create.mutate() }}>
      <label>Название чата<input maxLength={100} value={title} onChange={e => setTitle(e.target.value)} placeholder="По названию документа" /></label>
      {docs.isLoading && <Skeleton />}
      {docs.error && <ErrorNotice message={docs.error.message} />}
      <div className="selection-list">{ready.map(doc => <label key={doc.id} className="selection-row">
        <input type="checkbox" checked={ids.includes(doc.id)} onChange={e => setSelected(e.target.checked
          ? [...selected, doc.id] : selected.filter(id => id !== doc.id))} />
        <FileIcon extension={doc.extension} /><span>{doc.name}</span></label>)}</div>
      {!docs.isLoading && !ready.length && <Empty title="Готовых документов пока нет" body="Загрузите документ и дождитесь обработки."
        action={<Button variant="ghost" size="sm" asChild><Link to="/app/documents">Библиотека</Link></Button>} />}
      {create.error && <ErrorNotice message={create.error.message} />}
      <div className="modal-actions"><Button type="button" onClick={onClose}>Отмена</Button>
        <Button variant="primary" disabled={!ids.length || create.isPending}>{create.isPending && <Spinner />} Создать чат</Button></div>
    </form>
  </Modal>
}

export function CitationList({ sources, onSelect, active }: { sources: Source[]; onSelect: (source: Source) => void; active?: string }) {
  return <div className="citation-list" aria-label="Источники">{sources.map((source, index) =>
    <button className="citation" type="button" key={source.id} aria-pressed={active === source.id} onClick={() => onSelect(source)}>
      <b>{source.number ?? index + 1}</b><FileText size={14} /><span>{source.name} · {source.location}</span>
    </button>)}</div>
}
function AssistantBody({ message, active, onSource }: { message: Message; active?: string; onSource: (source: Source) => void }) {
  const { notify } = useUI()
  const sources = new Map(message.sources.map((source, index) => [source.number ?? index + 1, source]))
  const content = message.content.replace(/\[(\d{1,4})\](?!\()/g, (marker, number: string) =>
    sources.has(Number(number)) ? '[' + number + '](#source-' + number + ')' : marker)
  return <div className="assistant-message">
    <span className="assistant-mark"><Sparkles size={17} /></span>
    <div className="assistant-content"><div className="assistant-name">DocuMind AI</div>
      <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img', 'input']}
        components={{ a: ({ children, href }) => {
          const number = /^#source-(\d{1,4})$/.exec(href ?? '')?.[1]
          const item = sources.get(Number(number))
          return item ? <button type="button" className="inline-citation" aria-pressed={active === item.id}
            aria-label={'Источник ' + number + ', ' + item.location} onClick={() => onSource(item)}>{number}</button>
            : <span>{children}</span>
        } }}>{content}</ReactMarkdown></div>
      {message.sources.length > 0 && <CitationList sources={message.sources} active={active} onSelect={onSource} />}
      <Tip text="Копировать ответ"><Button size="icon" variant="ghost" aria-label="Копировать ответ" onClick={() =>
        navigator.clipboard.writeText(message.content).then(() => notify('Ответ скопирован')).catch(error => notify(errorMessage(error), true))}>
        <Copy size={15} /></Button></Tip>
    </div>
  </div>
}

function Conversation({ id }: { id: string }) {
  const { user } = useSession()
  const summary = useSummary()
  const cache = useQueryClient()
  const navigate = useNavigate()
  const { notify } = useUI()
  const [question, setQuestion] = useState('')
  const [pendingQuestion, setPendingQuestion] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState('')
  const [consent, setConsent] = useState(false)
  const [source, setSource] = useState<Source | null>(null)
  const [modalSource, setModalSource] = useState<Source | null>(null)
  const [rename, setRename] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const transcript = useRef<HTMLDivElement>(null)

  const detail = useQuery({ queryKey: ['chat', id], queryFn: () => api<Chat>('/chats/' + id) })
  const history = useQuery({ queryKey: ['messages', id], queryFn: () => api<Message[]>('/chats/' + id + '/messages') })
  const docs = useDocuments()
  const selected = docs.data?.filter(doc => detail.data?.document_ids?.includes(doc.id)) ?? []
  const entries = history.data ?? []
  const last = entries.at(-1)

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight }, [entries.length, draft, sending])

  const remove = useMutation({ mutationFn: () => api('/chats/' + id, { method: 'DELETE' }), onSuccess: () => {
    void cache.invalidateQueries({ queryKey: ['chats'] })
    void cache.invalidateQueries({ queryKey: ['summary'] })
    navigate('/app/chat')
    notify('Чат удалён')
  }, onError: error => notify(error.message, true) })
  const edit = useMutation({ mutationFn: () => api<Chat>('/chats/' + id, json('PATCH', { title: rename?.trim() })),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['chat', id] })
      void cache.invalidateQueries({ queryKey: ['chats'] })
      void cache.invalidateQueries({ queryKey: ['summary'] })
      setRename(null)
    } })

  function openSource(item: Source) {
    setSource(item)
    if (window.matchMedia('(max-width: 1150px)').matches) setModalSource(item)
  }

  async function send(value: string, regenerate = false) {
    if (controller.current || (!value.trim() && !regenerate)) return
    const signal = new AbortController()
    controller.current = signal
    setError(''); setDraft(''); setSending(true); setRegenerating(regenerate)
    setPendingQuestion(regenerate ? '' : value.trim())
    if (!regenerate) setQuestion('')
    try {
      await streamReply(id, { question: regenerate ? null : value.trim(), regenerate, consent },
        signal.signal, text => setDraft(before => before + text))
    } catch (error) {
      if (!signal.signal.aborted) {
        setError(errorMessage(error))
        if (!regenerate) setQuestion(value)
      }
    } finally {
      await cache.invalidateQueries({ queryKey: ['messages', id] })
      void cache.invalidateQueries({ queryKey: ['summary'] })
      setPendingQuestion(''); setDraft(''); setSending(false); setRegenerating(false)
      controller.current = null
    }
  }

  if (!detail.data || detail.error) return <div className="chat-main">{detail.isLoading ? <Skeleton /> :
    <ErrorNotice message={detail.error?.message ?? 'Чат недоступен.'} />}</div>
  const external = Boolean(summary.data?.ai.external)
  const canSend = !user?.read_only && (!external || consent)
  return <>
    <div className="chat-main">
      <header className="chat-top"><div><h2>{detail.data.title}</h2><div className="chips chat-docs">{selected.map(doc =>
        <Link key={doc.id} to={'/app/documents/' + doc.id}><FileText size={13} /> {doc.name}</Link>)}</div></div>
        {!user?.read_only && <div className="actions">
          <Tip text="Переименовать"><Button size="icon" variant="ghost" aria-label="Переименовать чат" onClick={() => setRename(detail.data.title)}>
            <Pencil size={16} /></Button></Tip>
          <Tip text="Удалить"><Button size="icon" variant="ghost" aria-label="Удалить чат" onClick={() => setDeleting(true)}>
            <Trash2 size={16} /></Button></Tip>
        </div>}</header>
      <div className="transcript" ref={transcript}>
        {history.isLoading && <Skeleton />}
        {history.error && <ErrorNotice message={history.error.message} retry={() => history.refetch()} />}
        {!history.isLoading && entries.length === 0 && !sending && <div className="chat-start">
          <div className="feature-icon"><Sparkles size={23} /></div><h3>Что узнать из документов?</h3>
          {canSend && <div className="prompts">{prompts.map(item => <Button key={item} size="sm" variant="secondary"
            onClick={() => setQuestion(item)}>{item}</Button>)}</div>}
        </div>}
        {(regenerating && last?.role === 'assistant' ? entries.slice(0, -1) : entries).map(message => message.role === 'user'
          ? <p className="user-message" key={message.id}>{message.content}</p>
          : <AssistantBody key={message.id} message={message} active={source?.id} onSource={openSource} />)}
        {pendingQuestion && <p className="user-message">{pendingQuestion}</p>}
        {sending && <div className="assistant-message"><span className="assistant-mark"><Sparkles size={17} /></span>
          <div className="assistant-content"><div className="assistant-name">DocuMind AI</div>
            <div className="stream-text" role="status">{draft || <><Spinner /> Поиск и генерация…</>}</div></div></div>}
      </div>
      {!user?.read_only && <div className="chat-composer">
        {error && <ErrorNotice message={error} />}
        {summary.data?.ai.provider === 'disabled' && <p className="chat-hint">Для ответов настройте AI-провайдер на сервере.</p>}
        {external && <label className="checkbox-label"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
          Разрешаю отправить вопрос, историю и найденные фрагменты внешнему AI-провайдеру.</label>}
        <form onSubmit={(event: FormEvent) => { event.preventDefault(); if (canSend) void send(question) }} className="composer-input">
          <textarea rows={2} aria-label="Вопрос по документам" placeholder="Спросите о документах…" value={question}
            onChange={e => setQuestion(e.target.value)} maxLength={4000}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (canSend && !sending) void send(question)
            } }} />
          {sending ? <Button size="icon" type="button" onClick={() => controller.current?.abort()} aria-label="Остановить генерацию"><Square size={17} /></Button>
            : <Button size="icon" variant="primary" disabled={!canSend || !question.trim()} aria-label="Отправить вопрос"><Send size={17} /></Button>}
        </form>
        {entries.some(message => message.role === 'user') && !sending && <Button variant="ghost" size="sm" disabled={!canSend}
          onClick={() => void send('', true)}><RefreshCw size={15} /> Повторить генерацию</Button>}
      </div>}
    </div>
    <aside className="chat-source"><div className="panel-heading"><h2><BookOpen size={17} /> Источники</h2></div><SourceContent source={source} /></aside>
    <SourceDialog source={modalSource} onClose={() => setModalSource(null)} />
    <Modal open={rename !== null} onOpenChange={open => { if (!open) setRename(null) }} title="Переименовать чат"
      description="Укажите понятное название для истории.">
      <form className="form" onSubmit={e => { e.preventDefault(); edit.mutate() }}>
        <label>Название<input maxLength={100} required value={rename ?? ''} onChange={e => setRename(e.target.value)} /></label>
        {edit.error && <ErrorNotice message={edit.error.message} />}
        <div className="modal-actions"><Button variant="primary" disabled={!rename?.trim() || edit.isPending}>Сохранить</Button></div>
      </form></Modal>
    <Confirm open={deleting} busy={remove.isPending} title="Удалить чат?" description="История этого диалога будет удалена."
      onClose={() => setDeleting(false)} onConfirm={() => remove.mutate()} />
  </>
}

export default function ChatPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useSession()
  const chats = useQuery({ queryKey: ['chats'], queryFn: () => api<Chat[]>('/chats') })
  const picker = params.has('new') || params.has('document')
  return <div className="screen chat-screen">
    <div className="page-heading"><div><h1>AI-чат</h1><p>Вопросы по библиотеке и проверяемые источники.</p></div></div>
    <div className="panel chat-layout">
      <aside className="chat-history"><div className="panel-heading"><h2>История</h2></div>
        {!user?.read_only && <div className="chat-history-action">
          <Button variant="primary" onClick={() => setParams({ new: '1' })}><Plus size={17} /> Новый чат</Button>
        </div>}
        {chats.isLoading && <Skeleton count={2} />}
        {chats.error && <ErrorNotice message={chats.error.message} />}
        {chats.data?.length === 0 && <p className="sidebar-empty">Диалогов пока нет</p>}
        <nav aria-label="История чатов">{chats.data?.map(chat => <Link className={chat.id === id ? 'active' : undefined}
          aria-current={chat.id === id ? 'page' : undefined} key={chat.id} to={'/app/chat/' + chat.id}>
          <MessageSquareText size={16} /><span>{chat.title}</span>
        </Link>)}</nav>
      </aside>
      {id ? <Conversation key={id} id={id} /> : <div className="chat-main chat-empty">
        <Empty icon={<MessageSquareText size={27} />} title="Выберите чат или начните новый"
          body="DocuMind AI найдёт подходящие фрагменты и покажет ссылки на источники." /></div>}
    </div>
    {picker && !user?.read_only && <ChatPicker initial={params.get('document')} onClose={() => setParams({})}
      onSuccess={chatId => navigate('/app/chat/' + chatId)} />}
  </div>
}
