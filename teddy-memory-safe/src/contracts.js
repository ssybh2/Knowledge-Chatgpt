function requiredString(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${field} must be a non-empty string`);
  return text;
}

function finiteOptional(value, field, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${field} must be a finite number`);
  return number;
}

function retrievableValue(value) {
  if (value === undefined) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    throw new TypeError('retrievable must be boolean-like');
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true') return true;
    if (normalized === '0' || normalized === 'false') return false;
  }
  throw new TypeError('retrievable must be boolean-like');
}

export function normalizeSourceMessage(value) {
  if (!value || typeof value !== 'object') throw new TypeError('source message must be an object');
  const role = requiredString(value.role, 'role');
  if (role !== 'user' && role !== 'assistant') {
    throw new TypeError('role must be user or assistant');
  }
  const rawRetrievable = Object.prototype.hasOwnProperty.call(value, 'retrievable')
    ? value.retrievable
    : value.is_retrievable;
  return {
    id: requiredString(value.id, 'id'),
    conversation_id: requiredString(value.conversation_id, 'conversation_id'),
    role,
    content: requiredString(value.content, 'content'),
    create_time: finiteOptional(value.create_time, 'create_time', null),
    sequence_index: finiteOptional(value.sequence_index, 'sequence_index', 0),
    retrievable: retrievableValue(rawRetrievable),
  };
}

export function normalizeConversation(value) {
  if (!value || typeof value !== 'object') throw new TypeError('conversation must be an object');
  const id = requiredString(value.id, 'id');
  const title = typeof value.title === 'string' && value.title.trim()
    ? value.title.trim()
    : 'Untitled historical conversation';
  return { id, title };
}
