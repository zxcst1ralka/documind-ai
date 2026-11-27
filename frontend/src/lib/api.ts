
import type { AuthResult, Doc, Message } from './types'

const root = '/api/v1'
const commonHeaders = { 'X-DocuMind-Client': 'web' }
let access: string | null = null
let refreshing: Promise<AuthResult | null> | null = null

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function storeAccess(token: string | null) { access = token }

async function responseError(response: Response) {
  const body = await response.json().catch(() => null)
  const message = typeof body?.detail === 'string' ? body.detail
    : response.status === 413 ? 'Файл превышает допустимый размер.'
    : 'Запрос не выполнен. Повторите попытку.'
  return new ApiError(response.status, message)
}

async function refreshRequest() {
  const response = await fetch(root + '/auth/refresh', { method: 'POST', headers: commonHeaders })
  if (!response.ok) { storeAccess(null); return null }
  const result: AuthResult = await response.json()
  storeAccess(result.access_token)
  return result
}

export function refreshSession(): Promise<AuthResult | null> {
  refreshing ??= (async () => navigator.locks ? await navigator.locks.request('documind-refresh', refreshRequest)
    : await refreshRequest())()
    .finally(() => { refreshing = null })
  return refreshing
}

async function raw(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('X-DocuMind-Client', 'web')
  if (access) headers.set('Authorization', 'Bearer ' + access)
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json')
  const response = await fetch(root + path, { ...init, headers })
  if (response.status === 401 && retry && !['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'].includes(path)) {
    if (await refreshSession()) return raw(path, init, false)
    window.dispatchEvent(new Event('documind:expired'))
  }
  if (!response.ok) throw await responseError(response)
  return response
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const result = await raw(path, init)
  return result.status === 204 ? undefined as T : result.json()
}
export const json = (method: string, value: unknown): RequestInit => ({ method, body: JSON.stringify(value) })

export async function fileBlob(path: string) { return (await raw(path)).blob() }
export async function download(path: string, name: string) {
  const url = URL.createObjectURL(await fileBlob(path))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function xhrUpload(file: File, progress: (percent: number) => void): Promise<Doc> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', root + '/documents')
    xhr.setRequestHeader('X-DocuMind-Client', 'web')
    if (access) xhr.setRequestHeader('Authorization', 'Bearer ' + access)
    xhr.responseType = 'json'
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded * 100 / event.total)) }
    xhr.onerror = () => reject(new ApiError(0, 'Загрузка прервалась. Проверьте подключение.'))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response)
      else reject(new ApiError(xhr.status, xhr.response?.detail || (xhr.status === 413
        ? 'Файл превышает допустимый размер.' : 'Не удалось загрузить файл.')))
    }
    const body = new FormData()
    body.append('file', file)
    xhr.send(body)
  })
}

export async function uploadFile(file: File, progress: (percent: number) => void) {
  try { return await xhrUpload(file, progress) }
  catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error
    if (await refreshSession()) return xhrUpload(file, progress)
    window.dispatchEvent(new Event('documind:expired'))
    throw error
  }
}

export async function streamReply(id: string, payload: Record<string, unknown>, signal: AbortSignal,
  append: (text: string) => void): Promise<Message> {
  const response = await raw('/chats/' + id + '/messages', { ...json('POST', payload), signal })
  if (!response.body) throw new ApiError(500, 'Поток AI недоступен.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let end = buffer.indexOf('\n\n')
      while (end >= 0) {
        const frame = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        end = buffer.indexOf('\n\n')
        const lines = frame.split('\n')
        const kind = lines.find(line => line.startsWith('event: '))?.slice(7)
        const data = lines.find(line => line.startsWith('data: '))?.slice(6)
        if (!data) continue
        const body = JSON.parse(data)
        if (kind === 'delta') append(body.text)
        if (kind === 'done') return body
        if (kind === 'error') throw new ApiError(502, body.message)
      }
      if (done) throw new ApiError(502, 'Соединение с AI прервалось.')
    }
  } finally { await reader.cancel().catch(() => undefined) }
}
