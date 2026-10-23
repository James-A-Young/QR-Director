import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isIdentityAllowed, type AuthProvider, type LoginState } from './providers.js';
import { LOGIN_COOKIE, SESSION_COOKIE, type SessionData } from './session.js';
import { errorPage } from '../pages.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionData | null;
  }
}

/** Only allow returning to same-origin paths, never `//host` or `/\host`, to avoid open redirects. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/app';
  }
  return value.slice(0, 512);
}

export async function authRoutes(app: FastifyInstance, opts: { provider: AuthProvider }) {
  const { config, signer, db } = app.ctx;
  const cookieOpts = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.secureCookies,
  };

  app.get('/auth/login', async (req: FastifyRequest<{ Querystring: { returnTo?: string } }>, reply) => {
    const { url, state } = await opts.provider.beginLogin(safeReturnTo(req.query.returnTo));
    reply.setCookie(LOGIN_COOKIE, signer.seal(state, 600), { ...cookieOpts, maxAge: 600 });
    return reply.redirect(url);
  });

  const fail = (reply: FastifyReply, status: number, message: string) =>
    reply.code(status).type('text/html').send(errorPage('Sign-in failed', message, '/auth/login', 'Try again'));

  app.get('/auth/callback', async (req, reply) => {
    const state = signer.unseal<LoginState>(req.cookies[LOGIN_COOKIE]);
    reply.clearCookie(LOGIN_COOKIE, { path: '/' });
    const query = req.query as Record<string, string | undefined>;
    if (query.error) {
      req.log.warn({ error: query.error, description: query.error_description }, 'IdP returned an error');
      return fail(reply, 400, query.error_description ?? query.error);
    }
    if (!state) return fail(reply, 400, 'Your sign-in session expired. Please try again.');

    let identity;
    try {
      identity = await opts.provider.completeLogin(new URL(req.url, config.PUBLIC_BASE_URL), state);
    } catch (err) {
      req.log.warn({ err }, 'Login callback failed');
      return fail(reply, 400, 'We could not verify your Microsoft sign-in.');
    }
    if (!isIdentityAllowed(identity, config)) {
      req.log.warn({ email: identity.email }, 'Sign-in refused by allow-list');
      return fail(reply, 403, `${identity.email ?? 'This account'} is not permitted to use QR Director.`);
    }

    const user = await db
      .insertInto('users')
      .values({ entra_oid: identity.oid, email: identity.email, name: identity.name, last_login_at: new Date() })
      .onConflict((oc) =>
        oc.column('entra_oid').doUpdateSet({ email: identity.email, name: identity.name, last_login_at: new Date() }),
      )
      .returning(['id', 'name', 'email'])
      .executeTakeFirstOrThrow();

    const ttl = Math.round(config.SESSION_TTL_HOURS * 3600);
    const session: SessionData = { uid: user.id, name: user.name, email: user.email };
    reply.setCookie(SESSION_COOKIE, signer.seal(session, ttl), { ...cookieOpts, maxAge: ttl });
    return reply.redirect(safeReturnTo(state.returnTo));
  });

  const logout = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/app/login');
  };
  app.get('/auth/logout', logout);
  app.post('/auth/logout', logout);

  if (opts.provider.kind === 'dev') {
    app.get('/auth/dev-login', async (req: FastifyRequest<{ Querystring: { state?: string } }>, reply) => {
      const state = String(req.query.state ?? '').replace(/[^A-Za-z0-9_-]/g, '');
      return reply.type('text/html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Dev sign-in</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui;background:#f8fafc;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 1px 3px #0002;display:grid;gap:.75rem;width:320px}
input,button{font:inherit;padding:.6rem;border-radius:8px;border:1px solid #cbd5e1}button{background:#4f46e5;color:#fff;border:0}</style></head>
<body><form action="/auth/callback" method="get"><h2 style="margin:0">Development sign-in</h2>
<p style="margin:0;color:#64748b;font-size:.9rem">AUTH_MODE=dev. Microsoft sign-in is disabled.</p>
<input type="hidden" name="state" value="${state}">
<input name="email" type="email" value="dev@example.com" required aria-label="Email">
<input name="name" value="Dev User" aria-label="Name"><button type="submit">Sign in</button></form></body></html>`);
    });
  }

  app.get('/api/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
    return { id: req.user.uid, name: req.user.name, email: req.user.email, authMode: opts.provider.kind };
  });
}
