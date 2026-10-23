import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal stateless signed cookies. Payloads are not secret (user id, name, OIDC state) but must not be
 * forgeable, so they carry an HMAC-SHA256 signature and an expiry. Stateless sessions suit Cloud Run,
 * where instances come and go.
 */
export class CookieSigner {
  constructor(private readonly secret: string) {}

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  seal(payload: object, ttlSeconds: number): string {
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString(
      'base64url',
    );
    return `${body}.${this.sign(body)}`;
  }

  unseal<T extends object>(value: string | undefined): T | null {
    if (!value) return null;
    const dot = value.lastIndexOf('.');
    if (dot <= 0) return null;
    const body = value.slice(0, dot);
    const sig = Buffer.from(value.slice(dot + 1));
    const expected = Buffer.from(this.sign(body));
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
    try {
      const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp?: number };
      if (typeof data.exp !== 'number' || data.exp < Date.now() / 1000) return null;
      return data;
    } catch {
      return null;
    }
  }
}

export interface SessionData {
  uid: string;
  name: string | null;
  email: string | null;
}

export const SESSION_COOKIE = 'qrd_session';
export const LOGIN_COOKIE = 'qrd_login';
