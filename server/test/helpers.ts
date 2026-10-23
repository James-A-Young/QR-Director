import type { FastifyInstance, InjectOptions } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createDatabase, migrateToLatest, type DB } from '../src/db/database.js';
import type { AuthProvider } from '../src/auth/providers.js';
import type { GeoLookup } from '../src/services/geo.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/qrdirector_test';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_BASE_URL: 'https://go.example.com',
    SESSION_SECRET: 'test-secret-test-secret-test-secret!',
    AUTH_MODE: 'dev',
    TRUST_PROXY_HOPS: '1',
    ...overrides,
  });
}

export interface TestContext {
  app: FastifyInstance;
  db: DB;
  config: Config;
  /** Sign in through the real dev login flow and return the session cookie header. */
  login(email?: string, name?: string): Promise<string>;
  /** Authenticated JSON request helper. */
  api<T = unknown>(method: InjectOptions['method'], url: string, body?: unknown, cookie?: string): Promise<{ status: number; body: T; headers: Record<string, unknown> }>;
}

/**
 * Registers hooks that build an app against the test database. Tables are truncated before each
 * test so every test starts from a clean slate.
 */
export function useTestApp(opts: { config?: Record<string, string>; authProvider?: AuthProvider; geo?: GeoLookup } = {}): TestContext {
  const ctx = {} as TestContext;
  let defaultCookie: string | undefined;

  beforeAll(async () => {
    ctx.config = testConfig(opts.config);
    ctx.db = createDatabase({ connectionString: TEST_DATABASE_URL, max: 5 });
    await migrateToLatest(ctx.db);
    ctx.app = await buildApp({ config: ctx.config, db: ctx.db, authProvider: opts.authProvider, geo: opts.geo });
    await ctx.app.ready();
  });

  beforeEach(async () => {
    await sql`TRUNCATE users, assets, qr_templates, campaigns, links, hits, audit_log RESTART IDENTITY CASCADE`.execute(ctx.db);
    defaultCookie = undefined;
  });

  afterAll(async () => {
    await ctx.app?.close();
    await ctx.db?.destroy();
  });

  ctx.login = async (email = 'alex@example.com', name = 'Alex Example') => {
    const start = await ctx.app.inject({ method: 'GET', url: '/auth/login?returnTo=/app/campaigns' });
    const loginCookie = String(start.cookies.find((c) => c.name === 'qrd_login')?.value);
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    const cb = await ctx.app.inject({
      method: 'GET',
      url: `/auth/callback?state=${state}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`,
      cookies: { qrd_login: loginCookie },
    });
    const session = cb.cookies.find((c) => c.name === 'qrd_session');
    if (!session) throw new Error(`Login failed: ${cb.statusCode} ${cb.body}`);
    return `qrd_session=${session.value}`;
  };

  ctx.api = async (method, url, body, cookie) => {
    if (!cookie) defaultCookie ??= await ctx.login();
    const res = await ctx.app.inject({
      method,
      url,
      headers: { cookie: cookie ?? defaultCookie!, 'x-qrd-request': '1', ...(body !== undefined && { 'content-type': 'application/json' }) },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
    const isJson = String(res.headers['content-type'] ?? '').includes('application/json');
    return { status: res.statusCode, body: (isJson ? res.json() : res.body) as never, headers: res.headers };
  };

  return ctx;
}

export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
export const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
