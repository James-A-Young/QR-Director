import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { DB } from './db/database.js';
import { CookieSigner, SESSION_COOKIE, type SessionData } from './auth/session.js';
import { DevAuthProvider, EntraAuthProvider, type AuthProvider } from './auth/providers.js';
import { authRoutes } from './auth/routes.js';
import { HttpError } from './http.js';
import { createGeoLookup, type GeoLookup } from './services/geo.js';
import { campaignRoutes } from './routes/campaigns.js';
import { templateRoutes } from './routes/templates.js';
import { assetRoutes } from './routes/assets.js';
import { qrRoutes } from './routes/qr.js';
import { statsRoutes } from './routes/stats.js';
import { redirectRoutes } from './routes/redirect.js';

export interface AppContext {
  config: Config;
  db: DB;
  signer: CookieSigner;
  geo: GeoLookup;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export interface BuildAppOptions {
  config: Config;
  db: DB;
  geo?: GeoLookup;
  authProvider?: AuthProvider;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { config, db } = opts;
  const app = Fastify({
    logger: opts.logger ?? false,
    // Trust exactly N proxy hops so a client cannot spoof its IP via X-Forwarded-For.
    trustProxy: config.TRUST_PROXY_HOPS > 0 ? (_addr: string, hop: number) => hop < config.TRUST_PROXY_HOPS : false,
    bodyLimit: 4 * 1024 * 1024,
    disableRequestLogging: false,
    // Short codes are case-insensitive and may arrive with a trailing slash from some scanners.
    routerOptions: { ignoreTrailingSlash: true },
  });

  app.decorate('ctx', {
    config,
    db,
    signer: new CookieSigner(config.SESSION_SECRET),
    geo: opts.geo ?? createGeoLookup(null),
  });

  await app.register(cookie);
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    req.user = app.ctx.signer.unseal<SessionData>(req.cookies[SESSION_COOKIE]);
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'", 'https://login.microsoftonline.com'],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.secureCookies ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.secureCookies,
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation_error', message: 'Request validation failed', details: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
    }
    req.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({ error: 'internal_error', message: 'Something went wrong' });
  });

  const provider =
    opts.authProvider ??
    (config.AUTH_MODE === 'dev' ? new DevAuthProvider(config.PUBLIC_BASE_URL) : new EntraAuthProvider(config));
  await app.register(authRoutes, { provider });

  // Liveness and readiness (Cloud Run startup/liveness probes).
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await db.selectNoFrom((eb) => eb.val(1).as('one')).execute();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  // Everything under /api requires a session; mutations also need a custom header, which cross-site
  // forms cannot send, as a CSRF guard on top of SameSite=Lax cookies.
  await app.register(async (api) => {
    api.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/api/')) return;
      if (!req.user) return reply.code(401).send({ error: 'unauthenticated', message: 'Sign in required' });
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-qrd-request'] !== '1') {
        return reply.code(403).send({ error: 'csrf', message: 'Missing X-QRD-Request header' });
      }
    });
    api.get('/api/config', async () => ({
      publicBaseUrl: config.PUBLIC_BASE_URL,
      authMode: config.AUTH_MODE,
      rawIpRetentionDays: config.RAW_IP_RETENTION_DAYS,
    }));
    await api.register(campaignRoutes);
    await api.register(templateRoutes);
    await api.register(assetRoutes);
    await api.register(qrRoutes);
    await api.register(statsRoutes);
  });

  // The single-page app, served from /app with history-API fallback.
  const webDir = config.WEB_DIST_DIR;
  if (webDir && existsSync(join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDir, prefix: '/app/', wildcard: false, index: false });
    const sendIndex = (_req: FastifyRequest, reply: FastifyReply) =>
      reply.header('cache-control', 'no-cache').sendFile('index.html', webDir);
    app.get('/app', sendIndex);
    app.get('/app/*', (req, reply) => {
      const path = (req.params as { '*': string })['*'];
      // Hashed build assets are immutable; anything else falls through to the SPA shell.
      if (path.startsWith('assets/') && existsSync(join(webDir, path))) {
        return reply.header('cache-control', 'public, max-age=31536000, immutable').sendFile(path, webDir);
      }
      if (/\.[a-z0-9]+$/i.test(path) && existsSync(join(webDir, path))) return reply.sendFile(path, webDir);
      return sendIndex(req, reply);
    });
  }

  app.get('/robots.txt', async (_req, reply) => reply.type('text/plain').send('User-agent: *\nDisallow: /\n'));

  // Must be last: catches /:code.
  await app.register(redirectRoutes);

  return app;
}
