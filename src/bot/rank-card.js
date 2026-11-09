const p = require('pureimage');
const https = require('https');
const { Readable, PassThrough } = require('stream');

const W = 1200;
const H = 360;
const SCALE = 1.25;

const DEFAULT_ACCENT = '#46BBFF';
const BG = '#0c0a12';
const CARD = '#15121f';
const TRACK = '#2a2538';
const WHITE = '#f5f5f7';
const MUTED = '#9b95aa';

const font = p.registerFont(
  require('path').join(__dirname, '../../assets/fonts/DejaVuSans.ttf'),
  'Roboto'
);
font.loadSync();

// Finished cards are cached. The key includes every value shown on the card,
// so a cached image is only reused when it would look exactly the same.
const cache = new Map();
const CACHE_LIMIT = 80;
const CACHE_BYTES_LIMIT = 24 * 1024 * 1024;
let cacheBytes = 0;

function parseHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Blends two hex colors. t = 0 gives a, t = 1 gives b.
function mix(a, b, t) {
  const pa = parseHex(a);
  const pb = parseHex(b);
  return '#' + pa
    .map((value, i) => Math.round(value + (pb[i] - value) * t).toString(16).padStart(2, '0'))
    .join('');
}

function download(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req = https.get(url, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return fail(new Error('Avatar HTTP ' + res.statusCode));
      }
      const chunks = [];
      let total = 0;
      res.on('data', chunk => {
        total += chunk.length;
        if (total > 2 * 1024 * 1024) {
          req.destroy(new Error('Avatar image is too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks));
      });
      res.on('error', fail);
    });
    req.setTimeout(8000, () => req.destroy(new Error('Avatar download timed out')));
    req.on('error', fail);
  });
}
const avatarDownloadInflight = new Map();
function downloadAvatar(url) {
  if (avatarDownloadInflight.has(url)) return avatarDownloadInflight.get(url);
  const task = download(url).finally(() => avatarDownloadInflight.delete(url));
  avatarDownloadInflight.set(url, task);
  return task;
}

