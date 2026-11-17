require('dotenv').config();

const mysql = require('mysql2/promise');

const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`Missing MySQL environment variables: ${missing.join(', ')}`);
  console.error('Set these in your hosting panel. Do not paste database passwords into chat or commit them to GitHub.');
  process.exit(1);
}

async function main() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      connectTimeout: 10000,
      ...(process.env.MYSQL_SSL === 'true' ? { ssl: {} } : {})
    });

    const [rows] = await connection.query('SELECT DATABASE() AS databaseName, 1 AS connectionOk');
    console.log('[MYSQL CHECK] Connection successful.');
    console.log('[MYSQL CHECK] Selected database:', rows[0].databaseName);
    console.log('[MYSQL CHECK] Credentials were not printed.');
  } catch (error) {
    console.error('[MYSQL CHECK] Connection failed:', error.code || error.message);
    console.error('[MYSQL CHECK] Check host, port, database, username, password, and the provider remote-access allowlist.');
    process.exitCode = 1;
  } finally {
    if (connection) await connection.end();
  }
}

main();
