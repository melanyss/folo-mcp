import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { stringifyQuery } from 'ufo'

const DEFAULT_MAX_RESPONSE_CHARS = 200_000
const DEFAULT_MAX_ENTRY_CONTENT_CHARS = 8_000
const ENTRY_ARRAY_KEYS = ['entries', 'items', 'list'] as const
const ENTRY_PREVIEW_LIMIT = 10

type JsonRecord = Record<string, unknown>

function textResult(text: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getPositiveNumberEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value)
    return fallback

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function tryParseJson(input: string): unknown {
  if (!input.trim())
    return undefined

  try {
    return JSON.parse(input) as unknown
  }
  catch {
    return undefined
  }
}

function isAuthErrorPayload(payload: unknown): boolean {
  if (!isRecord(payload))
    return false

  const { code } = payload
  if (code === 401 || code === 403 || code === '401' || code === '403')
    return true

  const message = typeof payload.message === 'string' ? payload.message.toLowerCase() : ''
  return message.includes('unauthorized') || message.includes('forbidden') || message.includes('session')
}

function sessionExpiredResult(status?: number): CallToolResult {
  const statusText = status ? ` (HTTP ${status})` : ''
  return textResult(`Session expired or unauthorized${statusText}. Update FOLO_SESSION_TOKEN and retry.`)
}

function getErrorMessage(payload: unknown, rawBody: string, fallback: string): string {
  if (isRecord(payload) && typeof payload.message === 'string' && payload.message.trim())
    return payload.message

  const trimmed = rawBody.trim()
  if (!trimmed)
    return fallback

  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed
}

function truncateString(value: string, maxChars: number): { value: string, truncated: boolean } {
  if (value.length <= maxChars)
    return { value, truncated: false }

  const suffix = `\n\n[Truncated ${value.length - maxChars} characters]`
  return {
    value: `${value.slice(0, maxChars)}${suffix}`,
    truncated: true,
  }
}

function truncateEntry(entry: JsonRecord, maxEntryContentChars: number): { entry: JsonRecord, truncated: boolean } {
  let truncated = false
  const nextEntry: JsonRecord = { ...entry }

  const { content } = nextEntry
  if (typeof content === 'string') {
    const result = truncateString(content, maxEntryContentChars)
    if (result.truncated) {
      nextEntry.content = result.value
      truncated = true
    }
  }
  else if (isRecord(content)) {
    const nextContent: JsonRecord = { ...content }
    for (const key of ['html', 'text', 'content', 'value']) {
      const field = nextContent[key]
      if (typeof field === 'string') {
        const result = truncateString(field, maxEntryContentChars)
        if (result.truncated) {
          nextContent[key] = result.value
          truncated = true
        }
      }
    }
    if (truncated)
      nextEntry.content = nextContent
  }

  if (truncated)
    nextEntry._contentTruncated = true

  return { entry: nextEntry, truncated }
}

function extractEntries(data: unknown): unknown[] | null {
  if (Array.isArray(data))
    return data

  if (!isRecord(data))
    return null

  for (const key of ENTRY_ARRAY_KEYS) {
    const value = data[key]
    if (Array.isArray(value))
      return value
  }

  return null
}

function truncateEntryContentInData(data: unknown, maxEntryContentChars: number): { data: unknown, truncatedEntries: number } {
  const truncateEntries = (entries: unknown[]): { entries: unknown[], truncatedEntries: number } => {
    let truncatedEntries = 0
    const nextEntries = entries.map((entry) => {
      if (!isRecord(entry))
        return entry

      const result = truncateEntry(entry, maxEntryContentChars)
      if (result.truncated)
        truncatedEntries += 1
      return result.entry
    })

    return { entries: nextEntries, truncatedEntries }
  }

  if (Array.isArray(data)) {
    const result = truncateEntries(data)
    return {
      data: result.entries,
      truncatedEntries: result.truncatedEntries,
    }
  }

  if (!isRecord(data))
    return { data, truncatedEntries: 0 }

  for (const key of ENTRY_ARRAY_KEYS) {
    const value = data[key]
    if (Array.isArray(value)) {
      const result = truncateEntries(value)
      return {
        data: {
          ...data,
          [key]: result.entries,
        },
        truncatedEntries: result.truncatedEntries,
      }
    }
  }

  if ('content' in data) {
    const result = truncateEntry(data, maxEntryContentChars)
    return {
      data: result.entry,
      truncatedEntries: result.truncated ? 1 : 0,
    }
  }

  return { data, truncatedEntries: 0 }
}

