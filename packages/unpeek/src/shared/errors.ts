export type UnpeekErrorCode =
  | 'ERR_CONFIG_INVALID'
  | 'ERR_CONFIG_LOAD'
  | 'ERR_INIT_INVALID_PACKAGE_JSON'
  | 'ERR_SECURITY_PATH_TRAVERSAL'
  | 'ERR_CLI_INVALID_ARGS'
  | 'ERR_PARSE_FAILED'
  | 'ERR_NEXT_ADAPTER'
  | 'ERR_BUDGET_EXCEEDED';

const UNPEEK_ERROR_BRAND = Symbol.for('unpeek.UnpeekError');

export class UnpeekError extends Error {
  readonly code: UnpeekErrorCode;
  readonly [UNPEEK_ERROR_BRAND] = true;

  constructor(
    code: UnpeekErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'UnpeekError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isUnpeekError(err: unknown): err is UnpeekError {
  if (err instanceof UnpeekError) {
    return true;
  }
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const candidate = err as Record<PropertyKey, unknown>;
  return (
    candidate[UNPEEK_ERROR_BRAND] === true ||
    (candidate.name === 'UnpeekError' && typeof candidate.code === 'string')
  );
}
