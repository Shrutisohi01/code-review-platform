const REDACTED = "[REDACTED]";

const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI/Anthropic-style keys
  /\bsk_[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s'"`]*:[^\s'"`@]+@/gi, // credentials in URLs
];

// key = "value" style assignments with a secret-looking name. Keeps the name so the code stays reviewable.
const ASSIGNMENT = /((?:api[_-]?key|secret|token|passw(?:or)?d|passwd|private[_-]?key|auth(?:orization)?)["']?\s*[:=]\s*)(["'`])([^"'`\n]{6,})\2/gi;

/**
 * Best-effort redaction of obvious secrets before code leaves the server. Line structure is preserved
 * so line numbers stay valid. This does NOT catch every secret and must not be described as doing so.
 */
export function redactSecrets(text: string): { text: string; redactions: number } {
  let count = 0;
  const lines = text.split("\n");
  let inKey = false;
  const out = lines.map((line) => {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line)) {
      inKey = !/-----END [A-Z ]*PRIVATE KEY-----/.test(line);
      count++;
      return line.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----.*/, `-----BEGIN PRIVATE KEY----- ${REDACTED}`);
    }
    if (inKey) {
      if (/-----END [A-Z ]*PRIVATE KEY-----/.test(line)) inKey = false;
      return REDACTED;
    }
    let l = line;
    for (const p of PATTERNS) l = l.replace(p, () => (count++, REDACTED));
    l = l.replace(ASSIGNMENT, (_m, pre: string, q: string) => (count++, `${pre}${q}${REDACTED}${q}`));
    return l;
  });
  return { text: out.join("\n"), redactions: count };
}
