require('dotenv').config();

const { Pool } = require('pg');

const enabled = String(process.env.DB_MODE || 'postgres').toLowerCase() === 'postgres';
const pool = enabled && process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('supabase') ? { rejectUnauthorized: false } : false
}) : null;

async function testConnection() {
  if (!pool) {
    throw new Error('DB_MODE não está configurado para postgres ou DATABASE_URL não foi informado.');
  }

  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}

module.exports = { enabled, pool, testConnection };