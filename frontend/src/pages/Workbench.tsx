
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Download, FileBarChart2, FileText, GitCompareArrows, ScanSearch, Sparkles, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { SourceDialog } from '../components/SourcePanel'
import { Button, Confirm, Empty, ErrorNotice, Modal, Skeleton, Spinner, useUI } from '../components/ui'
import { useSummary } from '../components/Workspace'
import { api, download, json } from '../lib/api'
import { analysisModes, errorMessage, formatDate } from '../lib/format'
import { useSession } from '../lib/session'
import type { Analysis, Comparison, Doc, Export, Risk, Source } from '../lib/types'
import { CitationList } from './Chat'
import { useDocuments } from './Library'

const fields: Record<string, string> = {
  document_type: 'Тип документа', parties: 'Стороны', subject: 'Предмет договора', price: 'Стоимость', term: 'Срок действия',
  payment: 'Условия оплаты', obligations: 'Обязательства', liability: 'Ответственность', penalties: 'Штрафы',
  termination: 'Расторжение', unclear: 'Неясные условия', specialist_questions: 'Вопросы для специалиста',
}
const levels = { low: 'Низкий', medium: 'Средний', high: 'Высокий' }
const changes = { added: 'Добавлено', removed: 'Удалено', changed: 'Изменено' }
type AnalysisEntry = Pick<Analysis, 'id' | 'mode' | 'document_name' | 'created_at'>
type ComparisonEntry = Pick<Comparison, 'id' | 'before_name' | 'after_name' | 'created_at'>

function DocumentSelect({ title, docs, value, onChange }: { title: string; docs: Doc[]; value: string; onChange: (value: string) => void }) {
  return <label>{title}<select aria-label={title} value={value} onChange={event => onChange(event.target.value)} required>
    <option value="">Выберите документ</option>{docs.map(doc => <option value={doc.id} key={doc.id}>{doc.name}</option>)}</select></label>
}

function ExportDialog({ kind, id, onClose }: { kind: 'analysis' | 'comparison'; id: string; onClose: () => void }) {
  const [format, setFormat] = useState('pdf')
  const cache = useQueryClient()
  const { notify } = useUI()
  const create = useMutation({ mutationFn: async () => {
    const result = await api<Export>('/exports', json('POST', { kind, resource_id: id, format }))
    void cache.invalidateQueries({ queryKey: ['exports'] })
    await download('/exports/' + result.id + '/download', 'DocuMind — ' + result.title + '.' + result.format)
  }, onSuccess: () => { notify('Отчёт сохранён'); onClose() } })
  return <Modal open title="Экспорт отчёта" description="Файл также появится в разделе «Отчёты»."
    onOpenChange={open => { if (!open && !create.isPending) onClose() }}>
    <form className="form" onSubmit={e => { e.preventDefault(); create.mutate() }}>
      <label>Формат<select value={format} onChange={e => setFormat(e.target.value)}>
        <option value="pdf">PDF</option><option value="docx">DOCX</option><option value="md">Markdown</option>
      </select></label>
      {create.error && <ErrorNotice message={create.error.message} />}
      <div className="modal-actions"><Button variant="primary" disabled={create.isPending}>
        {create.isPending ? <Spinner /> : <Download size={16} />} Скачать отчёт</Button></div>
    </form></Modal>
}

function LegalNote() { return <div className="legal-note"><CircleAlert size={17} /> Результат AI не заменяет профессиональную юридическую консультацию.</div> }

