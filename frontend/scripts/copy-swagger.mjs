
import { copyFile, mkdir } from 'node:fs/promises'
import { URL } from 'node:url'

const relative = path => new URL('../' + path, import.meta.url)
await mkdir(relative('dist/swagger'), { recursive: true })
await Promise.all(['swagger-ui-bundle.js', 'swagger-ui.css'].map(file =>
  copyFile(relative('node_modules/swagger-ui-dist/' + file), relative('dist/swagger/' + file))))
