'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const https = require('node:https');
const http = require('node:http');
const path = require('node:path');

const app = express();
const publicDir = path.resolve(__dirname, '../public');
const port = Number(process.env.PORT || 3000);
const backendValue = process.env.ZERON_BACKEND_URL;

if (!backendValue) {
  console.error('Missing ZERON_BACKEND_URL. Set it to the HTTPS URL of the Enzonic ZERON backend.');
  process.exit(1);
}

let backend;
try {
  backend = new URL(backendValue);
} catch {
  console.error('ZERON_BACKEND_URL must be a valid HTTPS URL.');
  process.exit(1);
}
if (backend.protocol !== 'https:' || backend.username || backend.password) {
  console.error('ZERON_BACKEND_URL must use HTTPS and must not contain credentials.');
  process.exit(1);
}

app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'zeron-wispbyte-site' }));

app.get(['/privacy', '/privacy.html'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'privacy-zeron.html'));
});

app.get(['/terms', '/terms.html', '/tos', '/tos.html'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'tos.html'));
});

// Serve the dashboard interface and legal pages from Wispbyte.
app.use(express.static(publicDir, {
  index: 'index.html',
  dotfiles: 'deny',
  fallthrough: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    } else if (/\.(?:js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

// Dynamic dashboard, OAuth, and API requests are handled by Enzonic.
// TLS certificate validation stays enabled; an invalid upstream certificate fails closed.
app.use((req, res) => {
  const transport = backend.protocol === 'https:' ? https : http;
  const upstreamPath = new URL(req.originalUrl, backend).pathname + new URL(req.originalUrl, backend).search;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  headers.host = backend.host;
  headers['x-forwarded-host'] = req.get('host') || '';
  headers['x-forwarded-proto'] = req.protocol;
  headers['x-forwarded-for'] = req.ip;

  const upstream = transport.request({
    protocol: backend.protocol,
    hostname: backend.hostname,
    port: backend.port || 443,
    method: req.method,
    path: upstreamPath,
    headers,
    rejectUnauthorized: true,
    timeout: 15000
  }, (upstreamResponse) => {
    res.status(upstreamResponse.statusCode || 502);
    for (const [name, value] of Object.entries(upstreamResponse.headers)) {
      if (value !== undefined && !['connection', 'transfer-encoding', 'keep-alive'].includes(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    }
    upstreamResponse.pipe(res);
  });

  upstream.on('timeout', () => upstream.destroy(new Error('Enzonic backend request timed out')));
  upstream.on('error', (error) => {
    console.error('[SITE PROXY] Enzonic backend request failed:', error.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'ZERON backend is temporarily unavailable.' });
    } else {
      res.destroy(error);
    }
  });
  req.pipe(upstream);
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`ZERON Wispbyte site listening on port ${port}`);
  console.log(`Dashboard API upstream: https://${backend.host}`);
});

server.on('error', (error) => {
  console.error('[PUBLIC SITE] Failed to listen:', error);
  process.exitCode = 1;
});

function shutdown(signal) {
  console.log(`Received ${signal}; stopping ZERON public site.`);
  server.close(() => process.exit(0));
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
