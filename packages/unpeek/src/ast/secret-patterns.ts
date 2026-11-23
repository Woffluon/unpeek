/**
 * Plaintext secret and high-entropy literal classification heuristics.
 *
 * Concepts adapted from qybaihe/bla (MIT License — src/engine/plaintext-secret-lint.ts
 * and src/shields/javascript/ast-shield.ts) for unpeek's Acorn AST pipeline:
 * Shannon entropy, sequential-alphabet filtering, English bigram Z-score
 * natural-text suppression, and regex secret-run extraction.
 */

export type PlaintextSecretCategory =
  | 'pem-header'
  | 'token-prefix'
  | 'hex-or-base64'
  | 'high-entropy';

export interface PlaintextSecretMatch {
  category: PlaintextSecretCategory;
  entropy: number;
}

const PEM_HEADER_RE = /-----BEGIN\s+[A-Z0-9 ]+-----/;
const PEM_REGEX_HEADER_RE =
  /-----BEGIN(?:\s|\\s[+*?]?)+(?:[A-Z0-9 ]|\\s[+*?]?)+-----/;

const TOKEN_PREFIX_RE =
  /\b(?:sk_live_|sk_test_|pk_live_|ghp_|gho_|github_pat_|xox[baprs]-|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|FLAG\{[^}]{4,}\}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,})/;

const ESCAPED_FLAG_REGEX_RE = /\bFLAG\\\{[^}]{4,}\\\}/;

const HEX_RE = /^[0-9a-fA-F]+$/;
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;
const TOKEN_CHARSET_RE = /^[A-Za-z0-9_\-+/=.~:@!#$%^&*]+$/;

const PATH_LIKE_RE =
  /^(?:\.{1,2}\/|@[\w.-]+\/)|\.(?:[cm]?[jt]sx?|json|css|map|wasm|html?|node|svg|png|jpe?g|gif|woff2?|ttf|md|txt|ya?ml|toml|lock)$/i;

const REGEX_CHAR_CLASS_RE = /\[(?:\\[\s\S]|[^\]\\])*\]/g;
const REGEX_META_SPLIT_RE =
  /\(\?(?:<[=!]|<[^>]+>|[:=!])?|\\[\s\S]|[\s^$.*+?()[\]{}|/]+/;

const COMMON_BIGRAMS: ReadonlySet<string> = new Set(
  (
    'th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng se ha as ou io le ve co me de hi ri ro ic ne ea ra ce li ch ll be ma si om ur ' +
    'ca el ta la ns ge ec ct pe ol un il us ss ac em tr pr po fi ad lo ut id pa so mo wi no di ee ul et ai rs oo ex'
  ).split(' ')
);
const COMMON_BIGRAM_CHANCE = COMMON_BIGRAMS.size / 676;
const NATURAL_TEXT_Z = 3.5;

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isBinaryOrWasmPrefix(value: string): boolean {
  return value.startsWith('AGFzbQE') || /^data:/i.test(value);
}

function countBase64MarkerRatio(value: string): number {
  let hits = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (
      (code >= 48 && code <= 57) || // 0-9
      code === 43 || // +
      code === 47 || // /
      code === 61 // =
    ) {
      hits += 1;
    }
  }
  return hits / value.length;
}

/**
 * Computes Shannon entropy in bits per character.
 */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<number, number>();
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let h = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Returns true when most adjacent characters form consecutive ASCII code points
 * (e.g. Base64/Base58/hex encoding alphabets rather than random secrets).
 */
export function isSequentialAlphabet(value: string): boolean {
  if (value.length < 8) return false;
  let ascending = 0;
  for (let i = 1; i < value.length; i++) {
    if (value.charCodeAt(i) - value.charCodeAt(i - 1) === 1) {
      ascending += 1;
    }
  }
  return ascending / (value.length - 1) >= 0.6;
}

/**
 * Uses English letter-pair bigram statistics (Z-score >= 3.5, respecting camelCase
 * boundaries) to distinguish prose and identifiers from generated secrets.
 */
export function looksLikeNaturalText(value: string): boolean {
  let pairs = 0;
  let hits = 0;
  const lower = value.toLowerCase();
  for (let i = 1; i < value.length; i++) {
    const a = value.charCodeAt(i - 1);
    const b = value.charCodeAt(i);
    if (!isAsciiLetter(a) || !isAsciiLetter(b)) continue;
    pairs += 1;
    if (a >= 97 && b <= 90) continue;
    if (COMMON_BIGRAMS.has(lower[i - 1] + lower[i])) {
      hits += 1;
    }
  }
  if (pairs < 4) return false;
  const expected = COMMON_BIGRAM_CHANCE * pairs;
  const deviation = Math.sqrt(
    pairs * COMMON_BIGRAM_CHANCE * (1 - COMMON_BIGRAM_CHANCE)
  );
  return (hits - expected) / deviation >= NATURAL_TEXT_Z;
}

/**
 * Classifies a plaintext string literal if it matches known secret structures
 * or high-entropy random token heuristics, filtering out common false positives.
 */
export function classifyPlaintextSecret(
  value: string
): PlaintextSecretMatch | null {
  if (typeof value !== 'string' || value.length < 8) return null;
  if (isBinaryOrWasmPrefix(value)) return null;
  if (PATH_LIKE_RE.test(value)) return null;

  const entropy = shannonEntropy(value);

  if (PEM_HEADER_RE.test(value)) {
    return { category: 'pem-header', entropy };
  }
  if (TOKEN_PREFIX_RE.test(value)) {
    return { category: 'token-prefix', entropy };
  }

  if (isSequentialAlphabet(value)) {
    return null;
  }

  const isHex =
    value.length >= 24 &&
    value.length % 2 === 0 &&
    HEX_RE.test(value) &&
    entropy >= 3.2;
  if (isHex) {
    return { category: 'hex-or-base64', entropy };
  }

  const isBase64Like =
    value.length >= 28 &&
    BASE64_RE.test(value) &&
    countBase64MarkerRatio(value) >= 0.15 &&
    !looksLikeNaturalText(value) &&
    entropy >= 4.0;
  if (isBase64Like) {
    return { category: 'hex-or-base64', entropy };
  }

  if (
    value.length >= 20 &&
    value.length <= 512 &&
    TOKEN_CHARSET_RE.test(value) &&
    !looksLikeNaturalText(value) &&
    entropy >= 4.1
  ) {
    return { category: 'high-entropy', entropy };
  }

  return null;
}

/**
 * Convenience predicate returning true when a literal classifies as a likely plaintext secret.
 */
export function isLikelySecretLiteral(value: string): boolean {
  return classifyPlaintextSecret(value) !== null;
}

/**
 * Detects whether a regular-expression pattern embeds a PEM header, known token prefix,
 * or a contiguous literal run (>= 20 chars) outside character classes that classifies as a secret.
 */
export function hasRegexSecretRun(pattern: string): boolean {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 4096) {
    return false;
  }
  if (
    PEM_HEADER_RE.test(pattern) ||
    PEM_REGEX_HEADER_RE.test(pattern) ||
    TOKEN_PREFIX_RE.test(pattern) ||
    ESCAPED_FLAG_REGEX_RE.test(pattern)
  ) {
    return true;
  }
  const outsideClasses = pattern.replace(REGEX_CHAR_CLASS_RE, ' ');
  const parts = outsideClasses.split(REGEX_META_SPLIT_RE);
  for (const part of parts) {
    if (part.length >= 20 && isLikelySecretLiteral(part)) {
      return true;
    }
  }
  return false;
}
