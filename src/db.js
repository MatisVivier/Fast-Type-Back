// serveur/src/db.js
import mysql from 'mysql2/promise';

function buildConfig() {
  // 1) Supporte DATABASE_URL (= mysql://user:pass@host:port/db)
  const url = process.env.DATABASE_URL || process.env.MYSQL_URL;
  let cfg;
  if (url) {
    const u = new URL(url);
    cfg = {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  } else {
    // 2) Variables séparées
    cfg = {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    };
  }

  // 3) SSL robuste pour Railway
  //    - Si tu fournis une CA (DB_SSL_CA_B64), on vérifie la chaîne
  //    - Sinon, on accepte le cert auto-signé (rejectUnauthorized:false)
  const wantSSL =
    (process.env.DB_SSL || 'false') === 'true' ||
    /\.rlwy\.net$/i.test(cfg.host) ||
    /\.railway\.app$/i.test(cfg.host);

  if (wantSSL) {
    if (process.env.DB_SSL_CA_B64) {
      cfg.ssl = {
        ca: Buffer.from(process.env.DB_SSL_CA_B64, 'base64').toString('utf8'),
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      };
    } else {
      cfg.ssl = { rejectUnauthorized: false, minVersion: 'TLSv1.2' };
    }
  }

  // 4) Réglages de stabilité
  cfg.waitForConnections = true;
  cfg.connectionLimit = 5;
  cfg.maxIdle = 2;
  cfg.idleTimeout = 60_000;
  cfg.queueLimit = 0;
  cfg.enableKeepAlive = true;
  cfg.keepAliveInitialDelay = 10_000;
  cfg.connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000);
  cfg.acquireTimeout = Number(process.env.DB_ACQUIRE_TIMEOUT_MS || 10000);
  cfg.dateStrings = true;
  cfg.timezone = 'Z';
  return cfg;
}

let pool;
function getPool() {
  if (!pool) pool = mysql.createPool(buildConfig());
  return pool;
}

const exported = getPool();
export default exported;

export function startDbKeepAlive() {
  const p = getPool();
  setInterval(async () => {
    try {
      await p.query('SELECT 1');
    } catch (e) {
      console.error('DB keepalive error:', e.code || e.message);
    }
  }, 30_000);
}
