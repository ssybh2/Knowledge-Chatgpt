import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { readConfig } from './config.js';
import { createMemoryClient } from './memory-client.js';
import { createTeddyMemoryServer } from './server.js';

const config = readConfig(process.env);

void serveStdio(() => {
  const client = createMemoryClient(config);
  return createTeddyMemoryServer(client);
});

console.error('Teddy Memory MCP server running on stdio');
