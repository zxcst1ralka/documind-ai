
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import { Button, ErrorNotice, Skeleton } from './ui'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
const options = { isEvalSupported: false, disableFontFace: false }

export default function PdfPreview({ file, page, setPage }: { file: string; page: number; setPage: (n: number) => void }) {
  const [count, setCount] = useState(0)
  const [width, setWidth] = useState(560)
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = container.current
    if (!node) return
    const observer = new ResizeObserver(([event]) => setWidth(Math.max(160, Math.min(850, Math.floor(event.contentRect.width) - 20))))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const active = count ? Math.min(count, page) : page
  return <div className="pdf-shell" ref={container}>
    <div className="pdf-actions"><FileText size={16} /><span>Страница {active}{count > 0 && ' из ' + count}</span>
      <Button size="icon" variant="ghost" aria-label="Предыдущая страница" disabled={active <= 1} onClick={() => setPage(active - 1)}>
        <ChevronLeft size={17} /></Button>
      <Button size="icon" variant="ghost" aria-label="Следующая страница" disabled={active >= count} onClick={() => setPage(active + 1)}>
        <ChevronRight size={17} /></Button></div>
    <Document file={file} options={options} loading={<Skeleton />} onLoadSuccess={pdf => setCount(pdf.numPages)}
      error={<ErrorNotice message="Не удалось открыть PDF. Скачайте оригинал, чтобы проверить файл." />}>
      {count > 0 && <Page pageNumber={active} width={width} renderAnnotationLayer={false} loading={<Skeleton />} />}
    </Document>
  </div>
}
