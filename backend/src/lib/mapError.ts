// Pure mapping from a thrown error to an HTTP response shape. Extracted out of
// errorHandler.ts so it can be unit-tested without importing anything that
// pulls in lib/prisma (see lib/rolePermissions.ts for why that split exists).
export interface ErrorResponse {
  status: number;
  // retryable (6.5): only a serialization conflict. The offline queue resends
  // those; any other 409 is a real refusal it must show, not retry forever.
  body: { error: string; code?: string; retryable?: boolean; [detail: string]: unknown };
}

export function mapErrorToResponse(err: Error): ErrorResponse {
  const anyErr = err as any;

  // AppError, or a plain Error carrying { statusCode, code } (services throw
  // Object.assign(new Error(msg), { statusCode }) in several places — this is
  // the shortcut several controllers used to handle inline before bypassing
  // the shared handler dropped the `code` field once (EMAIL_NOT_VERIFIED).
  if (typeof anyErr.statusCode === 'number') {
    return {
      status: anyErr.statusCode,
      body: {
        // Structured extras a client acts on, e.g. the teams blocking an
        // account deletion (9.4). First, so they can never replace the rest.
        ...(anyErr.details && typeof anyErr.details === 'object' ? anyErr.details : {}),
        error: err.message,
        ...(anyErr.code ? { code: anyErr.code } : {}),
        ...(anyErr.code === 'SERIALIZATION_CONFLICT' ? { retryable: true } : {}),
      },
    };
  }

  // Prisma unique constraint violation
  if (anyErr.code === 'P2002') {
    return { status: 409, body: { error: 'A record with those details already exists.' } };
  }

  // Prisma foreign key refused the write: a row it points at went away
  // mid-request, e.g. a message sent while its author deleted their account.
  if (anyErr.code === 'P2003') {
    return { status: 409, body: { error: 'This changed while you were working. Refresh and try again.' } };
  }

  // Prisma record not found
  if (anyErr.code === 'P2025') {
    return { status: 404, body: { error: 'Record not found.' } };
  }

  return { status: 500, body: { error: 'An unexpected error occurred.' } };
}
