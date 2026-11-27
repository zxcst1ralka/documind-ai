
import { BookOpen, FileText, Quote, Sparkles } from 'lucide-react'
import { Button } from './ui'

const clauses = [
  { tab: 'Срок оплаты', section: '3.1', title: 'Порядок расчётов', question: 'Когда нужно оплатить услуги?',
    answer: 'В течение 10 рабочих дней после подписания акта.',
    quote: 'Заказчик оплачивает услуги в течение 10 рабочих дней после подписания акта.' },
  { tab: 'Стоимость', section: '3.2', title: 'Стоимость услуг', question: 'Сколько стоят услуги по договору?',
    answer: '120 000 рублей за весь объём работ.',
    quote: 'Стоимость полного объёма услуг по договору составляет 120 000 рублей.' },
  { tab: 'Сдача работы', section: '4.1', title: 'Передача результата', question: 'Когда исполнитель должен сдать работу?',
    answer: 'До 15 декабря 2026 года.',
    quote: 'Исполнитель передаёт комплект печатных макетов до 15 декабря 2026 года.' },
]

export default function DocumentExample({ selected, revealed, onSelect, onReveal }: {
  selected: number; revealed: boolean; onSelect: (index: number) => void; onReveal: (value: boolean) => void
}) {
  const active = clauses[selected]
  return <section id="example" className="landing-wrap example-section">
    <div className="section-label"><BookOpen size={17} /> Интерактивный пример</div>
    <div className="example-intro"><h2>От вопроса к <em>конкретной строке</em></h2>
      <p>Выберите вопрос и откройте источник в вымышленном договоре.</p></div>
    <div className="example-grid">
      <div className="example-console">
        <div className="example-caption">Вопросы по договору</div>
        <div className="example-choices" role="group" aria-label="Вопросы по договору">{clauses.map((clause, index) =>
          <button type="button" key={clause.section} aria-pressed={selected === index}
            onClick={() => onSelect(index)}>{clause.tab}</button>)}</div>
      </div>
      <div className="example-reply" aria-live="polite">
        <div className="example-caption"><Sparkles size={17} /> Ответ по документу</div>
        <p>{active.question}</p><strong>{active.answer}</strong>
        <Button className="example-citation" variant="ghost" onClick={() => onReveal(!revealed)}
          aria-controls="example-document" aria-pressed={revealed}>
          <Quote size={16} /> {revealed ? 'Скрыть подсветку' : 'Показать источник'} · п. {active.section}
        </Button>
      </div>
      <div className="example-document" id="example-document">
        <div className="example-doc-title"><FileText size={17} /> Договор оказания услуг <span>Вымышленный</span></div>
        <div className="example-paper">
          {clauses.map((clause, index) => <div className="example-clause" key={clause.section}
            data-highlighted={revealed && selected === index}>
            <span aria-hidden="true">{clause.section}</span><div><h3>{clause.title}</h3><p>{clause.quote}</p></div>
          </div>)}
        </div>
      </div>
    </div>
  </section>
}
