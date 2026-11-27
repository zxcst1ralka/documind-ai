
import { Activity, ArrowUpRight, CircleCheck, FileText, GitCompareArrows, HardDrive, MessageSquareText, ScanLine, Upload } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router'
import { Badge, Button, Empty, ErrorNotice, FileIcon, Skeleton } from '../components/ui'
import { useSummary } from '../components/Workspace'
import { dayLabel, formatBytes, formatDate } from '../lib/format'
import { useSession } from '../lib/session'

export default function Dashboard() {
  const { user } = useSession()
  const summary = useSummary()
  const data = summary.data
  return <div className="screen dashboard">
    <section className="workspace-brief">
      <div className="page-heading"><div><span className="brief-label"><ScanLine size={16} /> Личная библиотека</span><h1>Обзор</h1>
        <p>Документы, диалоги и активность вашей библиотеки.</p></div></div>
      <div className="brief-actions">
        {!user?.read_only && <Button variant="primary" asChild><Link to="/app/documents?upload=1"><Upload size={17} /> Загрузить документы</Link></Button>}
        <Button asChild><Link to="/app/chat"><MessageSquareText size={16} /> Открыть AI-чат</Link></Button>
        <Button asChild variant="ghost"><Link to="/app/compare"><GitCompareArrows size={16} /> Сравнить версии</Link></Button>
      </div>
    </section>
    {summary.isLoading && <Skeleton count={5} />}
    {summary.error && <ErrorNotice message={summary.error.message} retry={() => summary.refetch()} />}
    {data && <>
      <div className="stats-grid">{[
        { title: 'Документы', value: data.documents, icon: FileText, detail: 'из ' + data.limits.max_documents + ' доступных' },
        { title: 'Обработано', value: data.ready, icon: CircleCheck, detail: 'готово к поиску' },
        { title: 'AI-запросы', value: data.requests, icon: MessageSquareText, detail: data.daily_requests + ' сегодня' },
        { title: 'Хранилище', value: formatBytes(data.storage), icon: HardDrive, detail: 'из ' + data.limits.max_storage_mb + ' МБ' },
      ].map(({ title, value, icon: Icon, detail }) => <article className="stat" key={title}>
        <div className="stat-top"><span>{title}</span><Icon size={17} /></div>
        <strong>{value}</strong><small>{detail}</small>
      </article>)}</div>
      <div className="overview-grid">
        <section className="panel"><div className="panel-heading"><div><h2><Activity size={18} /> Активность</h2><p>Последние 7 дней · UTC</p></div>
          <div className="chart-legend"><span>Документы</span><span>AI-запросы</span></div></div>
          <div className="chart" aria-label="График количества загрузок и AI-запросов">
            <ResponsiveContainer width="100%" height="100%"><AreaChart data={data.activity} margin={{ left: 0, right: 6, top: 12 }}>
              <defs><linearGradient id="chartVolume" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.27} /><stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
              </linearGradient></defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
              <XAxis dataKey="day" tickFormatter={dayLabel} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
              <YAxis width={22} allowDecimals={false} domain={[0, 'dataMax + 2']} tickLine={false} axisLine={false}
                tick={{ fill: 'var(--muted)', fontSize: 11 }} />
              <Tooltip labelFormatter={value => typeof value === 'string' ? dayLabel(value) : value}
                contentStyle={{ background: 'var(--surface)', borderColor: 'var(--border)', borderRadius: 8 }} />
              <Area name="Документы" type="monotone" dataKey="documents" stroke="var(--primary)" fill="url(#chartVolume)" strokeWidth={2} />
              <Area name="AI-запросы" type="monotone" dataKey="requests" stroke="var(--accent)" fill="transparent" strokeWidth={2} />
            </AreaChart></ResponsiveContainer>
          </div>
        </section>
        <section className="panel chat-card"><div className="panel-heading"><div><h2><MessageSquareText size={18} /> Последние чаты</h2>
          <p>Продолжите работу с источниками</p></div><Link to="/app/chat" aria-label="Все чаты"><ArrowUpRight size={18} /></Link></div>
          {data.recent_chats.length ? <div className="recent-chats">{data.recent_chats.map(chat =>
            <Link key={chat.id} to={'/app/chat/' + chat.id}><MessageSquareText size={16} /><span>{chat.title}</span>
              <small>{formatDate(chat.created_at)}</small></Link>)}</div> :
            <Empty icon={<MessageSquareText size={22} />} title="Здесь будут ваши чаты"
              body="Выберите готовый документ и задайте вопрос."
              action={<Button asChild size="sm"><Link to="/app/chat">Открыть AI-чат</Link></Button>} />}
        </section>
      </div>
      <section className="panel"><div className="panel-heading"><div><h2><FileText size={18} /> Последние документы</h2></div>
        <Button asChild variant="ghost" size="sm"><Link to="/app/documents">Вся библиотека <ArrowUpRight size={15} /></Link></Button></div>
        {data.recent_documents.length ? <div className="recent-docs">{data.recent_documents.map(doc =>
          <Link key={doc.id} to={'/app/documents/' + doc.id}><FileIcon extension={doc.extension} />
            <strong>{doc.name}</strong><small>{formatBytes(doc.size)}</small><Badge status={doc.status} /></Link>)}</div> :
          <Empty title="Библиотека пока пуста" body="Добавьте первый документ, чтобы начать поиск по его содержимому." />}
      </section>
    </>}
  </div>
}
