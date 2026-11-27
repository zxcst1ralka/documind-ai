
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, CloudUpload, FileText, FolderOpen, Search, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Badge, Button, Empty, ErrorNotice, FileIcon, Modal, Skeleton, Spinner, statuses, useUI } from '../components/ui'
import { useSummary } from '../components/Workspace'
import { api, uploadFile } from '../lib/api'
import { errorMessage, formatBytes, formatDate } from '../lib/format'
import { useSession } from '../lib/session'
import type { Doc } from '../lib/types'

const extensions = ['pdf', 'docx', 'txt', 'md', 'csv', 'xlsx']
const accept = extensions.map(extension => '.' + extension).join(',')
const active = new Set(['uploaded', 'queued', 'processing'])
type Transfer = { name: string; progress: number; status: 'waiting' | 'sending' | 'done' | 'error'; error?: string }

export function useDocuments() {
  return useQuery({ queryKey: ['documents', 'all'], queryFn: () => api<Doc[]>('/documents'),
    refetchInterval: query => query.state.data?.some(doc => active.has(doc.status)) ? 2000 : false })
}

function UploadDialog({ open, onClose, limit }: { open: boolean; onClose: () => void; limit: number }) {
  const input = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [rows, setRows] = useState<Transfer[]>([])
  const [busy, setBusy] = useState(false)
  const cache = useQueryClient()
  const { notify } = useUI()

  async function start(files: File[]) {
    if (busy || !files.length) return
    setBusy(true)
    setRows(files.map(file => ({ name: file.name, progress: 0, status: 'waiting' })))
    const patch = (index: number, part: Partial<Transfer>) =>
      setRows(previous => previous.map((row, i) => i === index ? { ...row, ...part } : row))
    let accepted = 0
    for (const [index, file] of files.entries()) {
      patch(index, { status: 'sending' })
      try {
        if (file.size > limit * 1024 ** 2) throw new Error('Лимит файла: ' + limit + ' МБ')
        await uploadFile(file, progress => patch(index, { progress }))
        patch(index, { status: 'done', progress: 100 })
        accepted++
        await cache.invalidateQueries({ queryKey: ['documents'] })
      } catch (error) { patch(index, { status: 'error', error: errorMessage(error) }) }
    }
    setBusy(false)
    void cache.invalidateQueries({ queryKey: ['summary'] })
    if (accepted) notify('Документы в очереди на обработку: ' + accepted)
  }

  return <Modal open={open} onOpenChange={value => { if (!value && !busy) onClose() }}
    title="Загрузите документы" description="Файлы появятся в библиотеке сразу после загрузки.">
    <input ref={input} aria-label="Файлы документов" type="file" accept={accept} multiple hidden disabled={busy}
      onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void start(files) }} />
    <button className={'drop-zone' + (drag ? ' drop-active' : '')} onClick={() => input.current?.click()} disabled={busy}
      onDragOver={e => { e.preventDefault(); setDrag(!busy) }} onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); void start(Array.from(e.dataTransfer.files)) }}>
      <span className="feature-icon"><CloudUpload size={23} /></span>
      <strong>Перетащите файлы сюда</strong><span>или нажмите, чтобы выбрать</span>
      <small>PDF, DOCX, TXT, MD, CSV, XLSX · до {limit} МБ на файл</small>
    </button>
    {rows.length > 0 && <div className="transfer-list" aria-live="polite">{rows.map((row, index) =>
      <div className="transfer" key={index}><FileText size={17} /><div>
        <strong>{row.name}</strong>{row.error && <span className="field-error">{row.error}</span>}
        {row.status === 'sending' && <progress value={row.progress} max={100} aria-label={'Загрузка ' + row.name} />}
      </div><small>{row.status === 'done' ? 'Загружен' : row.status === 'sending' ? row.progress + '%' : ''}</small></div>)}</div>}
    <div className="modal-actions"><Button onClick={onClose} disabled={busy}>{busy && <Spinner />}{busy ? 'Загрузка' : 'Готово'}</Button></div>
  </Modal>
}

