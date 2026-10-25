import { describe, expect, it } from 'vitest';
import { useTestApp } from './helpers.js';

const t = useTestApp();

describe('security regressions', () => {
  it('cannot reach the API by percent-encoding the path', async () => {
    for (const url of ['/%61pi/campaigns', '/%61%70%69/config', '/ap%69/campaigns']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).not.toBe(200);
    }
    const del = await t.app.inject({ method: 'DELETE', url: '/%61pi/campaigns/00000000-0000-4000-8000-000000000000' });
    expect([401, 404]).toContain(del.statusCode);
  });

  it('does not accept the login-state cookie as a session', async () => {
    const start = await t.app.inject({ method: 'GET', url: '/auth/login' });
    const loginCookie = start.cookies.find((c) => c.name === 'qrd_login')!.value;
    const res = await t.app.inject({ method: 'GET', url: '/api/campaigns', cookies: { qrd_session: loginCookie } });
    expect(res.statusCode).toBe(401);
    const me = await t.app.inject({ method: 'GET', url: '/api/me', cookies: { qrd_session: loginCookie } });
    expect(me.statusCode).toBe(401);
  });

  it('never redirects off-site after sign-in', async () => {
    for (const returnTo of ['/%09/evil.com', '/%0A/evil.com', '/\t/evil.com', '//evil.com', '/%5Cevil.com']) {
      const start = await t.app.inject({ method: 'GET', url: `/auth/login?returnTo=${returnTo}` });
      const state = new URL(String(start.headers.location)).searchParams.get('state');
      const cb = await t.app.inject({
        method: 'GET',
        url: `/auth/callback?state=${state}&email=a@example.com`,
        cookies: { qrd_login: start.cookies.find((c) => c.name === 'qrd_login')!.value },
      });
      expect(cb.statusCode, returnTo).toBe(302);
      expect(cb.headers.location, returnTo).toBe('/app');
    }
  });
});

describe('resource limits', () => {
  it('ignores oversized pass-through UTM tags from visitors', async () => {
    const c = await t.api<{ links: Array<{ code: string }> }>('POST', '/api/campaigns', {
      name: 'x',
      destinationUrl: 'https://example.com/',
      links: [{ sourceLabel: 'a', code: 'utm-cap', utm: { source: 'poster' } }],
    });
    expect(c.status).toBe(201);
    const big = 'a'.repeat(3000);
    const res = await t.app.inject({ method: 'GET', url: `/utm-cap?utm_source=${big}&utm_medium=${big}&utm_term=ok` });
    expect(res.headers.location).toBe('https://example.com/?utm_source=poster&utm_term=ok');
    const hit = await t.db.selectFrom('hits').select('destination_url').executeTakeFirstOrThrow();
    expect(hit.destination_url.length).toBeLessThan(200);
  });

  it('streams CSV exports across multiple pages', async () => {
    const c = await t.api<{ id: string; links: Array<{ id: string }> }>('POST', '/api/campaigns', {
      name: 'Bulk',
      destinationUrl: 'https://example.com/',
    });
    const rows = Array.from({ length: 4500 }, (_, i) => ({
      link_id: c.body.links[0]!.id,
      campaign_id: c.body.id,
      visitor_hash: `v${i}`,
      device_type: 'mobile',
      is_bot: false,
      query: '{}',
      destination_url: 'https://example.com/',
    }));
    await t.db.insertInto('hits').values(rows).execute();
    const csv = await t.api<string>('GET', `/api/campaigns/${c.body.id}/hits.csv`);
    expect(csv.status).toBe(200);
    const lines = csv.body.trim().split('\r\n');
    expect(lines).toHaveLength(4501);
    expect(new Set(lines.slice(1).map((l) => l.split(',')[17])).size).toBe(4500);
  });
});
