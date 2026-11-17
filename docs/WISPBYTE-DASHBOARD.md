# Wispbyte dashboard website

This deployment runs the public-facing ZERON website on Wispbyte. The dashboard HTML, JavaScript, CSS, Privacy Policy, and Terms page are served from this host. Dynamic dashboard requests and Discord OAuth are securely proxied to the existing Enzonic application, which continues to own the Discord client and SQLite database.

## Wispbyte startup

Use:

```bash
npm install && npm run start:site
```

Set these Wispbyte environment variables:

- `NODE_ENV=production`
- `ZERON_BACKEND_URL=https://YOUR-VALID-ENZONIC-HTTPS-HOST`
- `PORT` should be supplied by Wispbyte.

`ZERON_BACKEND_URL` must be a valid HTTPS origin for the Enzonic application. The proxy intentionally validates the TLS certificate and will fail closed if the certificate is invalid. Do not use an HTTP URL or disable certificate verification.

## Enzonic application settings

Keep the existing bot, SQLite database path, and normal `npm start` process on Enzonic. Do not run `npm run start:site` there.

Keep the existing Discord OAuth client credentials on Enzonic. Set the public URL values there to the Wispbyte domain:

- `BASE_URL=https://zeron.freesrv.com`
- `DISCORD_REDIRECT_URI=https://zeron.freesrv.com/auth/discord/callback`

The redirect URI must also be registered in the Discord Developer Portal. The Wispbyte proxy forwards the OAuth routes and preserves the browser session cookie on the public Wispbyte domain.

## Public legal pages

- `/privacy.html` serves the existing Privacy Policy file.
- `/tos.html` serves the ZERON Terms of Service.
- `/healthz` reports the Wispbyte site process health.

## Important

This change does not migrate, copy, or modify SQLite data. It does not change the Enzonic bot startup entry point. The Wispbyte dashboard needs a valid Enzonic HTTPS endpoint before live dashboard/OAuth requests can work.
