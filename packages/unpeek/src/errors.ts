export type UnpeekErrorCode =
  | 'ERR_CONFIG_INVALID'
  | 'ERR_CONFIG_LOAD'
  | 'ERR_INIT_INVALID_PACKAGE_JSON'
  | 'ERR_SECURITY_PATH_TRAVERSAL'
  | 'ERR_CLI_INVALID_ARGS'
  | 'ERR_PARSE_FAILED'
  | 'ERR_NEXT_ADAPTER';

export class UnpeekError extends Error {
  readonly code: UnpeekErrorCode;

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