function buildEntryPreview(entry: unknown): JsonRecord {
  if (!isRecord(entry))
    return { value: entry }

  const preview: JsonRecord = {}
  for (const key of ['id', 'title', 'url', 'publishedAt', 'feedId', 'read']) {
    const value = entry[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      preview[key] = value
  }

  if (Object.keys(preview).length === 0)
    preview._keys = Object.keys(entry).slice(0, 8)

  return preview
}

function formatPayload({
  args,
  data,
  path,
}: {
  args: Record<string, unknown>
  data: unknown
  path: string
}): string {
  const maxResponseChars = getPositiveNumberEnv('FOLO_MAX_RESPONSE_CHARS', DEFAULT_MAX_RESPONSE_CHARS)
  const maxEntryContentChars = getPositiveNumberEnv('FOLO_MAX_ENTRY_CONTENT_CHARS', DEFAULT_MAX_ENTRY_CONTENT_CHARS)

  let nextData = data
  let truncatedEntries = 0

  if (path === '/entries' && args.withContent === true) {
    const result = truncateEntryContentInData(data, maxEntryContentChars)
    nextData = result.data
    truncatedEntries = result.truncatedEntries
  }

  let payload = JSON.stringify(nextData, null, 2)
  if (payload.length <= maxResponseChars)
    return payload

  const entries = extractEntries(nextData)
  if (entries) {
    const summary = {
      truncated: true,
      reason: `Response exceeded FOLO_MAX_RESPONSE_CHARS (${maxResponseChars})`,
      totalEntries: entries.length,
      contentTruncatedEntries: truncatedEntries,
      entriesPreview: entries.slice(0, ENTRY_PREVIEW_LIMIT).map(entry => buildEntryPreview(entry)),
      hint: 'Use a smaller limit, narrower date range, or withContent: false.',
    }
    payload = JSON.stringify(summary, null, 2)
    if (payload.length <= maxResponseChars)
      return payload
  }

  return JSON.stringify(
    {
      truncated: true,
      reason: `Response exceeded FOLO_MAX_RESPONSE_CHARS (${maxResponseChars})`,
      hint: 'Reduce the query scope and retry.',
    },
    null,
    2,
  )
}

export async function sendApiQuery({
  args,
  path,
  method,
}: {
  args: Record<string, unknown>
  path: string
  method: string
}): Promise<CallToolResult> {
  const sessionToken = process.env.FOLO_SESSION_TOKEN
  if (!sessionToken) {
    return textResult('Without session token, I cannot access the data. Please provide it in the environment variable FOLO_SESSION_TOKEN.')
  }

  const queryString = method === 'GET' ? stringifyQuery(args as Parameters<typeof stringifyQuery>[0]) : ''
  const res = await fetch(
    `https://api.follow.is${path}${queryString ? `?${queryString}` : ''}`,
    {
      method,
      headers: {
        'cookie': `__Secure-better-auth.session_token=${sessionToken};`,
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        ...(method === 'POST'
          ? {
              'content-type': 'application/json',
            }
          : {}),
      },
      body: method === 'GET' ? undefined : JSON.stringify(args),
    },
  )
  const rawBody = await res.text()
  const payload = tryParseJson(rawBody)

  if (res.status === 401 || res.status === 403 || isAuthErrorPayload(payload))
    return sessionExpiredResult(res.status)

  if (!res.ok)
    throw new Error(`Error: ${getErrorMessage(payload, rawBody, `HTTP ${res.status}`)}`)

  if (isRecord(payload) && 'code' in payload) {
    const { code } = payload
    if (code !== 0 && code !== '0')
      throw new Error(`Error: ${getErrorMessage(payload, rawBody, 'Unknown API error')}`)

    return textResult(payload.data ? formatPayload({ args, data: payload.data, path }) : 'Success')
  }

  return textResult(payload ? formatPayload({ args, data: payload, path }) : 'Success')
}
