function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

export function createWorkerFetch() {
  return async function fetchWorker(request) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return jsonResponse({ ok: true, service: 'teddy-memory-plugin' });
    }

    return jsonResponse({ error: 'not_found' }, 404);
  };
}

const fetchWorker = createWorkerFetch();

export default {
  fetch(request, env, ctx) {
    return fetchWorker(request, env, ctx);
  },
};
