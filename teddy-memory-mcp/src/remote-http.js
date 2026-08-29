function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function hostnameFromHostHeader(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    return end >= 0 ? text.slice(0, end + 1) : text;
  }
  return text.split(':', 1)[0];
}

function requestHostname(request) {
  const headerHost = hostnameFromHostHeader(request.headers.get('host'));
  if (headerHost) return headerHost;
  return new URL(request.url).hostname.toLowerCase();
}

function originHostname(request) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function safeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function bearerToken(request) {
  const authorization = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1].trim() : '';
}

export function createRemoteMcpFetch({ env = {}, mcpFetch } = {}) {
  if (typeof mcpFetch !== 'function') {
    throw new TypeError('mcpFetch must be a function');
  }

  return async function fetchRemote(request) {
    const url = new URL(request.url);

    if (url.pathname === '/healthz' && request.method === 'GET') {
      return json({
        ok: true,
        service: 'teddy-memory-mcp',
        transport: 'streamable-http',
      });
    }

    if (url.pathname !== '/mcp') {
      return json({ error: 'Not Found' }, 404);
    }

    const backendKey = String(env.MEMORY_API_KEY || '').trim();
    const accessToken = String(env.MCP_ACCESS_TOKEN || '').trim();
    const allowedHosts = splitCsv(env.MCP_ALLOWED_HOSTS);
    const allowedOrigins = splitCsv(env.MCP_ALLOWED_ORIGINS);

    if (!backendKey || !accessToken || allowedHosts.length === 0) {
      return json({ error: 'Remote MCP is not configured' }, 500);
    }

    const host = requestHostname(request);
    if (!host || !allowedHosts.includes(host)) {
      return json({ error: 'Forbidden' }, 403);
    }

    const origin = originHostname(request);
    if (origin !== null) {
      if (!origin || allowedOrigins.length === 0 || !allowedOrigins.includes(origin)) {
        return json({ error: 'Forbidden' }, 403);
      }
    }

    if (!safeEqual(bearerToken(request), accessToken)) {
      return json(
        { error: 'Unauthorized' },
        401,
        { 'www-authenticate': 'Bearer realm="teddy-memory-mcp"' },
      );
    }

    return mcpFetch(request);
  };
}
