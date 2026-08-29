import { readConfig } from './config.js';
import { createTeddyMemoryHttpHandler } from './http-handler.js';
import { createMemoryClient } from './memory-client.js';
import { createRemoteMcpFetch } from './remote-http.js';

function safeStartupError() {
  return new Response(JSON.stringify({ error: 'Remote MCP startup failed' }), {
    status: 500,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function backendServiceFetch(env) {
  const service = env.TEDDY_MEMORY_API;
  if (!service || typeof service.fetch !== 'function') {
    throw new Error('TEDDY_MEMORY_API service binding is required');
  }
  return service.fetch.bind(service);
}

export function createWorkerFetch({
  createClient = createMemoryClient,
  createHttpHandler = createTeddyMemoryHttpHandler,
} = {}) {
  if (typeof createClient !== 'function') {
    throw new TypeError('createClient must be a function');
  }
  if (typeof createHttpHandler !== 'function') {
    throw new TypeError('createHttpHandler must be a function');
  }

  return async function fetchWorker(request, env = {}) {
    const remoteFetch = createRemoteMcpFetch({
      env,
      mcpFetch: async (incoming) => {
        try {
          const config = {
            ...readConfig(env),
            fetchImpl: backendServiceFetch(env),
          };
          const client = createClient(config);
          const handler = createHttpHandler(client);
          return handler.fetch(incoming);
        } catch {
          return safeStartupError();
        }
      },
    });

    return remoteFetch(request);
  };
}

const fetchWorker = createWorkerFetch();

export default {
  fetch(request, env) {
    return fetchWorker(request, env);
  },
};
