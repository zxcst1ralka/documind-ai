
export function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' Б'
  return new Intl.NumberFormat('ru', { maximumFractionDigits: 1 }).format(
    bytes / (bytes < 1024 ** 2 ? 1024 : 1024 ** 2)) + (bytes < 1024 ** 2 ? ' КБ' : ' МБ')
}
export const formatDate = (date: string) =>
  new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date))
export const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('ru', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(date))
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Произошла ошибка.'
export const analysisModes: Record<string, string> = {
  short: 'Краткое резюме', detailed: 'Подробное резюме', points: 'Ключевые тезисы',
  entities: 'Извлечение сущностей', dates: 'Даты и сроки', amounts: 'Денежные суммы',
  contract: 'Анализ договора', custom: 'Пользовательский запрос',
}
