import { pathToFileURL } from 'node:url';

const EXPECTED_TOOLS = Object.freeze([
  'get_context',
  'get_memory_item',
  'search_memory',
]);
const UNKNOWN_MEMORY_REF = 'mem_00000000000000000000000000000000';
const FORBIDDEN_RESULT_FIELDS = new Set([
  'id',
  'owner_id',
  'conversation_id',
  'message_id',
  'source_archive_id',
  'source_note',
  'created_at',
  'updated_at',
]);

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('TEDDY_PLUGIN_URL (base URL) is required');

  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('TEDDY_PLUGIN_URL must be a valid HTTP(S) base URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('TEDDY_PLUGIN_URL must be a valid HTTP(S) base URL');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function normalizeToken(value) {
  const token = String(value || '').trim();
  if (!token) throw new Error('PLUGIN_DEV_ACCESS_TOKEN is required locally');
  return token;
}

async function readMcpPayload(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();

  const text = await response.text();
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith('data:'));
  assertCondition(Boolean(dataLine), 'MCP response did not contain a JSON or SSE payload');
  try {
    return JSON.parse(dataLine.slice('data:'.length).trim());
  } catch {
    throw new Error('MCP response payload was not valid JSON');
  }
}

function assertNoInternalFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    assertCondition(!FORBIDDEN_RESULT_FIELDS.has(key), 'MCP search result exposed an internal field');
  }
}

async function postMcp({ baseUrl, token, body, fetchImpl }) {
  const response = await fetchImpl(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
  assertCondition(response.status === 200, `MCP request failed with status ${response.status}`);
  const payload = await readMcpPayload(response);
  assertCondition(payload?.jsonrpc === '2.0', 'MCP response is missing jsonrpc=2.0');
  assertCondition(payload?.id === body.id, 'MCP response id did not match request id');
  assertCondition(!payload?.error, 'MCP request returned an error');
  return payload;
}

export async function runLiveSmoke({
  baseUrl,
  token,
  fetchImpl = fetch,
  write = (line) => console.log(line),
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedToken = normalizeToken(token);
  assertCondition(typeof fetchImpl === 'function', 'fetch implementation is required');
  assertCondition(typeof write === 'function', 'write callback is required');

  const healthResponse = await fetchImpl(`${normalizedBaseUrl}/healthz`, { method: 'GET' });
  assertCondition(healthResponse.status === 200, `healthz failed with status ${healthResponse.status}`);

  const unauthorizedResponse = await fetchImpl(`${normalizedBaseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({}),
  });
  assertCondition(unauthorizedResponse.status === 401, 'unauthenticated /mcp did not return 401');

  const initialize = await postMcp({
    baseUrl: normalizedBaseUrl,
    token: normalizedToken,
    fetchImpl,
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'teddy-memory-plugin-live-smoke', version: '0.1.0' },
      },
    },
  });
  assertCondition(Boolean(initialize.result?.serverInfo), 'MCP initialize response is incomplete');

  const listPayload = await postMcp({
    baseUrl: normalizedBaseUrl,
    token: normalizedToken,
    fetchImpl,
    body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  });
  const toolNames = (listPayload.result?.tools || []).map((tool) => tool.name).sort();
  assertCondition(
    JSON.stringify(toolNames) === JSON.stringify(EXPECTED_TOOLS),
    'MCP tools/list did not expose exactly the expected three tools',
  );

  const searchPayload = await postMcp({
    baseUrl: normalizedBaseUrl,
    token: normalizedToken,
    fetchImpl,
    body: {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'search_memory',
        arguments: { query: 'EtherCAT', limit: 4 },
      },
    },
  });
  assertCondition(searchPayload.result?.isError !== true, 'search_memory returned a tool error');
  const memories = searchPayload.result?.structuredContent?.memories;
  assertCondition(Array.isArray(memories), 'search_memory did not return memories[]');
  for (const memory of memories) assertNoInternalFields(memory);

  const unknownPayload = await postMcp({
    baseUrl: normalizedBaseUrl,
    token: normalizedToken,
    fetchImpl,
    body: {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'get_memory_item',
        arguments: { memory_ref: UNKNOWN_MEMORY_REF },
      },
    },
  });
  assertCondition(unknownPayload.result?.isError !== true, 'get_memory_item returned a tool error');
  assertCondition(
    unknownPayload.result?.structuredContent?.memory === null,
    'unknown memory_ref did not return neutral not-found behavior',
  );

  const report = {
    health: true,
    unauthorized: true,
    tools: toolNames.length,
    search_result_count: memories.length,
    unknown_ref_not_found: true,
  };
  write(JSON.stringify(report));
  return report;
}

async function main() {
  try {
    await runLiveSmoke({
      baseUrl: process.env.TEDDY_PLUGIN_URL,
      token: process.env.PLUGIN_DEV_ACCESS_TOKEN,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Live smoke failed');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
