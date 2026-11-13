import type { UnpeekNextAdapterOptions } from '../adapters/next/index.js';

export function isNext16OrAbove(versionStr?: string): boolean {
  if (!versionStr) return false;
  const clean = versionStr.replace(/^[^\d]*/, '');
  const match = clean.match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  if (major > 16) return true;
  if (major === 16 && minor >= 2) return true;
  return false;
}

interface SerializedRegExp {
  __unpeekRegExp: true;
  source: string;
  flags: string;
}

function isSerializedRegExp(val: unknown): val is SerializedRegExp {
  if (typeof val !== 'object' || val === null) return false;
  const record = val as Record<string, unknown>;
  return (
    record.__unpeekRegExp === true &&
    typeof record.source === 'string' &&
    typeof record.flags === 'string'
  );
}

export function serializeNextOptions(options: UnpeekNextAdapterOptions): string {
  return JSON.stringify(options, (_key: string, value: unknown): unknown => {
    if (value instanceof RegExp) {
      return {
        __unpeekRegExp: true,
        source: value.source,
        flags: value.flags,
      } satisfies SerializedRegExp;
    }
    return value;
  });
}

export function parseNextOptions(raw: string): unknown {
  return JSON.parse(raw, (_key: string, value: unknown): unknown => {
    if (isSerializedRegExp(value)) {
      try {
        return new RegExp(value.source, value.flags);
      } catch {
        return undefined;
      }
    }
    return value;
  });
}

export function readUnpeekNextOptionsFromEnv(): UnpeekNextAdapterOptions | undefined {
  const raw = process.env.UNPEEK_NEXT_OPTIONS;
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = parseNextOptions(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as UnpeekNextAdapterOptions;
    }
  } catch {
    // Ignore malformed UNPEEK_NEXT_OPTIONS JSON
  }
  return undefined;
}
