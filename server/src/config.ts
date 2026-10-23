import { z } from 'zod';

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_SSL: booleanish.default(false),

  /** Public origin used for short links, QR content and the OAuth redirect URI, e.g. https://go.example.com */
  PUBLIC_BASE_URL: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, '')),

  /** Secret used to sign session cookies and salt visitor hashes. At least 32 characters. */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),

  AUTH_MODE: z.enum(['entra', 'dev']).default('entra'),
  AZURE_TENANT_ID: optionalString,
  AZURE_CLIENT_ID: optionalString,
  AZURE_CLIENT_SECRET: optionalString,
  /** Optional comma separated list of e-mail domains allowed to sign in (e.g. "example.com,example.co.uk"). */
  AUTH_ALLOWED_EMAIL_DOMAINS: optionalString,
  /** Optional Entra group object id; when set only members of that group may sign in. Requires the groups claim. */
  AUTH_REQUIRED_GROUP_ID: optionalString,

  /** Number of reverse proxies in front of the app (Cloud Run = 1, Cloud Run behind a load balancer = 2). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

  /** Optional path to a MaxMind GeoLite2/GeoIP2 City .mmdb file for IP geolocation. */
  GEOIP_DB_PATH: optionalString,

  /** Days to keep raw IP addresses on hits before they are blanked. 0 keeps them forever. */
  RAW_IP_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
  /** Days to keep hit records at all. 0 keeps them forever. */
  HIT_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),

  /** Where to send visitors for the bare domain ("/"). Defaults to the app. */
  ROOT_REDIRECT_URL: optionalString,
  /** Where to send visitors for unknown or paused codes. Defaults to a built-in page. */
  NOT_FOUND_REDIRECT_URL: optionalString,

  /** Encode QR content as upper case so it fits the compact alphanumeric QR mode (codes are case-insensitive). */
  QR_UPPERCASE_URLS: booleanish.default(true),

  /** Directory containing the built web UI. */
  WEB_DIST_DIR: optionalString,

  RUN_MIGRATIONS: booleanish.default(true),
});

export type Config = z.infer<typeof envSchema> & {
  allowedEmailDomains: string[];
  secureCookies: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const cfg = parsed.data;

  if (cfg.AUTH_MODE === 'entra') {
    const missing = (['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'] as const).filter((k) => !cfg[k]);
    if (missing.length > 0) {
      throw new Error(
        `Invalid configuration:\n  - ${missing.join(', ')} must be set when AUTH_MODE=entra (use AUTH_MODE=dev for local development)`,
      );
    }
  }
  if (cfg.AUTH_MODE === 'dev' && cfg.NODE_ENV === 'production') {
    throw new Error('Invalid configuration:\n  - AUTH_MODE=dev is not permitted when NODE_ENV=production');
  }

  return {
    ...cfg,
    allowedEmailDomains: (cfg.AUTH_ALLOWED_EMAIL_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    secureCookies: cfg.PUBLIC_BASE_URL.startsWith('https://'),
  };
}
