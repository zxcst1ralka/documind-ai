
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Download, FileText, MessageSquareText, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Badge, Button, Confirm, Empty, ErrorNotice, FileIcon, Modal, Skeleton, Spinner, useUI } from '../components/ui'
import { api, download, fileBlob, json } from '../lib/api'
import { errorMessage, formatBytes, formatDate } from '../lib/format'
import { useSession } from '../lib/session'
import type { Doc } from '../lib/types'

const PdfPreview = lazy(() => import('../components/PdfPreview'))

function EditDocument({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const [name, setName] = useState(doc.name)
  const [category, setCategory] = useState(doc.category ?? '')
  const [tags, setTags] = useState(doc.tags.join(', '))
  const { notify } = useUI()
  const cache = useQueryClient()
  const edit = useMutation({ mutationFn: () => api<Doc>('/documents/' + doc.id, json('PATCH', {
    name: name.trim(), category: category.trim() || null, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
  })), onSuccess: async data => {
    cache.setQueryData(['document', doc.id], data)
    await cache.invalidateQueries({ queryKey: ['documents'] })
    void cache.invalidateQueries({ queryKey: ['summary'] })
    notify('Документ обновлён')
    onClose()
  } })
  const save = (event: FormEvent) => { event.preventDefault(); edit.mutate() }
  return <Modal open onOpenChange={value => { if (!value && !edit.isPending) onClose() }} title="Изменить документ"
    description="Укажите имя, категорию и теги для поиска в библиотеке.">
    <form className="form" onSubmit={save}>
      <label>Название<input required maxLength={255} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Категория<input maxLength={80} value={category} onChange={e => setCategory(e.target.value)} placeholder="Например, договоры" /></label>
      <label>Теги<input maxLength={616} value={tags} onChange={e => setTags(e.target.value)} placeholder="Через запятую" /></label>
      {edit.error && <ErrorNotice message={edit.error.message} />}
      <div className="modal-actions"><Button type="button" onClick={onClose}>Отмена</Button>
        <Button variant="primary" disabled={!name.trim() || edit.isPending}>{edit.isPending && <Spinner />} Сохранить</Button></div>
    </form></Modal>
}

export default function DocumentPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const { user } = useSession()
  const { notify } = useUI()
  const cache = useQueryClient()
  const navigate = useNavigate()
  const base = '/documents/' + id
  const item = useQuery({ queryKey: ['document', id], queryFn: () => api<Doc>(base),
    refetchInterval: query => ['queued', 'uploaded', 'processing'].includes(query.state.data?.status ?? '') ? 1800 : false })
  const doc = item.data
  const page = Math.min(600, Math.max(1, parseInt(params.get('page') || '1', 10) || 1))
  const pdf = doc?.extension === 'pdf' && params.get('view') !== 'text'
  const text = useQuery({ queryKey: ['document-text', id], queryFn: () => api<{ text: string }>(base + '/text'),
    enabled: Boolean(doc?.status === 'ready' && !pdf) })
  const blob = useQuery({ queryKey: ['document-pdf', id], queryFn: () => fileBlob(base + '/download'), enabled: Boolean(pdf) })
  const [pdfUrl, setPdfUrl] = useState('')
  useEffect(() => {
    if (!blob.data || !pdf) { setPdfUrl(''); return }
    const url = URL.createObjectURL(blob.data)
    setPdfUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [blob.data, pdf])
  const remove = useMutation({ mutationFn: () => api(base, { method: 'DELETE' }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['documents'] })
      ;['summary', 'chats', 'analyses', 'comparisons', 'exports'].forEach(key => void cache.invalidateQueries({ queryKey: [key] }))
      notify('Документ удалён')
      navigate('/app/documents')
    }, onError: error => notify(error.message, true) })
  const reprocess = useMutation({ mutationFn: () => api<Doc>(base + '/reprocess', { method: 'POST' }),
    onSuccess: data => { cache.setQueryData(['document', id], data); void cache.invalidateQueries({ queryKey: ['documents'] }) },
    onError: error => notify(error.message, true) })
  async function saveOriginal() {
    if (!doc) return
    setDownloading(true)
    try { await download(base + '/download', doc.original_name) }
    catch (error) { notify(errorMessage(error), true) }
    finally { setDownloading(false) }
  }
  if (!doc || item.isError) return <div className="screen">
    <Button asChild variant="ghost"><Link to="/app/documents"><ChevronLeft size={16} /> Библиотека</Link></Button>
    {item.isLoading ? <Skeleton /> : <ErrorNotice message={item.error?.message ?? 'Документ не найден.'} />}
  </div>
  return <div className="screen">
    <Link className="back-link" to="/app/documents"><ChevronLeft size={16} /> Документы</Link>
    <div className="page-heading doc-heading"><div><div className="file-title"><FileIcon extension={doc.extension} /><h1>{doc.name}</h1></div>
      <p>{doc.extension.toUpperCase()} · {formatBytes(doc.size)} · {formatDate(doc.created_at)}{doc.page_count ? ' · Страниц: ' + doc.page_count : ''}</p></div></div>
    <div className="doc-grid">
      <section className="panel document-reader"><div className="panel-heading"><h2><FileText size={17} /> Содержимое</h2>
        {doc.extension === 'pdf' && <div className="segmented">
          <button aria-pressed={pdf} onClick={() => setParams({ page: String(page) })}>PDF</button>
          <button aria-pressed={!pdf} onClick={() => setParams({ view: 'text' })}>Текст</button>
        </div>}</div>
        {!user?.read_only && doc.status === 'ready' && <Link className="document-question" to={'/app/chat?document=' + id}>
          <MessageSquareText size={17} /> Задать вопрос
        </Link>}
        {pdf ? blob.error ? <ErrorNotice message={blob.error.message} /> : pdfUrl ? <Suspense fallback={<Skeleton />}>
          <PdfPreview file={pdfUrl} page={page} setPage={n => setParams({ page: String(n) })} />
        </Suspense> : <Skeleton /> : doc.status !== 'ready' ? <Empty title={doc.status === 'failed' ? 'Не удалось обработать документ' : 'Текст ещё обрабатывается'}
          body={doc.error || 'Текст появится после извлечения и индексации.'} /> :
          text.error ? <ErrorNotice message={text.error.message} /> : text.data ? <pre className="extracted-text">{text.data.text}</pre> : <Skeleton />}
      </section>
      <aside className="panel doc-meta"><div className="panel-heading"><h2>Сведения о файле</h2></div>
        <dl><dt>Статус</dt><dd><Badge status={doc.status} /></dd><dt>Категория</dt><dd>{doc.category || 'Без категории'}</dd>
          {doc.ocr_page_count > 0 && <><dt>Распознано через OCR</dt><dd>Страниц: {doc.ocr_page_count}</dd></>}
          <dt>Теги</dt><dd>{doc.tags.length ? <div className="chips">{doc.tags.map(tag => <span key={tag}>{tag}</span>)}</div> : '—'}</dd></dl>
        {doc.error && <ErrorNotice message={doc.error} />}
        <div className="doc-btns">
          <Button size="sm" onClick={saveOriginal} disabled={downloading}>{downloading ? <Spinner /> : <Download size={16} />} Скачать оригинал</Button>
          {!user?.read_only && <>
            {doc.status === 'failed' && <Button size="sm" onClick={() => reprocess.mutate()} disabled={reprocess.isPending}><RefreshCw size={16} /> Повторить обработку</Button>}
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil size={15} /> Редактировать</Button>
            <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}><Trash2 size={15} /> Удалить документ</Button>
          </>}
        </div>
      </aside>
    </div>
    {editing && <EditDocument doc={doc} onClose={() => setEditing(false)} />}
    <Confirm open={deleting} busy={remove.isPending} title="Удалить документ?"
      description="Оригинал, извлечённый текст и связанные диалоги и отчёты будут удалены."
      onClose={() => setDeleting(false)} onConfirm={() => remove.mutate()} />
  </div>
}
