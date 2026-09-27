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

// Whether a value is a whole email address rather than a fragment someone is
// part-way through typing.
//
// This exists to keep the add-member lookup an EXACT-match lookup. That lookup
// used to substring-match email, firstName and lastName on any two-character
// string and hand back id + email + name twenty rows at a time, to any
// authenticated user - a complete walk of every person in the product, emails
// included, in a few hundred requests.
//
// Deliberately shape-only, not RFC validation. The lookup is an exact match
// against a stored address, so a malformed string simply finds nothing; the
// only job here is to refuse the fragments that made enumeration cheap.
export function isEmailAddress(value: string): boolean {
  if (/\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}
