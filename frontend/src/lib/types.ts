
export type User = { id: string; email: string; name: string; read_only: boolean }
export type AuthResult = { access_token: string; user: User }
export type DocStatus = 'uploaded' | 'queued' | 'processing' | 'ready' | 'failed'

export type Doc = {
  id: string
  name: string
  original_name: string
  extension: string
  mime: string
  size: number
  status: DocStatus
  error: string | null
  category: string | null
  tags: string[]
  sha256: string
  page_count: number | null
  ocr_page_count: number
  created_at: string
  updated_at: string
}

export type Chat = { id: string; title: string; created_at: string; document_ids?: string[] }
export type Source = {
  id: string; document_id: string; name: string; location: string; page: number | null; number?: number
}
export type Fragment = Source & { text: string }
export type Message = {
  id: string; role: 'user' | 'assistant'; content: string; created_at: string; sources: Source[]
}
export type Summary = {
  documents: number; ready: number; storage: number; requests: number; daily_requests: number
  activity: { day: string; requests: number; documents: number }[]
  recent_documents: Doc[]
  recent_chats: Chat[]
  ai: { available: boolean; provider: string; model: string; external: boolean }
  limits: { max_documents: number; max_storage_mb: number; max_file_mb: number; max_ai_daily: number; max_jobs: number }
}

export type Finding = { title: string; detail: string; sources: number[] }
export type Risk = { title: string; detail: string; level: 'low' | 'medium' | 'high'; sources: number[] }
export type Analysis = {
  id: string; document_id: string; document_name: string; mode: string; created_at: string
  result: { summary: string; findings: Finding[]; contract: Record<string, string | string[] | Risk[] | null> | null;
    sources: Source[] }
}
export type DiffItem = { kind: 'added' | 'removed' | 'changed'; before: string; after: string;
  before_line: number | null; after_line: number | null }
export type Comparison = {
  id: string; before_id: string; after_id: string; before_name: string; after_name: string; created_at: string
  result: { items: DiffItem[]; counts: Record<DiffItem['kind'], number>; summary: string | null }
}
export type Export = { id: string; title: string; format: string; created_at: string }
