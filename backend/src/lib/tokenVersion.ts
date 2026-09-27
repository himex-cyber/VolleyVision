// Pure predicate for JWT revocation (audit M7 part 2). A token issued before
// this feature shipped carries no `tv` claim at all — treat that as tv 0 so
// existing 7-day sessions keep working across the deploy instead of every
// logged-in user being kicked out at once.
export function isTokenCurrent(tokenTv: unknown, userTv: number): boolean {
  const effective = typeof tokenTv === 'number' ? tokenTv : 0;
  return effective === userTv;
}
