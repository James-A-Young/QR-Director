import { describe, expect, it } from 'vitest';
import type { AuthProvider } from '../src/auth/providers.js';
import { useTestApp } from './helpers.js';

/** Stub IdP that returns whatever identity the callback's `who` parameter names. */
const provider: AuthProvider = {
  kind: 'entra',
  async beginLogin(returnTo) {
    return { url: 'https://login.example/authorize', state: { state: 's1', nonce: 'n', verifier: 'v', returnTo } };
  },
  async completeLogin(url) {
    if (url.searchParams.get('code') !== 'good') throw new Error('bad code');
    const who = url.searchParams.get('who')!;
    return { oid: `oid-${who}`, email: `${who}`, name: who, groups: who.startsWith('member') ? ['grp-1'] : [] };
  },
};

const t = useTestApp({
  authProvider: provider,
  config: { AUTH_ALLOWED_EMAIL_DOMAINS: 'example.com', AUTH_REQUIRED_GROUP_ID: 'grp-1' },
});

async function callback(query: string) {
  const start = await t.app.inject({ method: 'GET', url: '/auth/login' });
  expect(start.headers.location).toBe('https://login.example/authorize');
  return t.app.inject({
    method: 'GET',
    url: `/auth/callback?${query}`,
    cookies: { qrd_login: start.cookies.find((c) => c.name === 'qrd_login')!.value },
  });
}

describe('sign-in policy', () => {
  it('admits members of the allowed domain and group', async () => {
    const res = await callback('code=good&who=member@example.com');
    expect(res.statusCode).toBe(302);
    expect(res.cookies.some((c) => c.name === 'qrd_session')).toBe(true);
  });

  it('refuses other domains and non-members', async () => {
    for (const who of ['member@other.com', 'guest@example.com']) {
      const res = await callback(`code=good&who=${who}`);
      expect(res.statusCode).toBe(403);
      expect(res.cookies.some((c) => c.name === 'qrd_session')).toBe(false);
    }
    expect(await t.db.selectFrom('users').selectAll().execute()).toHaveLength(0);
  });

  it('handles IdP errors and failed code exchange', async () => {
    expect((await callback('error=access_denied&error_description=User+cancelled')).body).toContain('User cancelled');
    expect((await callback('code=bad&who=member@example.com')).statusCode).toBe(400);
  });

  it('updates the profile on repeat sign-in', async () => {
    await callback('code=good&who=member@example.com');
    await callback('code=good&who=member@example.com');
    expect(await t.db.selectFrom('users').selectAll().execute()).toHaveLength(1);
  });
});
