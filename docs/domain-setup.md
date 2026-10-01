# volleyvision.co.nz: pointing the domain at the app

For Karlos. The code already uses `https://volleyvision.co.nz` for the legal pages and
store listings (`frontend/src/lib/legal.ts`, `docs/store/`), and `support@volleyvision.co.nz`
for support. Nothing here is urgent until an app build or a store submission needs the links.

## 1. Buy it

- Register `volleyvision.co.nz` with **Himex Trading Ltd** as the registrant (the organisation,
  not you personally), so it belongs to the company. Apple's organisation enrolment and the Play
  Console organisation account both check this.
- Add the email service and create the mailbox `support@volleyvision.co.nz`. Send it a test email.

## 2. Add it to the production site on Netlify

1. Netlify → site **volleyvision-app** → Domain management → **Add a domain** →
   `volleyvision.co.nz`. Add `www.volleyvision.co.nz` too; Netlify redirects one to the other.
2. DNS, at the registrar (keep the registrar's DNS so the email records stay put):
   - apex `volleyvision.co.nz`: the `A` record (or ALIAS) Netlify shows
   - `www`: `CNAME` to `volleyvision-app.netlify.app`
   - leave the email service's `MX`/`TXT` records untouched.
3. Wait for Netlify to show the HTTPS certificate as issued (minutes to a few hours).

## 3. Check the apps still reach the API (important)

The installed Android builds (and the next ones) call the API at
`https://volleyvision-app.netlify.app/api/v1` (`frontend/.env.native-prod`). If Netlify
redirects that address to the new domain, sign-in in those apps breaks, because a redirected
POST turns into a GET. Right after adding the domain, run:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://volleyvision-app.netlify.app/api/v1/auth/login
```

- `400`, `401` or `429`: fine, the old address still answers directly.
- `301`/`302`: tell Claude; the apps' API address moves to the new domain in a new build, and
  the old builds need replacing (none are shared outside your own devices yet).

## 4. Env vars (G6, you set them)

- `CLIENT_URL` = `https://volleyvision.co.nz`: the links in emails (verify, reset, invitations)
  then use the new domain. The website itself works without this (it calls its own address).
- Add `https://volleyvision-app.netlify.app` to `CORS_EXTRA_ORIGINS` (comma-separated, next to
  what's already there) only if people keep opening the old address.
- A redeploy (`.\deploy.ps1`) picks up env changes.

## 5. Tell Claude

When `https://volleyvision.co.nz/privacy` opens, say so: Claude moves the smoke check and the
remaining `netlify.app` mentions (`deploy.ps1`, README) over.
