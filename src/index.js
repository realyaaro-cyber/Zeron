require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('./bot/client');
const { initializeDatabase } = require('./database/db');
const { createDashboard } = require('./dashboard/app');
const { createEventService } = require('./events/service');

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI', 'BASE_URL', 'SESSION_SECRET'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and configure it before starting.');
  process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters.');
  process.exit(1);
}
const dbPath = path.resolve(process.env.DATABASE_PATH || './data/zeron.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = initializeDatabase(dbPath);
db.events = createEventService(db);
const client = createClient(db);
const app = createDashboard({ db, client });
const port = Number(process.env.PORT || 3000);

// Keep the dashboard available even if Discord Gateway login is delayed or fails.
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`ZERON dashboard listening on port ${port}`);
});
server.on('error', (err) => {
  console.error('ZERON dashboard failed to listen:', err);
  process.exitCode = 1;
});

// Temporary network diagnostic: check public Discord API reachability without using the bot token.
const https = require('node:https');
const discordApiCheck = https.get('https://discord.com/api/v10/gateway', (response) => {
  console.log(`[NETWORK CHECK] Discord API HTTP status: ${response.statusCode}`);
  response.resume();
});
discordApiCheck.setTimeout(10000, () => {
  console.error('[NETWORK CHECK] Discord API request timed out after 10 seconds.');
  discordApiCheck.destroy();
});
discordApiCheck.on('error', (error) => {
  console.error('[NETWORK CHECK] Discord API connection error:', error.code || error.message);
});

console.log('Connecting ZERON to the Discord Gateway...');
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('ZERON Discord login failed; dashboard will remain available:', err && err.stack ? err.stack : err);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down ZERON.`);
  client.destroy();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
