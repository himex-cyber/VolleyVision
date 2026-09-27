// Feedback tab — pure validators for feedback fields. Kept out of
// feedback.service.ts so they are unit-testable without a database (`npm
// test` only runs src/lib/*.test.ts under ts-node).

import { FeedbackSeverity, FeedbackType } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';

/** Own-key membership test — `in` would also match prototype keys like "toString". */
export function isEnumValue<T extends Record<string, string>>(enumObj: T, raw: unknown): raw is T[keyof T] {
  return typeof raw === 'string' && Object.values(enumObj).includes(raw);
}

export function parseType(raw: unknown): FeedbackType {
  if (isEnumValue(FeedbackType, raw)) return raw;
  throw new AppError(400, 'Feedback type must be BUG, FEATURE_REQUEST, or GENERAL.');
}

export function parseSeverity(raw: unknown, type: FeedbackType): FeedbackSeverity | null {
  // Severity only applies to bugs — silently dropped otherwise so a client
  // that leaves a stale value in the form doesn't get rejected.
  if (type !== FeedbackType.BUG || raw == null || raw === '') return null;
  if (isEnumValue(FeedbackSeverity, raw)) return raw;
  throw new AppError(400, 'Severity must be LOW, MEDIUM, or HIGH.');
}

export function parseRequiredText(raw: unknown, field: string, maxLength: number): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) throw new AppError(400, `${field} is required.`);
  if (value.length > maxLength) {
    throw new AppError(400, `${field} must be at most ${maxLength.toLocaleString()} characters.`);
  }
  return value;
}
