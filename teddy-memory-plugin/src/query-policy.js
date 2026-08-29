const UNAVAILABLE_MESSAGE = 'This category is unavailable through Plugin-safe memory';

const RESTRICTED_PATTERNS = [
  /\b(?:api[\s_-]?key|password|passcode|credential|auth(?:entication)? secret|client secret|access token|refresh token|bearer token|private key|otp|mfa|2fa)\b/i,
  /\b(?:credit card|payment card|card number|cvv|cvc|bank card)\b/i,
  /\b(?:government id|national id|passport number|social security number|ssn|driver'?s license number)\b/i,
  /\b(?:patient|medical record|health record|diagnosis|diagnostic result|lab result|clinical record|prescription)\b/i,
  /\b(?:login history|authentication record|security record|account recovery record)\b/i,
  /\b(?:home address|street address|precise address|precise location|personal phone number|personal email address)\b/i,
  /(?:密码|口令|验证码|双重验证|两步验证|API\s*密钥|访问令牌|刷新令牌|私钥|银行卡号|信用卡号|身份证号|护照号|病历|诊断结果|化验结果|家庭住址|精确地址|手机号)/i,
];

function codePointLength(value) {
  return [...value].length;
}

function normalizeText(value, label, maxLength) {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new RangeError(`${label} must not be empty`);
  }
  if (codePointLength(normalized) > maxLength) {
    throw new RangeError(`${label} must be at most ${maxLength} code points`);
  }

  return normalized;
}

function uniqueTerms(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length === 8) break;
  }

  return result;
}

export function assertSafeLookupInput(input = {}) {
  const values = [];
  if (typeof input.query === 'string') values.push(input.query);
  if (Array.isArray(input.keywords)) {
    values.push(...input.keywords.filter((value) => typeof value === 'string'));
  }

  const text = values.join(' ');
  if (RESTRICTED_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new Error(UNAVAILABLE_MESSAGE);
  }
}

export function normalizeLookupInput(input = {}, options = {}) {
  const defaultLimit = options.defaultLimit;
  const maxLimit = options.maxLimit;

  if (!Number.isInteger(defaultLimit) || defaultLimit < 1) {
    throw new TypeError('defaultLimit must be a positive integer');
  }
  if (!Number.isInteger(maxLimit) || maxLimit < defaultLimit) {
    throw new TypeError('maxLimit must be an integer greater than or equal to defaultLimit');
  }

  let query;
  if (input.query !== undefined) {
    query = normalizeText(input.query, 'query', 300);
  }

  let keywords = [];
  if (input.keywords !== undefined) {
    if (!Array.isArray(input.keywords)) {
      throw new TypeError('keywords must be an array');
    }
    if (input.keywords.length < 1 || input.keywords.length > 8) {
      throw new RangeError('keywords must contain between 1 and 8 items');
    }
    keywords = input.keywords.map((value, index) => normalizeText(value, `keyword ${index + 1}`, 80));
  }

  if (!query && keywords.length === 0) {
    throw new RangeError('Provide query or keywords');
  }

  const limit = input.limit === undefined ? defaultLimit : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new RangeError(`limit must be an integer between 1 and ${maxLimit}`);
  }

  const terms = uniqueTerms([query, ...keywords]);

  return {
    query,
    keywords,
    terms,
    limit,
  };
}
