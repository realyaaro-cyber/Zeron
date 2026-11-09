require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('./bot/client');
const { initializeDatabase } = require('./database/db');
const { createDashboard } = require('./dashboard/app');

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
const dbPath = path.resolve(process.env.DATABASE_PATH || './data/nexora.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = initializeDatabase(dbPath);
const client = createClient(db);
const app = createDashboard({ db, client });
const port = Number(process.env.PORT || 3000);

async function start() {
  await client.login(process.env.DISCORD_TOKEN);
  app.listen(port, '0.0.0.0', () => {
    console.log(`ZERON dashboard listening on port ${port}`);
  });
}
start().catch((err) => {
  console.error('ZERON failed to start:', err);
  process.exit(1);
});
process.on('SIGINT', () => { client.destroy(); db.close(); process.exit(0); });
process.on('SIGTERM', () => { client.destroy(); db.close(); process.exit(0); });
