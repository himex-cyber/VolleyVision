// HTML-escapes a string for safe interpolation into an email template. Email
// bodies in lib/mailer.ts are built by string-interpolating values that can
// come straight from user input (first name, team name, inviter name) into
// raw HTML — without this, a name like `<img src=x onerror=...>` renders as
// markup in every client that opens the email (HTML injection / stored XSS
// against webmail).
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
