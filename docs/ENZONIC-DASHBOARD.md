# Enzonic dashboard deployment

ZERON runs as a single application on Enzonic. The existing Node.js process serves the Discord bot, dashboard, OAuth callback, static assets, Privacy Policy, and Terms of Service together.

## Startup

Use the repository's normal startup command:

```bash
npm start
```

This runs `node src/index.js`. Do not use the Wispbyte-only `start:site` command.

## Environment

Keep the existing Discord credentials and database settings unchanged. Set the public URL values to the Enzonic HTTPS address:

```env
NODE_ENV=production
BASE_URL=https://zeronx.enzonic.dev
DISCORD_REDIRECT_URI=https://zeronx.enzonic.dev/auth/discord/callback
```

Keep the existing values for `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, and `DATABASE_PATH` (if it is already configured). `SESSION_SECRET` must remain at least 32 characters. Keep the existing database file and path; do not reset, replace, or migrate SQLite data for this deployment.

If Enzonic supplies `PORT` automatically, leave it under the host's control.

## Discord Developer Portal

Add this exact OAuth2 redirect URI to the application's Redirects list:

```text
https://zeronx.enzonic.dev/auth/discord/callback
```

The value in `DISCORD_REDIRECT_URI` must match it exactly.

## Legal pages

The existing Express static-file server serves:

- `/privacy.html` (redirects to the full Privacy Policy at `/privacy-zeron.html`)
- `/privacy-zeron.html`
- `/tos.html`

No separate website server or reverse proxy is required.
