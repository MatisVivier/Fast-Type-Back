// server/db.js
import pg from 'pg';

const { Pool } = pg;

function buildConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquante');

  // Neon exige SSL ; beaucoup d’URLs Neon incluent ?sslmode=require
  const useSSL = /sslmode=require/i.test(url) || /\.neon\.tech/i.test(url);

  // Optionnel : application_name visible côté serveur
  const applicationName =
    process.env.PG_APP_NAME ||
    `fast-type-back-${process.env.NODE_ENV || 'dev'}`;

  return {
    connectionString: url,
    ssl: useSSL ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.PG_POOL_MAX || 10),          // connexions max dans le pool
    idleTimeoutMillis: Number(process.env.PG_IDLE_MS || 60_000),
    connectionTimeoutMillis: Number(process.env.PG_CONN_MS || 10_000),
    allowExitOnIdle: false,
    statement_timeout: Number(process.env.PG_STMT_TIMEOUT || 30_000), // côté serveur
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT || 30_000),    // côté client
    application_name: applicationName,
  };
}

const pool = new Pool(buildConfig());
export default pool;

/**
 * Helper transactionnel :
 * await pool.tx(async (client) => {
 *   const { rows } = await client.query('SELECT 1');
 *   return rows[0];
 * });
 */
pool.tx = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
};

// keepalive pour éviter l’endormissement des connexions (pratique sur Render/Neon)
export function startDbKeepAlive() {
  const interval = Number(process.env.DB_KEEPALIVE_MS || 30_000);
  setInterval(async () => {
    try {
      await pool.query('SELECT 1');
    } catch (e) {
      console.error('DB keepalive:', e.code || e.message);
    }
  }, interval);
}

// (optionnel) petit utilitaire de requête avec log en dev
export async function q(text, params) {
  const t0 = Date.now();
  try {
    const res = await pool.query(text, params);
    if (process.env.NODE_ENV !== 'production' && process.env.DB_LOG === '1') {
      console.log(`[pg] ${Date.now() - t0}ms :: ${text.split('\n')[0]}`);
    }
    return res;
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[pg error]', e);
    }
    throw e;
  }
}
