import { msg } from '@/shared/i18n';
/** Domain errors carry a stable code (for i18n/tests) and a German default message. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ValidationError extends DomainError {
  constructor(
    message: string,
    public readonly issues: { path: string; message: string }[] = [],
  ) {
    super('validation', message, issues);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('conflict', message, details);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string, id: string) {
    super('not_found', msg(`${what} nicht gefunden: ${id}`, `${what} not found: ${id}`), { id });
    this.name = 'NotFoundError';
  }
}

export class TransitionError extends DomainError {
  constructor(from: string, to: string, reason?: string) {
    super(
      'transition',
      msg(
        `Statuswechsel ${from} → ${to} nicht erlaubt`,
        `Status change ${from} → ${to} not allowed`,
      ) + (reason ? `: ${reason}` : ''),
      { from, to },
    );
    this.name = 'TransitionError';
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
