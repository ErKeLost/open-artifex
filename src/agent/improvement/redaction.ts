const SECRET_PATTERNS = [
  /\b(sk-[A-Za-z0-9_-]{16,})\b/g,
  /\b(sk-or-v1-[A-Za-z0-9_-]{16,})\b/g,
  /\b(?:Bearer|Token)\s+[A-Za-z0-9._~+\/-]{16,}\b/gi,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
  /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*[^\s,;]+/gi,
];

/** Keeps enough operating context for review while removing credential-shaped values. */
export function redactForImprovement(value: string, maxLength: number): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  const normalized = redacted.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}
