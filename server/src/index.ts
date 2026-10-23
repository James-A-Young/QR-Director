import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase, migrateToLatest } from './db/database.js';
import { loadGeoLookup } from './services/geo.js';
import { applyRetention } from './services/retention.js';

// Google Cloud Logging reads `severity` rather than pino's numeric `level`.
const SEVERITY: Record<string, string> = {
  trace: 'DEBUG', debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR', fatal: 'CRITICAL',
};

async function main() {
  const config = loadConfig();
  const logger = pino({
    level: config.LOG_LEVEL,
    messageKey: 'message',
    formatters: { level: (label) => ({ severity: SEVERITY[label] ?? 'DEFAULT', level: label }) },
    redact: ['req.headers.cookie', 'req.headers.authorization'],
  });

  const db = createDatabase({ connectionString: config.DATABASE_URL, max: config.DATABASE_POOL_MAX, ssl: config.DATABASE_SSL });
  if (config.RUN_MIGRATIONS) {
    const applied = await migrateToLatest(db);
    if (applied.length) logger.info({ applied }, 'Applied database migrations');
  }

  if (!config.WEB_DIST_DIR) {
    config.WEB_DIST_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));
  }
  if (config.AUTH_MODE === 'dev') logger.warn('AUTH_MODE=dev: anyone can sign in with any e-mail. Never use this in production.');

  const geo = await loadGeoLookup(config.GEOIP_DB_PATH, logger);
  const app = await buildApp({ config, db, geo, logger });

  const runRetention = async () => {
    try {
      const result = await applyRetention(db, { rawIpDays: config.RAW_IP_RETENTION_DAYS, hitDays: config.HIT_RETENTION_DAYS });
      if (result.ipsCleared || result.hitsDeleted) logger.info(result, 'Applied data retention');
    } catch (err) {
      logger.error({ err }, 'Retention job failed');
    }
  };
  void runRetention();
  const retentionTimer = setInterval(runRetention, 6 * 3600_000);
  retentionTimer.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    clearInterval(retentionTimer);
    try {
      await app.close();
      await db.destroy();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