export default function Library() {
  const { user } = useSession()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [format, setFormat] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState('new')
  const [category, setCategory] = useState('')
  const docs = useDocuments()
  const summary = useSummary()
  const uploading = params.get('upload') === '1'
  const list = docs.data ?? []
  const categories = [...new Set(list.flatMap(doc => doc.category ? [doc.category] : []))]
  const visible = list.filter(doc => doc.name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')) &&
    (!format || doc.extension === format) && (!status || doc.status === status) && (!category || doc.category === category))
  visible.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'ru') :
    sort === 'size' ? b.size - a.size : sort === 'old' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at))
  return <div className="screen">
    <div className="page-heading"><div><h1>Документы</h1><p>Файлы, категории и состояние обработки.</p></div>
      {!user?.read_only && <Button variant="primary" onClick={() => setParams({ upload: '1' })}><Upload size={17} /> Загрузить</Button>}</div>
    <section className="panel library-panel">
      <div className="library-toolbar">
        <label className="search-control"><Search size={17} /><input aria-label="Поиск по названию" value={search}
          onChange={event => setSearch(event.target.value)} placeholder="Поиск по названию…" /></label>
        <div className="filters">
          <select aria-label="Формат" value={format} onChange={e => setFormat(e.target.value)}><option value="">Все форматы</option>
            {extensions.map(ext => <option key={ext} value={ext}>{ext.toUpperCase()}</option>)}</select>
          <select aria-label="Статус" value={status} onChange={e => setStatus(e.target.value)}><option value="">Все статусы</option>
            {Object.entries(statuses).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select>
          {categories.length > 0 && <select aria-label="Категория" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">Все категории</option>{categories.map(value => <option key={value}>{value}</option>)}</select>}
          <select aria-label="Сортировка" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="new">Сначала новые</option><option value="old">Сначала старые</option><option value="name">По названию</option>
            <option value="size">По размеру</option></select>
        </div>
      </div>
      {docs.isLoading && <Skeleton count={5} />}
      {docs.error && <ErrorNotice message={docs.error.message} retry={() => docs.refetch()} />}
      {!docs.isLoading && !docs.error && !visible.length && <Empty icon={<FolderOpen size={26} />}
        title={list.length ? 'Документы не найдены' : 'В библиотеке пока пусто'}
        body={list.length ? 'Измените запрос или уберите фильтры.' : 'Добавьте файл, чтобы искать по его содержимому и задавать вопросы.'}
        action={list.length ? <Button size="sm" onClick={() => { setSearch(''); setStatus(''); setCategory(''); setFormat('') }}>Сбросить фильтры</Button> :
          !user?.read_only && <Button size="sm" onClick={() => setParams({ upload: '1' })}><Upload size={15} /> Загрузить документы</Button>} />}
      {visible.length > 0 && <div className="library-table" role="table" aria-label="Документы">
        <div role="row" className="library-cols library-labels"><span role="columnheader">Имя файла</span>
          <span role="columnheader">Категория</span><span role="columnheader">Размер</span><span role="columnheader">Добавлен</span>
          <span role="columnheader">Статус</span><span role="columnheader" aria-label="Открыть" /></div>
        {visible.map(doc => <div role="row" className="library-cols library-row" key={doc.id}>
          <div role="cell"><Link className="file-link" to={'/app/documents/' + doc.id}><FileIcon extension={doc.extension} />
            <span><strong>{doc.name}</strong><small>{doc.extension.toUpperCase()}{doc.tags.length ? ' · ' + doc.tags.join(', ') : ''}</small></span></Link></div>
          <span role="cell" className="muted">{doc.category || '—'}</span><span role="cell" className="muted">{formatBytes(doc.size)}</span>
          <span role="cell" className="muted">{formatDate(doc.created_at)}</span><span role="cell"><Badge status={doc.status} /></span>
          <span role="cell"><Link className="row-open" to={'/app/documents/' + doc.id} aria-label={'Открыть ' + doc.name}><ChevronRight size={17} /></Link></span>
        </div>)}
      </div>}
      {visible.length > 0 && <div className="table-footer">Показано {visible.length} из {list.length}</div>}
    </section>
    {!user?.read_only && uploading && <UploadDialog open onClose={() => setParams({})} limit={summary.data?.limits.max_file_mb ?? 25} />}
  </div>
}
