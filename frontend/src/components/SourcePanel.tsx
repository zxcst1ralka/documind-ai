
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ExternalLink } from 'lucide-react'
import { Link } from 'react-router'
import { api } from '../lib/api'
import type { Fragment, Source } from '../lib/types'
import { Button, Empty, ErrorNotice, Modal, Skeleton } from './ui'

export function SourceContent({ source }: { source: Source | null }) {
  const item = useQuery({
    queryKey: ['source', source?.document_id, source?.id],
    queryFn: () => api<Fragment>('/documents/' + source?.document_id + '/sources/' + source?.id),
    enabled: Boolean(source),
  })
  if (!source) return <Empty icon={<BookOpen size={24} />} title="Откройте источник"
    body="Выберите ссылку в ответе, чтобы прочитать фрагмент документа." />
  if (item.isLoading) return <Skeleton />
  if (!item.data || item.error) return <ErrorNotice message={item.error?.message ?? 'Источник недоступен.'} />
  return <div className="source-content">
    <span className="eyebrow">{item.data.location}</span><h3>{item.data.name}</h3>
    <blockquote>{item.data.text}</blockquote>
    <Button asChild size="sm"><Link to={'/app/documents/' + source.document_id +
      (source.page ? '?page=' + source.page : '')}><ExternalLink size={15} /> Открыть документ</Link></Button>
  </div>
}
export function SourceDialog({ source, onClose }: { source: Source | null; onClose: () => void }) {
  return <Modal wide title="Источник" description="Фрагмент загруженного документа" open={Boolean(source)}
    onOpenChange={open => { if (!open) onClose() }}><SourceContent source={source} /></Modal>
}
