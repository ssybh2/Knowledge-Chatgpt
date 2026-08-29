import { createMcpHandler } from '@modelcontextprotocol/server';

import { createTeddyMemoryServer } from './server.js';

export function createTeddyMemoryHttpHandler(client) {
  if (!client) {
    throw new TypeError('client is required');
  }

  return createMcpHandler(
    () => createTeddyMemoryServer(client),
    {
      responseMode: 'auto',
      legacy: 'stateless',
    },
  );
}
