
import assert from 'node:assert/strict'
import { log } from 'node:console'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { chromium } from '@playwright/test'

const baseURL = process.env.DOCUMIND_URL ?? 'http://localhost:8080'
const fixture = process.env.DOCUMIND_PORTFOLIO_PDF
if (!fixture) throw new Error('Set DOCUMIND_PORTFOLIO_PDF to a generated PDF from the fictional demo data.')
const screenshots = fileURLToPath(new URL('../../docs/screenshots/', import.meta.url))
const frames = process.env.DOCUMIND_PORTFOLIO_FRAMES ?? await mkdtemp(join(tmpdir(), 'documind-capture-'))
await mkdir(screenshots, { recursive: true })
await mkdir(frames, { recursive: true })

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const shot = async name => {
    await page.evaluate(() => globalThis.document.fonts.ready)
    await page.screenshot({ path: join(screenshots, name + '.png') })
  }
  const frame = name => page.screenshot({ path: join(frames, name + '.png') })
  const name = 'Учебный договор.pdf'

  await page.goto('/')
  await page.locator('.hero-image').evaluate(img => img.decode())
  await shot('landing')
  await page.locator('.hero-source-link').click()
  await page.locator('#example [data-highlighted="true"]').waitFor()
  await page.locator('#example').screenshot({ path: join(screenshots, 'example.png') })

  await page.goto('/register')
  await page.getByLabel('Имя', { exact: true }).fill('Демо-библиотека')
  await page.getByLabel('Email', { exact: true }).fill('portfolio-' + randomUUID().slice(0, 8) + '@example.com')
  await page.getByLabel('Пароль', { exact: true }).fill(randomUUID())
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByRole('link', { name: 'Загрузить документы' }).click()
  await frame('01-upload')
  await page.getByLabel('Файлы документов').setInputFiles([
    { name, mimeType: 'application/pdf', buffer: await readFile(fixture) },
    { name: 'Учебный договор — версия 2.txt', mimeType: 'text/plain',
      buffer: await readFile(new URL('../../backend/demo/contract-v2.txt', import.meta.url)) },
    { name: 'Коммерческое предложение.md', mimeType: 'text/markdown',
      buffer: await readFile(new URL('../../backend/demo/proposal.md', import.meta.url)) },
  ])
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  const docRow = page.getByRole('row').filter({ hasText: name })
  await docRow.getByText('Готов', { exact: true }).waitFor({ timeout: 60000 })
  await shot('library')
  await frame('02-library')
  await docRow.locator('.file-link').click()
  const canvas = page.locator('.react-pdf__Page canvas')
  await canvas.waitFor({ timeout: 20000 })
  await page.locator('.react-pdf__Page__textContent span').first().waitFor({ timeout: 20000 })
  await shot('pdf-preview')
  await frame('03-document')
  await page.getByRole('link', { name: 'Задать вопрос' }).click()
  await page.getByRole('button', { name: 'Создать чат' }).click()
  await page.getByRole('textbox', { name: 'Вопрос по документам' }).fill('Какой срок оплаты по договору в рабочих днях?')
  await page.getByRole('button', { name: 'Отправить вопрос' }).click()
  const answer = page.locator('.assistant-content .markdown')
  await answer.waitFor({ timeout: 90000 })
  assert.match(await answer.innerText(), /10|десять/i)
  await page.getByRole('button', { name: /Источник 1, Страница 1/ }).click({ timeout: 90000 })
  const quote = page.locator('.chat-source blockquote')
  await quote.waitFor()
  assert.match(await quote.innerText(), /10 рабочих дней/)
  await shot('chat-source')
  await frame('04-source')
  await page.getByRole('navigation', { name: 'Рабочее пространство' }).getByRole('link', { name: 'Обзор' }).click()
  await page.locator('.stat').first().waitFor()
  await shot('dashboard')
  assert.deepEqual(errors, [])

  const mobile = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 },
    isMobile: true, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  await mobile.goto('/')
  await mobile.locator('.hero-image').evaluate(img => img.decode())
  await mobile.evaluate(() => globalThis.document.fonts.ready)
  await mobile.screenshot({ path: join(screenshots, 'mobile.png') })
  log('Captured live frontend, real source, and PDF preview.')
  log('GIF frames: ' + frames)
} finally {
  await browser.close()
}
