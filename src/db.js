import { Pool } from 'pg';

function buildConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquante');
  const useSSL = /sslmode=require/.test(url);
  return {
    connectionString: url,
    ssl: useSSL ? { rejectUnauthorized: false } : undefined, // Neon requiert SSL
    max: 5,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 10_000,
  };
}

const pool = new Pool(buildConfig());
export default pool;

// keepalive pour éviter l'endormissement
export function startDbKeepAlive() {
  setInterval(async () => {
    try { await pool.query('select 1'); } catch (e) {
      console.error('DB keepalive:', e.code || e.message);
    }
  }, 30_000);
}
