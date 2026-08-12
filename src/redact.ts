export type RedactStatus = "clean" | "redacted" | "blocked";

export interface RedactResult {
  text: string;
  status: RedactStatus;
  reasons: string[];
}

interface Pattern {
  re: RegExp;
  reason: string;
  blocked?: boolean;
}

const PATTERNS: Pattern[] = [
  { re: /\bsk-[A-Za-z0-9_-]{12,}\b/g, reason: "openai-key" },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, reason: "bearer-token" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, reason: "aws-access-key" },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, reason: "github-token" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, reason: "slack-token" },
  {
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\n[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    reason: "private-key",
    blocked: true,
  },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, reason: "jwt", blocked: true },
  {
    re: /\b(?:password|passwd|secret|token|api[_-]?key|auth[_-]?token)\s*[=:]\s*["']?[^\s"',;]+/gi,
    reason: "secret-assignment",
  },
  { re: /\b(?:auth\.json|credentials\.json|\.env)\b/g, reason: "credential-path", blocked: true },
];

export function redactSecrets(input: string): RedactResult {
  let text = input;
  const reasons = new Set<string>();
  let any = false;
  let blocked = false;
  for (const p of PATTERNS) {
    text = text.replace(p.re, (match) => {
      any = true;
      reasons.add(p.reason);
      if (p.blocked) blocked = true;
      return `[REDACTED:${p.reason}]`;
    });
  }
  return {
    text,
    status: blocked ? "blocked" : any ? "redacted" : "clean",
    reasons: [...reasons],
  };
}
