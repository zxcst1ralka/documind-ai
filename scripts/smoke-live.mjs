
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const endpoint = process.env.DOCUMIND_URL ?? 'http://localhost:8080'
const session = { access: '', refresh: '' }

async function request(path, init = {}) {
  const headers = new Headers({ 'X-DocuMind-Client': 'web' })
  if (session.access) headers.set('Authorization', 'Bearer ' + session.access)
  if (session.refresh) headers.set('Cookie', session.refresh)
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json')
  const response = await fetch(endpoint + '/api/v1' + path, { ...init, headers, signal: AbortSignal.timeout(160_000) })
  if (response.headers.has('set-cookie')) session.refresh = response.headers.get('set-cookie').split(';')[0]
  assert(response.ok, path + ' → ' + response.status + ' ' + (response.ok ? '' : await response.text()))
  return response
}

async function data(path, input) {
  const init = input === undefined ? {} : { method: 'POST', body: JSON.stringify(input) }
  return (await request(path, init)).json()
}

let docId
const scanned = process.env.DOCUMIND_SMOKE_OCR === '1'
try {
  const result = await data('/auth/register', { email: 'live-smoke-' + randomUUID() + '@example.com',
    name: 'Локальная проверка', password: randomUUID() })
  session.access = result.access_token
  const summary = await data('/dashboard/summary')
  assert(summary.ai.available && ['ollama', 'openai'].includes(summary.ai.provider), 'Configure a real AI provider first')
  if (summary.ai.external && process.env.DOCUMIND_SMOKE_EXTERNAL !== '1') {
    throw new Error('DOCUMIND_SMOKE_EXTERNAL=1 is required to send the synthetic fixture to an external provider')
  }
  const text = 'Учебный договор. Срок оплаты по договору составляет 10 рабочих дней после подписания акта.'
  const file = new FormData()
  if (scanned) {
    const scan = await readFile(new URL('../backend/tests/fixtures/scanned-contract.pdf', import.meta.url))
    file.set('file', new Blob([scan], { type: 'application/pdf' }), 'Демо — Проверка OCR.pdf')
  } else {
    file.set('file', new Blob([text], { type: 'text/plain' }), 'Демо — Проверка RAG.txt')
  }
  const document = await (await request('/documents', { method: 'POST', body: file })).json()
  docId = document.id
  const docPath = '/documents/' + docId
  for (let count = 0; count < 120; count++) {
    const state = await data(docPath)
    assert(state.status !== 'failed', state.error || 'Document processing failed')
    if (state.status === 'ready') {
      if (scanned) assert.equal(state.ocr_page_count, 1)
      break
    }
    if (count === 119) throw new Error('Document processing timed out')
    await sleep(1000)
  }
  const chat = await data('/chats', { document_ids: [docId], title: 'Проверка реальной модели' })
  const messages = '/chats/' + chat.id + '/messages'
  const stream = await (await request(messages, { method: 'POST', body: JSON.stringify({
    question: 'Какой срок оплаты по договору в рабочих днях?', consent: summary.ai.external,
  }) })).text()
  const frames = stream.split('\n\n')
  const final = frames.find(frame => frame.startsWith('event: done\n'))
  assert(final, 'The provider did not complete the SSE stream: ' + stream)
  const answer = JSON.parse(final.split('\n')[1].slice(6))
  assert(answer.content.match(/10|десять/i), 'The answer does not state the correct payment term: ' + stream)
  assert(answer.sources[0]?.document_id === docId, 'No persisted citation for the uploaded document')
  const fragment = await data(docPath + '/sources/' + answer.sources[0].id)
  if (scanned) {
    assert.match(fragment.text, /10 рабочих дней/)
    assert.equal(fragment.page, 1)
    assert.equal(fragment.location, 'Страница 1 · OCR')
  } else {
    assert.equal(fragment.text, text)
  }
  const history = await data(messages)
  assert.equal(history.at(-1)?.id, answer.id)
  console.log('Real model, indexing, SSE, persisted source and history verified (' + summary.ai.model + ').')
  console.log('Answer: ' + answer.content + ' · ' + fragment.location)
  if (process.env.DOCUMIND_SMOKE_ANALYSIS === '1') {
    const analysis = await data('/analyses', { document_id: docId, mode: 'short', consent: summary.ai.external })
    const details = [analysis.result.summary, ...analysis.result.findings.map(item => item.detail)].join(' ')
    assert(/10|десять/i.test(details), 'The real provider did not extract the payment term: ' + details)
    console.log('Validated analysis: ' + analysis.result.summary)
  }
  if (process.env.DOCUMIND_SMOKE_CONTRACT === '1') {
    const analysis = await data('/analyses', { document_id: docId, mode: 'contract', consent: summary.ai.external })
    assert(analysis.result.contract, 'The provider did not return structured contract analysis')
    const extracted = [analysis.result.summary, analysis.result.contract.payment,
      ...analysis.result.findings.map(item => item.detail)].join(' ')
    assert.match(extracted, /10|десять/i)
    assert(analysis.result.sources.some(source => source.document_id === docId), 'No verified contract analysis source')
    console.log('Structured contract analysis and its source verified.')
  }
} finally {
  if (docId) await request('/documents/' + docId, { method: 'DELETE' })
  if (session.access) await request('/auth/logout', { method: 'POST' })
}
