export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`Not implemented: ${what}`);
    this.name = 'NotImplementedError';
  }
}

export function notImplemented(what: string): never {
  throw new NotImplementedError(what);
}
