import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { createToolHandlers } from './tool-handlers.js';
import { READ_ONLY_ANNOTATIONS } from './tool-contracts.js';

const keywordSchema = z.array(z.string().trim().min(1)).min(1).max(8).optional();

const searchSchema = z.object({
  query: z.string().trim().min(1).optional(),
  keywords: keywordSchema,
  limit: z.number().int().min(1).max(20).default(8),
}).refine((value) => Boolean(value.query || value.keywords?.length), {
  message: 'Provide query or keywords',
});

const contextSchema = z.object({
  query: z.string().trim().min(1).optional(),
  keywords: keywordSchema,
  max_conversations: z.number().int().min(1).max(6).default(4),
  before: z.number().int().min(0).max(5).default(2),
  after: z.number().int().min(0).max(8).default(3),
}).refine((value) => Boolean(value.query || value.keywords?.length), {
  message: 'Provide query or keywords',
});

const conversationSchema = z.object({
  conversation_id: z.string().trim().min(1),
  limit: z.number().int().min(1).max(200).default(120),
  offset: z.number().int().min(0).default(0),
});

export function createTeddyMemoryServer(client) {
  const server = new McpServer({
    name: 'teddy-memory',
    version: '0.1.0',
  });
  const handlers = createToolHandlers(client);

  server.registerTool(
    'get_context',
    {
      title: 'Get Teddy Memory Context',
      description: 'Preferred tool for questions that depend on the user\'s prior conversations, project history, old decisions, parameters, or earlier plans. Returns relevant historical messages with nearby context. Current evidence should override old memory when they conflict.',
      inputSchema: contextSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handlers.get_context,
  );

  server.registerTool(
    'search_memory',
    {
      title: 'Search Teddy Memory',
      description: 'Search historical ChatGPT messages when you need to discover where a topic, component, repository, parameter, person, or project was discussed. For Chinese or mixed-language requests, provide concrete keywords when possible.',
      inputSchema: searchSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handlers.search_memory,
  );

  server.registerTool(
    'get_conversation',
    {
      title: 'Get Historical Conversation',
      description: 'Read one historical conversation in chronological order after search_memory or get_context returns a conversation_id. Use only when exact prior dialogue or chronology is needed.',
      inputSchema: conversationSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handlers.get_conversation,
  );

  return server;
}
