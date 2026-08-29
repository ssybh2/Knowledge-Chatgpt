const REASONS = [
  'credential_secret',
  'payment_card',
  'government_identifier',
  'health_phi',
  'auth_security_record',
  'precise_contact_or_address',
  'attachment_or_unreviewed_binary',
  'uncertain_restricted_data',
];

function add(set, reason) {
  if (REASONS.includes(reason)) set.add(reason);
}

function luhnValid(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

function hasCredential(text) {
  const markers = [
    /\bapi[\s_-]*key\b/i,
    /\bapikey\b/i,
    /\bpassword\b/i,
    /\bpasswd\b/i,
    /\bsecret\b/i,
    /\bbearer\s+[A-Za-z0-9._~+\/-]+/i,
    /authorization\s*:/i,
    /\btoken\s*=/i,
    /\botp\b/i,
    /\bmfa\b/i,
    /验证码/i,
    /一次性密码/i,
    /\bsk-[A-Za-z0-9_-]{8,}\b/i,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/i,
  ];
  return markers.some((regex) => regex.test(text));
}

function hasPaymentCard(text) {
  const matches = text.match(/(?:\d[ -]?){13,19}/g) || [];
  return matches.some(luhnValid);
}

function hasGovernmentId(text) {
  const chinaCitizenId = /\b\d{17}[\dXx]\b/;
  const coupled = /(passport|护照|government\s*id|身份证|identity\s*number).{0,24}[A-Za-z0-9-]{5,}/i;
  return chinaCitizenId.test(text) || coupled.test(text);
}

function hasHealthPhi(text) {
  return /(体检|诊断|病历|医院|药物|处方|患者|病人|化验|检验结果|同型半胱氨酸|medical|diagnosis|patient|prescription|lab\s*result|homocysteine)/i.test(text);
}

function hasAuthSecurityRecord(text) {
  return /(login\s*history|authentication|security\s*event|登录记录|登录日志|认证记录|账户安全记录)/i.test(text);
}

function hasPreciseContactOrAddress(text) {
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const phone = /(?:\+?\d{1,3}[\s-]?)?(?:1[3-9]\d{9}|\d{3}[\s-]?\d{3}[\s-]?\d{4})/;
  const address = /(street|road|avenue|lane|路|街|巷|号|室|栋).{0,20}\d+/i;
  return email.test(text) || phone.test(text) || address.test(text);
}

function hasAttachmentMarker(text) {
  return /(file:\/\/|sandbox:\/|data:[^;\s]+;base64,|attachment[_ -]?body|raw[_ -]?attachment|binary[_ -]?payload)/i.test(text);
}

function hasUncertainRestrictedData(text) {
  return /(sensitive\s+personal\s+data|confidential\s+personal\s+record|高度敏感个人信息|敏感身份资料)/i.test(text);
}

export function scanRestrictedText(value) {
  const text = String(value ?? '');
  if (!text) return [];
  const reasons = new Set();
  if (hasCredential(text)) add(reasons, 'credential_secret');
  if (hasPaymentCard(text)) add(reasons, 'payment_card');
  if (hasGovernmentId(text)) add(reasons, 'government_identifier');
  if (hasHealthPhi(text)) add(reasons, 'health_phi');
  if (hasAuthSecurityRecord(text)) add(reasons, 'auth_security_record');
  if (hasPreciseContactOrAddress(text)) add(reasons, 'precise_contact_or_address');
  if (hasAttachmentMarker(text)) add(reasons, 'attachment_or_unreviewed_binary');
  if (hasUncertainRestrictedData(text)) add(reasons, 'uncertain_restricted_data');
  return REASONS.filter((reason) => reasons.has(reason));
}

export function scanCandidateFields({ title = '', summary = '', keywords = [] } = {}) {
  const reasons = new Set();
  for (const field of [title, summary, ...(Array.isArray(keywords) ? keywords : [])]) {
    for (const reason of scanRestrictedText(field)) reasons.add(reason);
  }
  return REASONS.filter((reason) => reasons.has(reason));
}