function panel(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function text(ctx, value, x, y, size, color) {
  ctx.font = `${size}pt Roboto`;
  ctx.fillStyle = color;
  ctx.fillText(String(value), x, y);
}

function centerText(ctx, value, cx, y, size, color) {
  ctx.font = `${size}pt Roboto`;
  const str = String(value);
  let width = str.length * size * 0.6;
  try {
    width = ctx.measureText(str).width;
  } catch (e) {
    // Fall back to the estimate above if measuring is not available.
  }
  ctx.fillStyle = color;
  ctx.fillText(str, cx - width / 2, y);
}

// Static layers and the PNG atlas are decoded once and reused by the worker.
let staticLayers = null;
async function loadStaticLayers() {
  if (!staticLayers) {
    const fs = require('fs');
    const dir = require('path').join(__dirname, '../assets/rank-card');
    const [base, panels] = await Promise.all(
      ['glass-base.png', 'glass-panels.png'].map(async name => {
        try {
          const bytes = fs.readFileSync(require('path').join(dir, name));
          return await p.decodePNGFromStream(Readable.from([bytes]));
        } catch (error) {
          throw new Error('Rank-card asset ' + name + ' failed to decode: ' + error.message);
        }
      })
    );
    staticLayers = { base, panels };
  }
  return staticLayers;
}

// Decoded avatars are kept in a bounded cache; concurrent requests for the
// same avatar share one decode/download operation.
const avatarCache = new Map();
const avatarInflight = new Map();
async function getAvatar(url, suppliedBytes) {
  if (avatarCache.has(url)) {
    const cached = avatarCache.get(url);
    avatarCache.delete(url);
    avatarCache.set(url, cached);
    return cached;
  }
  if (avatarInflight.has(url)) return avatarInflight.get(url);
  const task = (async () => {
    const bytes = suppliedBytes ? Buffer.from(suppliedBytes) : await download(url);
    const avatar = await p.decodePNGFromStream(Readable.from([bytes]));
    avatarCache.set(url, avatar);
    while (avatarCache.size > 40) avatarCache.delete(avatarCache.keys().next().value);
    return avatar;
  })();
  avatarInflight.set(url, task);
  try {
    return await task;
  } finally {
    avatarInflight.delete(url);
  }
}

function cacheSet(key, value) {
  const previous = cache.get(key);
  if (previous) cacheBytes -= previous.length;
  cache.delete(key);
  cache.set(key, value);
  cacheBytes += value.length;
  while (cache.size > CACHE_LIMIT || cacheBytes > CACHE_BYTES_LIMIT) {
    const [oldKey, oldValue] = cache.entries().next().value;
    cache.delete(oldKey);
    cacheBytes -= oldValue.length;
  }
}

const RANK_BACKGROUND_PRESETS = [
  { id: 'midnight', name: 'Midnight' },
  { id: 'aurora', name: 'Aurora' },
  { id: 'sunset', name: 'Sunset' },
  { id: 'ocean', name: 'Ocean' }
];
const presetCache = new Map();

// Preset backgrounds ship with the bot; the file is read once and kept in memory.
function loadPresetBackground(id) {
  if (!RANK_BACKGROUND_PRESETS.some(item => item.id === id)) return null;
  if (!presetCache.has(id)) {
    presetCache.set(id, require('fs').readFileSync(require('path').join(__dirname, '../assets/rank-backgrounds', id + '.png')));
  }
  return presetCache.get(id);
}

// Custom backgrounds are PNG or JPEG, detected by their first bytes.
async function decodeBackground(buffer) {
  // Worker-thread structured cloning converts Buffers into Uint8Arrays.
  // PureImage's stream decoders expect Node Buffers, so restore the type
  // before passing preset/custom background bytes into the decoder.
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const stream = Readable.from([bytes]);
  return bytes[0] === 0x89 ? p.decodePNGFromStream(stream) : p.decodeJPEGFromStream(stream);
}

const decodedCache = new Map();
async function decodedBackground(background) {
  if (decodedCache.has(background.key)) return decodedCache.get(background.key);
  const image = await decodeBackground(background.buffer);
  decodedCache.set(background.key, image);
  if (decodedCache.size > 20) decodedCache.delete(decodedCache.keys().next().value);
  return image;
}

// Render one card at a time to protect the 35% CPU allocation, but bound the
// waiting queue so a burst cannot build an endless backlog.
const renderQueue = { tail: Promise.resolve() };
const MAX_PENDING_RENDER_JOBS = 8;
let pendingRenderJobs = 0;

// Heavy drawing stays in a worker so Discord interactions remain responsive.
const { Worker } = require('worker_threads');
let rankWorker = null;
let jobId = 0;
const jobs = new Map();

function getRankWorker() {
  if (rankWorker) return rankWorker;
  const worker = new Worker(require('path').join(__dirname, 'rank-worker.js'));
  rankWorker = worker;
  worker.on('message', msg => {
    const job = jobs.get(msg.id);
    if (!job) return;
    jobs.delete(msg.id);
    if (msg.error) job.reject(new Error(msg.error));
    else job.resolve(Buffer.from(msg.buffer));
  });
  const reset = error => {
    for (const job of jobs.values()) job.reject(error);
    jobs.clear();
    if (rankWorker === worker) rankWorker = null;
  };
  worker.on('error', reset);
  worker.on('exit', () => reset(new Error('Rank worker stopped')));
  return worker;
}

function renderInWorker(options) {
  return new Promise((resolve, reject) => {
    const id = ++jobId;
    const worker = getRankWorker();
    const timer = setTimeout(() => {
      jobs.delete(id);
      reject(new Error('Rank card timed out'));
      if (rankWorker === worker) {
        rankWorker = null;
        worker.terminate().catch(() => {});
      }
    }, 25000);
    jobs.set(id, {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); }
    });
    try {
      const sourceUser = options.user;
      const safeOptions = {
        ...options,
        user: {
          id: String(sourceUser.id),
          username: sourceUser.username,
          globalName: sourceUser.globalName,
          avatarUrl: sourceUser.displayAvatarURL({ extension: 'png', size: 256 })
        }
      };
      worker.postMessage({ id, type: 'render', options: safeOptions });
    } catch (error) {
      jobs.delete(id);
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function renderRankCard(options) {
  if (pendingRenderJobs >= MAX_PENDING_RENDER_JOBS) {
    throw new Error('Rank card queue is full');
  }
  pendingRenderJobs++;
  try {
    const run = renderQueue.tail.then(() => renderInWorker(options));
    renderQueue.tail = run.catch(() => {});
    return await run;
  } finally {
    pendingRenderJobs--;
  }
}

function drawAccentRing(ctx, color, cx, cy, radius) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.62)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.72;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 2, Math.PI * 0.15, Math.PI * 0.82);
  ctx.stroke();
  ctx.restore();
}

