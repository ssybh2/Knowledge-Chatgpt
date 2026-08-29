import { createMcpHandler } from '@modelcontextprotocol/server';

import { createTeddyMemoryPluginServer } from './server.js';

export function createPluginMcpHandler(repository, ownerId) {
  if (!repository) {
    throw new TypeError('repository is required');
  }
  if (typeof ownerId !== 'string' || !ownerId.trim()) {
    throw new TypeError('ownerId is required');
  }

  return createMcpHandler(
    () => createTeddyMemoryPluginServer(repository, ownerId.trim()),
    {
      responseMode: 'auto',
      legacy: 'stateless',
    },
  );
}