export function AnalysisPage() {
  const { id } = useParams()
  const [documentId, setDocumentId] = useState('')
  const [mode, setMode] = useState('contract')
  const [prompt, setPrompt] = useState('')
  const [consent, setConsent] = useState(false)
  const [source, setSource] = useState<Source | null>(null)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { user } = useSession()
  const { notify } = useUI()
  const cache = useQueryClient()
  const navigate = useNavigate()
  const summary = useSummary()
  const docs = useDocuments()
  const ready = docs.data?.filter(doc => doc.status === 'ready') ?? []
  const list = useQuery({ queryKey: ['analyses'], queryFn: () => api<AnalysisEntry[]>('/analyses') })
  const record = useQuery({ queryKey: ['analysis', id], queryFn: () => api<Analysis>('/analyses/' + id), enabled: Boolean(id) })
  const start = useMutation({
    mutationFn: () => api<Analysis>('/analyses', json('POST', { document_id: documentId, mode, prompt, consent })),
    onSuccess: result => { cache.setQueryData(['analysis', result.id], result); navigate('/app/analysis/' + result.id) },
    onSettled: () => { void cache.invalidateQueries({ queryKey: ['analyses'] }); void cache.invalidateQueries({ queryKey: ['summary'] }) },
  })
  const remove = useMutation({ mutationFn: () => api('/analyses/' + id, { method: 'DELETE' }), onSuccess: () => {
    void cache.invalidateQueries({ queryKey: ['analyses'] }); void cache.invalidateQueries({ queryKey: ['exports'] })
    setDeleting(false); navigate('/app/analysis'); notify('Результат удалён')
  }, onError: error => notify(error.message, true) })
  const item = record.data
  const result = item?.result
  const external = summary.data?.ai.external
  const references = (numbers: number[]) => result?.sources.filter(source => numbers.includes(source.number ?? 0)) ?? []
  const submit = (event: FormEvent) => { event.preventDefault(); start.mutate() }
  return <div className="screen">
    <div className="page-heading"><div><h1>Анализ</h1><p>Резюме, факты и условия из загруженных документов.</p></div></div>
    <div className="workbench-grid">
      <aside>
        {!user?.read_only && <section className="panel"><div className="panel-heading"><h2><ScanSearch size={18} /> Новый анализ</h2></div>
          <form className="form panel-form" onSubmit={submit}>
            <DocumentSelect title="Документ" docs={ready} value={documentId} onChange={setDocumentId} />
            <label>Режим<select aria-label="Режим" value={mode} onChange={event => setMode(event.target.value)}>
              {Object.entries(analysisModes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            {mode === 'custom' && <label>Вопрос<textarea required maxLength={1500} rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} /></label>}
            {external && <label className="checkbox-label"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
              Разрешаю передать текст документа внешнему AI-провайдеру.</label>}
            {docs.error && <ErrorNotice message={docs.error.message} />}
            {start.error && <ErrorNotice message={start.error.message} />}
            <Button variant="primary" disabled={!documentId || start.isPending || Boolean(external && !consent)}>
              {start.isPending ? <Spinner /> : <Sparkles size={15} />} {start.isPending ? 'Анализ выполняется' : 'Начать анализ'}</Button>
          </form></section>}
        <section className="panel"><div className="panel-heading"><h2>История анализа</h2></div>
          {list.isLoading && <Skeleton count={2} />}{list.error && <ErrorNotice message={list.error.message} />}
          {!list.isLoading && !list.data?.length && <p className="sidebar-empty">Сохранённых результатов пока нет</p>}
          <div className="workbench-history">{list.data?.map(entry => <Link key={entry.id} to={'/app/analysis/' + entry.id}
            aria-current={entry.id === id ? 'page' : undefined}><strong>{entry.document_name}</strong><small>{analysisModes[entry.mode]}</small></Link>)}</div></section>
      </aside>
      <section className="panel workbench-result">
        {record.isLoading && <Skeleton count={4} />}{record.error && <ErrorNotice message={record.error.message} />}
        {!id && <Empty icon={<ScanSearch size={25} />} title="Здесь появится результат анализа"
          body="Запустите анализ или откройте сохранённый результат." />}
        {item && result && <><div className="panel-heading result-heading"><div><h2>{analysisModes[item.mode]}</h2>
          <Link to={'/app/documents/' + item.document_id}>{item.document_name}</Link></div>
          {!user?.read_only && <div className="actions"><Button size="sm" onClick={() => setExporting(true)}><Download size={16} /> Экспорт</Button>
            <Button size="icon" variant="ghost" aria-label="Удалить результат" onClick={() => setDeleting(true)}><Trash2 size={16} /></Button></div>}</div>
          <div className="workbench-body"><LegalNote /><h3>Резюме</h3><p className="pre-wrap">{result.summary}</p>
            {result.findings.length > 0 && <><h3>Выводы</h3><div className="findings">{result.findings.map((finding, i) =>
              <article key={i}><h4>{finding.title}</h4><p>{finding.detail}</p><CitationList sources={references(finding.sources)} onSelect={setSource} /></article>)}</div></>}
            {result.contract && <><h3>Условия договора</h3><dl className="contract-fields">{Object.entries(fields).map(([key, label]) => {
              const value = result.contract?.[key]
              return <div key={key}><dt>{label}</dt><dd>{typeof value === 'string' ? value : Array.isArray(value) && value.length ?
                value.map((entry, index) => <span key={index}>{String(entry)}</span>) : '—'}</dd></div>
            })}</dl>
              {Array.isArray(result.contract.risks) && <><h3>Потенциальные риски</h3><div className="findings">
                {(result.contract.risks as Risk[]).map((risk, i) => <article key={i}><span className={'risk risk-' + risk.level}>{levels[risk.level]}</span>
                  <h4>{risk.title}</h4><p>{risk.detail}</p><CitationList sources={references(risk.sources)} onSelect={setSource} /></article>)}</div></>}</>}
            {result.sources.length > 0 && <><h3>Источники</h3><CitationList sources={result.sources} onSelect={setSource} /></>}
          </div></>}
      </section>
    </div>
    <SourceDialog source={source} onClose={() => setSource(null)} />
    {id && exporting && <ExportDialog kind="analysis" id={id} onClose={() => setExporting(false)} />}
    <Confirm open={deleting} title="Удалить результат?" description="Анализ и связанные отчёты будут удалены." busy={remove.isPending}
      onClose={() => setDeleting(false)} onConfirm={() => remove.mutate()} />
  </div>
}

export function ComparePage() {
  const { id } = useParams()
  const [before, setBefore] = useState('')
  const [after, setAfter] = useState('')
  const [summarize, setSummarize] = useState(false)
  const [consent, setConsent] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { user } = useSession()
  const { notify } = useUI()
  const cache = useQueryClient()
  const navigate = useNavigate()
  const docs = useDocuments()
  const summary = useSummary()
  const ready = docs.data?.filter(doc => doc.status === 'ready') ?? []
  const list = useQuery({ queryKey: ['comparisons'], queryFn: () => api<ComparisonEntry[]>('/comparisons') })
  const record = useQuery({ queryKey: ['comparison', id], queryFn: () => api<Comparison>('/comparisons/' + id), enabled: Boolean(id) })
  const start = useMutation({ mutationFn: () => api<Comparison>('/comparisons', json('POST', { before_id: before, after_id: after, summarize, consent })),
    onSuccess: result => { cache.setQueryData(['comparison', result.id], result); navigate('/app/compare/' + result.id) },
    onSettled: () => { void cache.invalidateQueries({ queryKey: ['comparisons'] }); void cache.invalidateQueries({ queryKey: ['summary'] }) },
  })
  const remove = useMutation({ mutationFn: () => api('/comparisons/' + id, { method: 'DELETE' }), onSuccess: () => {
    void cache.invalidateQueries({ queryKey: ['comparisons'] }); void cache.invalidateQueries({ queryKey: ['exports'] })
    setDeleting(false); navigate('/app/compare'); notify('Сравнение удалено')
  }, onError: error => notify(error.message, true) })
  const item = record.data
  const needConsent = summarize && summary.data?.ai.external
  return <div className="screen">
    <div className="page-heading"><div><h1>Сравнение</h1><p>Текстовые изменения между двумя версиями файла.</p></div></div>
    <div className="workbench-grid">
      <aside>
        {!user?.read_only && <section className="panel"><div className="panel-heading"><h2><GitCompareArrows size={18} /> Выбор версий</h2></div>
          <form className="form panel-form" onSubmit={e => { e.preventDefault(); start.mutate() }}>
            <DocumentSelect title="Исходная версия" docs={ready} value={before} onChange={setBefore} />
            <DocumentSelect title="Новая версия" docs={ready} value={after} onChange={setAfter} />
            <label className="checkbox-label"><input type="checkbox" checked={summarize} onChange={e => setSummarize(e.target.checked)} /> Добавить AI-резюме</label>
            {needConsent && <label className="checkbox-label"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
              Разрешаю передать отличия внешнему AI-провайдеру.</label>}
            {docs.error && <ErrorNotice message={docs.error.message} />}{start.error && <ErrorNotice message={start.error.message} />}
            <Button variant="primary" disabled={!before || !after || before === after || start.isPending || Boolean(needConsent && !consent)}>
              {start.isPending ? <Spinner /> : <GitCompareArrows size={16} />} Сравнить версии</Button>
          </form></section>}
        <section className="panel"><div className="panel-heading"><h2>История сравнений</h2></div>
          {list.isLoading && <Skeleton count={2} />}{list.error && <ErrorNotice message={list.error.message} />}
          {!list.isLoading && !list.data?.length && <p className="sidebar-empty">Сравнений пока нет</p>}
          <div className="workbench-history">{list.data?.map(entry => <Link key={entry.id} to={'/app/compare/' + entry.id}
            aria-current={entry.id === id ? 'page' : undefined}><strong>{entry.before_name}</strong><small>Новая версия · {entry.after_name}</small></Link>)}</div></section>
      </aside>
      <section className="panel workbench-result">
        {record.isLoading && <Skeleton count={4} />}{record.error && <ErrorNotice message={record.error.message} />}
        {!id && <Empty icon={<GitCompareArrows size={25} />} title="Здесь появится сравнение" body="Выберите два обработанных документа." />}
        {item && <><div className="panel-heading result-heading"><div><h2>Изменения в тексте</h2><p>{formatDate(item.created_at)}</p></div>
          {!user?.read_only && <div className="actions"><Button size="sm" onClick={() => setExporting(true)}><Download size={16} /> Экспорт</Button>
            <Button size="icon" variant="ghost" aria-label="Удалить сравнение" onClick={() => setDeleting(true)}><Trash2 size={16} /></Button></div>}</div>
          <div className="workbench-body">
            <div className="diff-counts">{Object.entries(changes).map(([kind, label]) =>
              <span key={kind} className={'diff-' + kind}>{label} {item.result.counts[kind as keyof typeof changes]}</span>)}</div>
            {item.result.summary && <><h3>AI-резюме</h3><p className="pre-wrap">{item.result.summary}</p><LegalNote /></>}
            {'summary_error' in item.result && <ErrorNotice message={String(item.result.summary_error)} />}
            <div className="diff-versions"><Link to={'/app/documents/' + item.before_id}>Исходная версия<small>{item.before_name}</small></Link>
              <Link to={'/app/documents/' + item.after_id}>Новая версия<small>{item.after_name}</small></Link></div>
            {item.result.items.length === 0 ? <Empty title="Текст совпадает" body="В извлечённом тексте различий не обнаружено." />
              : <div className="diff-grid">{item.result.items.map((change, i) => <div className="diff-row" key={i}>
                <div className={change.before_line ? 'diff-' + change.kind : ''}>{change.before_line && <small>Строка {change.before_line}</small>}
                  <p>{change.before || '—'}</p></div><div className={change.after_line ? 'diff-' + change.kind : ''}>
                  {change.after_line && <small>Строка {change.after_line}</small>}<p>{change.after || '—'}</p></div></div>)}</div>}
          </div></>}
      </section>
    </div>
    {id && exporting && <ExportDialog kind="comparison" id={id} onClose={() => setExporting(false)} />}
    <Confirm open={deleting} title="Удалить сравнение?" description="Сравнение и связанные отчёты будут удалены." busy={remove.isPending}
      onClose={() => setDeleting(false)} onConfirm={() => remove.mutate()} />
  </div>
}

export function ReportsPage() {
  const data = useQuery({ queryKey: ['exports'], queryFn: () => api<Export[]>('/exports') })
  const { notify } = useUI()
  const [busy, setBusy] = useState<string | null>(null)
  async function save(item: Export) {
    setBusy(item.id)
    try { await download('/exports/' + item.id + '/download', 'DocuMind — ' + item.title + '.' + item.format) }
    catch (error) { notify(errorMessage(error), true) }
    finally { setBusy(null) }
  }
  return <div className="screen">
    <div className="page-heading"><div><h1>Отчёты</h1><p>Экспортированные результаты анализа и сравнения.</p></div></div>
    <section className="panel">
      {data.isLoading && <Skeleton />}{data.error && <ErrorNotice message={data.error.message} retry={() => data.refetch()} />}
      {data.data?.length === 0 && <Empty icon={<FileBarChart2 size={25} />} title="Отчётов пока нет"
        body="Откройте результат анализа или сравнения и нажмите «Экспорт»."
        action={<Button asChild size="sm"><Link to="/app/analysis">Открыть анализ</Link></Button>} />}
      {data.data?.map(item => <div className="report-row" key={item.id}><span className="feature-icon"><FileText size={18} /></span>
        <div><strong>{item.title}</strong><small>{item.format.toUpperCase()} · {formatDate(item.created_at)}</small></div>
        <Button onClick={() => void save(item)} size="sm" disabled={busy !== null}>
          {busy === item.id ? <Spinner /> : <Download size={15} />} Скачать</Button></div>)}
    </section>
  </div>
}
