'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const path = require('node:path');

const app = express();
const publicDir = path.resolve(__dirname, '../public');
const port = Number(process.env.PORT || 3000);

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

app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'zeron-public-site' }));

app.get(['/privacy', '/privacy.html'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'privacy-zeron.html'));
});

app.get(['/terms', '/terms.html', '/tos', '/tos.html'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'tos.html'));
});

app.use(express.static(publicDir, {
  index: 'index.html',
  dotfiles: 'deny',
  fallthrough: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    } else if (/\.(?:js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

app.use((err, _req, res, _next) => {
  if (err.status === 404 || err.statusCode === 404) {
    return res.status(404).sendFile(path.join(publicDir, '404.html'), (sendError) => {
      if (sendError) res.status(404).type('text').send('Page not found.');
    });
  }
  console.error('[PUBLIC SITE] Request failed:', err.message);
  res.status(500).type('text').send('The site could not complete this request.');
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`ZERON public site listening on port ${port}`);
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