function drawRankMedal(ctx, cx, cy, rank) {
  const colors = ['#f6c453', '#c9d4e3', '#c88755'];
  const color = colors[rank - 1];
  if (!color) return;
  ctx.save();
  ctx.fillStyle = '#5470a8';
  ctx.beginPath();
  ctx.moveTo(cx - 13, cy + 5);
  ctx.lineTo(cx - 2, cy + 5);
  ctx.lineTo(cx - 7, cy + 34);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#aa4b4b';
  ctx.beginPath();
  ctx.moveTo(cx + 2, cy + 5);
  ctx.lineTo(cx + 13, cy + 5);
  ctx.lineTo(cx + 8, cy + 34);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy - 4, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#181826';
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy - 4, 23, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 === 0 ? 13 : 6;
    const x = cx + Math.cos(angle) * radius;
    const y = cy - 4 + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

async function renderRankCardNow({
  user, displayName, xp, level, rank, xpIntoLevel, xpNeeded, accent, background, avatarBuffer
}) {
  const color = /^#[0-9a-fA-F]{6}$/.test(accent || '') ? accent : DEFAULT_ACCENT;
  const name = String(displayName || user.globalName || user.username || 'Discord User').slice(0, 24);
  const avatarUrl = user.avatarUrl || user.displayAvatarURL({ extension: 'png', size: 256 });
  const backgroundKey = background ? background.key : 'default';
  const cacheKey = [user.id, name, rank, level, xp, xpIntoLevel, xpNeeded, color, avatarUrl, backgroundKey].join('|');
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached;
  }

  const img = p.make(Math.round(W * SCALE), Math.round(H * SCALE));
  const ctx = img.getContext('2d');
  ctx.scale(SCALE, SCALE);

  const layers = await loadStaticLayers();

  // Background: the glass base, or the member's own image with the glass panels on top
  if (background && background.buffer) {
    try {
      const bgImage = await decodedBackground(background);
      ctx.drawImage(bgImage, 0, 0, W, H);
      ctx.fillStyle = 'rgba(12, 10, 18, 0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(layers.panels, 0, 0, W, H);
    } catch (error) {
      ctx.drawImage(layers.base, 0, 0, W, H);
    }
  } else {
    ctx.drawImage(layers.base, 0, 0, W, H);
  }

  // Avatar: accent halo, premium ring, then the picture
  ctx.fillStyle = mix(CARD, color, 0.35);
  ctx.beginPath();
  ctx.arc(165, 165, 110, 0, Math.PI * 2);
  ctx.fill();
  // Ring in the server's accent color, so the avatar matches the embed color of that server
  ctx.strokeStyle = color;
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.arc(165, 165, 96, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = mix(color, '#ffffff', 0.35);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(165, 165, 104, 0, Math.PI * 2);
  ctx.stroke();

  try {
    const avatar = await getAvatar(avatarUrl, avatarBuffer);
    ctx.save();
    ctx.beginPath();
    ctx.arc(165, 165, 84, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, 81, 81, 168, 168);
    ctx.restore();
  } catch (err) {
    console.error('Rank card avatar error:', err.message);
    ctx.fillStyle = TRACK;
    ctx.beginPath();
    ctx.arc(165, 165, 84, 0, Math.PI * 2);
    ctx.fill();
    centerText(ctx, name[0].toUpperCase(), 165, 178, 48, WHITE);
  }

  // Name and header
  text(ctx, 'ZERON RANK', 300, 92, 15, color);
  text(ctx, name, 300, 136, 36, WHITE);

  // Three stats
  text(ctx, 'RANK', 300, 192, 15, MUTED);
  text(ctx, `#${rank}`, 300, 238, 34, WHITE);
  text(ctx, 'TOTAL XP', 500, 192, 15, MUTED);
  text(ctx, Number(xp).toLocaleString('en-US'), 500, 238, 34, WHITE);
  const progress = xpNeeded > 0 ? Math.max(0, Math.min(1, xpIntoLevel / xpNeeded)) : 1;
  text(ctx, 'PROGRESS', 700, 192, 15, MUTED);
  text(ctx, `${Math.round(progress * 100)}%`, 700, 238, 34, color);

  // Progress bar and its label
  panel(ctx, 300, 266, 460, 14, 7, TRACK);
  if (progress > 0) panel(ctx, 300, 266, Math.max(14, 460 * progress), 14, 7, color);
  text(
    ctx,
    `${Math.max(0, xpIntoLevel).toLocaleString('en-US')} / ${xpNeeded.toLocaleString('en-US')} XP to level ${Number(level) + 1}`,
    300, 312, 16, MUTED
  );

  // Level card on the right
  centerText(ctx, 'LEVEL', 992, 92, 15, MUTED);
  centerText(ctx, level, 992, 206, 92, color);
  panel(ctx, 862, 236, 260, 2, 1, TRACK);
  centerText(ctx, 'EXP', 992, 268, 15, MUTED);
  centerText(ctx, `${Math.max(0, xpIntoLevel).toLocaleString('en-US')} / ${xpNeeded.toLocaleString('en-US')}`, 992, 302, 22, WHITE);

  const output = new PassThrough();
  const chunks = [];
  output.on('data', chunk => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    output.on('finish', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
  });
  await p.encodePNGToStream(img, output);
  const buffer = await finished;
  cacheSet(cacheKey, buffer);
  return buffer;
}

// Drops every cached card for one member, so a background change shows on the next /rank.
function clearRankCardCache(userId) {
  if (rankWorker) rankWorker.postMessage({ type: 'clear', userId: String(userId) });
  for (const key of [...cache.keys()]) {
    if (key.startsWith(String(userId) + '|')) {
      const value = cache.get(key);
      if (value) cacheBytes -= value.length;
      cache.delete(key);
    }
  }
}

module.exports = { renderRankCard, renderRankCardNow, DEFAULT_ACCENT, RANK_BACKGROUND_PRESETS, loadPresetBackground, clearRankCardCache, downloadAvatar };
