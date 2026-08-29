export function protectedResourceMetadata(config) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [config.requiredScope],
  };
}

export function bearerChallenge(config, { insufficientScope = false } = {}) {
  const fields = [];
  if (insufficientScope) fields.push('error="insufficient_scope"');
  fields.push(`resource_metadata="${config.metadataUrl}"`);
  fields.push(`scope="${config.requiredScope}"`);
  return `Bearer ${fields.join(', ')}`;
}
