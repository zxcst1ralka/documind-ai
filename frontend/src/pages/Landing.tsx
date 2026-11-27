
import { BookOpen, Check, ChevronDown, FileCheck2, GitCompareArrows, LibraryBig, LockKeyhole,
  MessageSquareText, ScanLine, ScanSearch, ShieldCheck, Upload, Workflow } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import DocumentExample from '../components/DocumentExample'
import { Brand, Button, ThemeToggle } from '../components/ui'
import { useSession } from '../lib/session'
import './landing.css'

const features = [
  { icon: LibraryBig, title: 'Библиотека', body: 'Загружайте файлы, размечайте их тегами и быстро находите нужную версию.' },
  { icon: MessageSquareText, title: 'Диалоги с источниками', body: 'Задавайте вопросы по нескольким файлам и проверяйте ответы по первоисточнику.' },
  { icon: ScanSearch, title: 'Анализ и отчёты', body: 'Извлекайте сроки, суммы и спорные условия договора. Сохраняйте результаты в PDF, DOCX или Markdown.' },
  { icon: GitCompareArrows, title: 'Сравнение версий', body: 'Читайте добавленные, удалённые и изменённые фрагменты рядом.' },
]
const steps = [
  { icon: Upload, title: 'Загрузите документ', body: 'Выберите PDF, DOCX, TXT, Markdown, CSV или XLSX.' },
  { icon: MessageSquareText, title: 'Задайте вопрос', body: 'Выберите один или несколько файлов и начните чат.' },
  { icon: BookOpen, title: 'Откройте источник', body: 'Перейдите из ответа к странице или фрагменту текста.' },
]
const questions = [
  ['Какие файлы можно загрузить?', 'PDF, включая сканы, DOCX, TXT и Markdown в UTF-8, CSV и XLSX. Лимиты отображаются в кабинете.'],
  ['Приложение работает со сканами?', 'Да. По умолчанию OCR распознаёт печатный русский и английский текст на сканированных страницах PDF. Результат доступен на вкладке «Текст».'],
  ['Можно ли работать с локальной моделью?', 'Да. Владелец установки может подключить Ollama. Если используется внешний провайдер, интерфейс попросит подтвердить отправку контекста.'],
  ['Где проверить выводы AI?', 'В ответах доступны ссылки на использованные фрагменты. В договоре можно проверить формулировку и её место в исходном документе.'],
]

export default function Landing() {
  const { user } = useSession()
  const entry = user ? '/app' : '/register'
  const [selected, setSelected] = useState(0)
  const [revealed, setRevealed] = useState(false)
  return <div className="landing">
    <header className="landing-header"><div className="landing-wrap landing-header-row">
      <Brand />
      <nav aria-label="Разделы сайта"><a href="#example">Пример</a><a href="#features">Возможности</a><a href="#faq">Вопросы</a></nav>
      <div className="landing-actions"><ThemeToggle />
        {user ? <Button asChild variant="primary" size="sm"><Link to="/app">В кабинет</Link></Button> :
          <Button asChild variant="secondary" size="sm"><Link to="/login">Войти</Link></Button>}
      </div>
    </div></header>
    <main>
      <section className="hero"><div className="landing-wrap hero-grid">
        <div className="hero-content">
          <div className="section-label"><ScanLine size={18} /> AI для работы с документами</div>
          <h1>Ваши документы.<br /><em>Ваш искусственный интеллект</em></h1>
          <p>Задавайте вопросы по своим файлам, находите важные условия и открывайте точную цитату прямо из ответа.</p>
          <div className="hero-actions">
            <Button variant="primary" asChild><Link to={entry}>{user ? 'Открыть кабинет' : 'Создать аккаунт'}</Link></Button>
            <Button variant="ghost" asChild><a href="#example"><BookOpen size={17} /> Посмотреть пример</a></Button>
          </div>
        </div>
        <figure className="hero-art">
          <img className="hero-image" src="/document-optics.webp" width="1440" height="960" alt="" fetchPriority="high" />
          <a className="hero-source-link" href="#example" onClick={() => { setSelected(0); setRevealed(true) }}>
            <QuoteSymbol /><span><strong>10 рабочих дней</strong>
            <small>Договор оказания услуг · п. 3.1</small></span><ChevronDown size={17} /></a>
        </figure>
      </div></section>

      <DocumentExample selected={selected} revealed={revealed}
        onSelect={index => { setSelected(index); setRevealed(false) }} onReveal={setRevealed} />

      <section id="features" className="landing-wrap editorial-section">
        <div className="section-label"><LibraryBig size={17} /> Возможности</div>
        <div className="editorial-grid"><h2>Рабочее пространство для ваших файлов</h2>
          <div className="feature-list">{features.map(({ icon: Icon, title, body }) =>
            <article key={title}><Icon size={21} /><div><h3>{title}</h3><p>{body}</p></div></article>)}</div></div>
      </section>

      <section id="workflow" className="workflow"><div className="landing-wrap editorial-section">
        <div className="section-label"><Workflow size={17} /> Как это работает</div>
        <h2>Три шага до источника</h2>
        <ol className="workflow-grid">{steps.map(({ icon: Icon, title, body }) =>
          <li key={title}><Icon size={21} /><h3>{title}</h3><p>{body}</p></li>)}</ol>
      </div></section>

      <section className="landing-wrap editorial-section">
        <div className="section-label"><FileCheck2 size={17} /> Сценарии</div>
        <div className="editorial-grid"><h2>Когда важно свериться с текстом</h2>
          <div className="feature-list">
            <article><FileCheck2 size={21} /><div><h3>Согласование договора</h3><p>Найдите условия оплаты и сравните их с прошлой версией.</p></div></article>
            <article><Workflow size={21} /><div><h3>Внутренние инструкции</h3><p>Проверьте порядок действий по регламентам и руководствам.</p></div></article>
            <article><BookOpen size={21} /><div><h3>Учёба и исследования</h3><p>Соберите тезисы из нескольких источников и откройте нужные цитаты.</p></div></article>
          </div></div>
      </section>

      <section className="landing-wrap privacy"><div className="privacy-inner">
        <ShieldCheck size={31} />
        <div><h2>Ваши файлы остаются под вашим контролем</h2>
          <p>Оригиналы хранятся в закрытом хранилище. При работе с внешним AI-провайдером вы подтверждаете передачу контекста.</p></div>
        <ul><li><LockKeyhole size={16} /> Доступ по сессии</li><li><Check size={17} /> Поддержка локального AI</li></ul>
      </div></section>

      <section id="faq" className="landing-wrap editorial-section">
        <div className="editorial-grid faq"><h2>Частые вопросы</h2><div>
          {questions.map(([q, a]) => <details key={q}><summary>{q}<ChevronDown size={18} /></summary><p>{a}</p></details>)}
        </div></div>
      </section>
      <section className="landing-wrap end-cta"><h2>Начните со своего документа</h2>
        <Button asChild variant="primary"><Link to={entry}>{user ? 'Открыть кабинет' : 'Создать аккаунт'}</Link></Button></section>
    </main>
    <footer className="landing-footer"><div className="landing-wrap"><Brand /><span>Портфельный проект</span>
      <a href="/api/v1/docs">Документация API</a></div></footer>
  </div>
}

function QuoteSymbol() {
  return <span className="hero-quote-mark" aria-hidden="true">“</span>
}
