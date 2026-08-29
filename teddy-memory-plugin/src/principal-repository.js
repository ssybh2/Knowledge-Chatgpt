function assertDatabase(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('A D1-compatible database is required');
  }
}

function assertIdentityPart(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new TypeError('OAuth principal identity is invalid');
  }
  return value;
}

export async function hashPrincipalSubject(issuer, subject) {
  const scopedIssuer = assertIdentityPart(issuer);
  const scopedSubject = assertIdentityPart(subject);
  const bytes = new TextEncoder().encode(`${scopedIssuer}\0${scopedSubject}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createPrincipalRepository(db) {
  assertDatabase(db);

  return {
    async resolveOwner({ issuer, subject }) {
      const scopedIssuer = assertIdentityPart(issuer);
      const scopedSubject = assertIdentityPart(subject);
      const subjectHash = await hashPrincipalSubject(scopedIssuer, scopedSubject);
      const sql = `
        SELECT owner_id
        FROM oauth_principals
        WHERE issuer = ?
          AND subject_hash = ?
          AND is_active = 1
        LIMIT 1
      `;

      const row = await db.prepare(sql).bind(scopedIssuer, subjectHash).first();
      const ownerId = typeof row?.owner_id === 'string' ? row.owner_id.trim() : '';
      return ownerId || null;
    },
  };
}
