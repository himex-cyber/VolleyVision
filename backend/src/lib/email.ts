// One way to normalise an email address, used everywhere one is stored or
// looked up.
//
// Before this existed the codebase had four different behaviours across nine
// sites: auth.service lowercased but never trimmed, middleware/rateLimit and
// teamOwnership.service trimmed AND lowercased, and invitation.service stored
// the raw string. That is not a style inconsistency, it is a bug with several
// faces - register with " a@b.com " and the row is stored with the leading
// space, so login (which also does not trim) can still find it but the
// ownership-transfer lookup (which does trim) cannot, and the forgot-password
// rate limiter keys the padded and unpadded forms to two different buckets.
//
// Case: the local part of an address is technically case-sensitive per RFC
// 5321, but no mail provider anyone uses actually treats it that way, and
// storing mixed case would let one person register twice with the same inbox.
// Lowercasing is the pragmatic choice every site here had already made.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
