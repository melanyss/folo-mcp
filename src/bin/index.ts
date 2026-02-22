import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { sendApiQuery } from '../api'
import { tools } from '../tools'

const LAST_7_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function withToolDefaults(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  if (toolName !== 'entry_list')
    return args

  if (typeof args.publishedAfter === 'string')
    return args

  return {
    ...args,
    publishedAfter: new Date(Date.now() - LAST_7_DAYS_MS).toISOString(),
  }
}

const server = new McpServer({
  name: 'folo-mcp',
  version: '1.0.0',
})

for (const tool of Object.keys(tools)) {
  const { name, description, input, query } = tools[tool as keyof typeof tools]
  server.tool(
    name,
    description,
    input,
    async (args: Record<string, unknown> | undefined) => sendApiQuery({
      ...query,
      args: withToolDefaults(name, args ?? {}),
    }),
  )
}

const transport = new StdioServerTransport()
await server.connect(transport)
