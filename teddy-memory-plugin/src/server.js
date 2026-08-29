import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { createPluginToolHandlers } from './tool-handlers.js';
import { READ_ONLY_ANNOTATIONS } from './tool-contracts.js';

const keywordSchema = z.array(z.string().trim().min(1).max(80)).min(1).max(8).optional();

const contextSchema = z.object({
  query: z.string().trim().min(1).max(300).optional(),
  keywords: keywordSchema,
  limit: z.number().int().min(1).max(12).default(6),
}).refine((value) => Boolean(value.query || value.keywords?.length), {
  message: 'Provide query or keywords',
});

const searchSchema = z.object({
  query: z.string().trim().min(1).max(300).optional(),
  keywords: keywordSchema,
  limit: z.number().int().min(1).max(20).default(8),
}).refine((value) => Boolean(value.query || value.keywords?.length), {
  message: 'Provide query or keywords',
});

const memoryItemSchema = z.object({
  memory_ref: z.string().regex(/^mem_[0-9a-f]{32}$/),
});

export function createTeddyMemoryPluginServer(repository, ownerId) {
  const server = new McpServer({
    name: 'teddy-memory-plugin',
    version: '0.1.0',
  });
  const handlers = createPluginToolHandlers(repository, ownerId);

  server.registerTool(
    'get_context',
    {
      title: 'Get Teddy Memory Context',
      description: 'Retrieve a small set of safe historical memories relevant to the current question. Historical memory may be stale; current user input and current evidence override it when they conflict.',
      inputSchema: contextSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handlers.get_context,
  );

  server.registerTool(
    'search_memory',
    {
      title: 'Search Teddy Memory',
      description: 'Discover safe historical memories by topic or keywords. Results are historical context, not current truth; current evidence and user instructions take priority.',
      inputSchema: searchSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handlers.search_memory,
  );

  server.registerTool(
    'get_memory_item',
    {
      title: 'Get Teddy Memory Item',
      description: 'Read one safe historical memory previously located by search or context using its opaque memory_ref. Historical content can be outdated and must yield to current evidence.',
      inputSchema: memoryItemSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handlers.get_memory_item,
  );

  return server;
}
