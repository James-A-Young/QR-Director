import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { ANDROID_UA, DESKTOP_UA, IPHONE_UA, useTestApp } from './helpers.js';
import { decodePng } from './qr-decode.js';
import { applyRetention } from '../src/services/retention.js';

const t = useTestApp();

interface LinkDto {
  id: string;
  code: string;
  shortUrl: string;
  sourceLabel: string;
  destinationUrl: string | null;
  effectiveDestinationUrl: string;
  active: boolean;
  stats: { hits: number; uniqueVisitors: number };
  qrStyle: { modules: { shape: string } };
}
interface CampaignDto {
  id: string;
  name: string;
  destinationUrl: string;
  archived: boolean;
  links: LinkDto[];
}

async function createCampaign(body: Record<string, unknown> = {}) {
  const res = await t.api<CampaignDto>('POST', '/api/campaigns', {
    name: 'Spring launch',
    destinationUrl: 'https://example.com/spring',
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

function visit(code: string, headers: Record<string, string> = {}, query = '') {
  return t.app.inject({
    method: 'GET',
    url: `/${code}${query}`,
    headers: { 'user-agent': IPHONE_UA, 'x-forwarded-for': '203.0.113.7', ...headers },
  });
}

describe('authentication', () => {
  it('rejects anonymous API calls', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/campaigns' });
    expect(res.statusCode).toBe(401);
  });

  it('requires the CSRF header on mutations', async () => {
    const cookie = await t.login();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'x', destinationUrl: 'https://example.com' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('signs in, creates the user and returns to the requested page', async () => {
    const start = await t.app.inject({ method: 'GET', url: '/auth/login?returnTo=/app/templates' });
    expect(start.statusCode).toBe(302);
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    const cb = await t.app.inject({
      method: 'GET',
      url: `/auth/callback?state=${state}&email=sam@example.com&name=Sam`,
      cookies: { qrd_login: start.cookies.find((c) => c.name === 'qrd_login')!.value },
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('/app/templates');
    const session = cb.cookies.find((c) => c.name === 'qrd_session')!;
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite).toBe('Lax');
    expect(session.secure).toBe(true);

    const me = await t.app.inject({ method: 'GET', url: '/api/me', cookies: { qrd_session: session.value } });
    expect(me.json()).toMatchObject({ email: 'sam@example.com', name: 'Sam' });
    const users = await t.db.selectFrom('users').selectAll().execute();
    expect(users).toHaveLength(1);
  });

  it('rejects a callback without login state', async () => {
    const cb = await t.app.inject({ method: 'GET', url: '/auth/callback?state=abc&email=x@example.com' });
    expect(cb.statusCode).toBe(400);
    expect(cb.cookies.find((c) => c.name === 'qrd_session')).toBeUndefined();
  });

  it('rejects a forged session cookie', async () => {
    const forged = Buffer.from(JSON.stringify({ uid: 'x', exp: 9e9 })).toString('base64url');
    const res = await t.app.inject({ method: 'GET', url: '/api/me', cookies: { qrd_session: `${forged}.bad` } });
    expect(res.statusCode).toBe(401);
  });

  it('logs out only via POST with the CSRF header', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/auth/logout' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: '/auth/logout' })).statusCode).toBe(403);
    const res = await t.app.inject({ method: 'POST', url: '/auth/logout', headers: { 'x-qrd-request': '1' } });
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === 'qrd_session')?.value).toBe('');
  });
});

describe('campaigns and links', () => {
  it('creates a campaign with a default link', async () => {
    const c = await createCampaign();
    expect(c.links).toHaveLength(1);
    expect(c.links[0]).toMatchObject({ sourceLabel: 'Default', active: true, effectiveDestinationUrl: 'https://example.com/spring' });
    expect(c.links[0]!.shortUrl).toBe(`https://go.example.com/${c.links[0]!.code}`);
  });

  it('creates several source variants up front with custom codes', async () => {
    const c = await createCampaign({
      links: [
        { sourceLabel: 'NHS Expo stand', code: 'Expo-2026' },
        { sourceLabel: 'Brochure p.4', utm: { source: 'brochure', medium: 'print' } },
      ],
    });
    expect(c.links.map((l) => l.sourceLabel)).toEqual(['NHS Expo stand', 'Brochure p.4']);
    expect(c.links[0]!.code).toBe('expo-2026');
  });

  it('applies a template style to new campaigns and their links', async () => {
    const tpl = await t.api<{ id: string }>('POST', '/api/templates', { name: 'Brand', style: { modules: { shape: 'dots' } } });
    const c = await createCampaign({ templateId: tpl.body.id });
    expect(c.links[0]!.qrStyle.modules.shape).toBe('dots');
  });

  it('validates input', async () => {
    const bad = await t.api<{ error: string; details: Array<{ path: string }> }>('POST', '/api/campaigns', {
      name: '',
      destinationUrl: 'javascript:alert(1)',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.details.map((d) => d.path).sort()).toEqual(['destinationUrl', 'name']);
    const reserved = await t.api('POST', '/api/campaigns', {
      name: 'x',
      destinationUrl: 'https://example.com',
      links: [{ sourceLabel: 'a', code: 'api' }],
    });
    expect(reserved.status).toBe(400);
  });

  it('rejects duplicate codes', async () => {
    await createCampaign({ links: [{ sourceLabel: 'A', code: 'taken' }] });
    const c2 = await createCampaign();
    const dup = await t.api('POST', `/api/campaigns/${c2.id}/links`, { sourceLabel: 'B', code: 'TAKEN' });
    expect(dup.status).toBe(409);
    const rename = await t.api('PATCH', `/api/links/${c2.links[0]!.id}`, { code: 'taken' });
    expect(rename.status).toBe(409);
    const avail = await t.api<{ available: boolean; reason: string }>('GET', '/api/codes/taken');
    expect(avail.body).toMatchObject({ available: false, reason: 'taken' });
    const free = await t.api<{ available: boolean }>('GET', '/api/codes/free-one');
    expect(free.body.available).toBe(true);
  });

  it('rolls back the whole campaign when a variant code clashes', async () => {
    await createCampaign({ links: [{ sourceLabel: 'A', code: 'clash' }] });
    const res = await t.api('POST', '/api/campaigns', {
      name: 'Second',
      destinationUrl: 'https://example.com',
      links: [{ sourceLabel: 'ok', code: 'fresh' }, { sourceLabel: 'bad', code: 'clash' }],
    });
    expect(res.status).toBe(409);
    const campaigns = await t.db.selectFrom('campaigns').select('name').execute();
    expect(campaigns.map((c) => c.name)).toEqual(['Spring launch']);
    expect(await t.db.selectFrom('links').where('code', '=', 'fresh').selectAll().execute()).toHaveLength(0);
  });

  it('lists, searches and archives campaigns', async () => {
    const a = await createCampaign({ name: 'Trade show', links: [{ sourceLabel: 'Hall 3', code: 'hall3' }] });
    await createCampaign({ name: 'Newsletter' });
    const all = await t.api<Array<{ name: string; linkCount: number }>>('GET', '/api/campaigns');
    expect(all.body).toHaveLength(2);
    const search = await t.api<Array<{ name: string }>>('GET', '/api/campaigns?search=hall3');
    expect(search.body.map((c) => c.name)).toEqual(['Trade show']);
    const searchPct = await t.api<Array<{ name: string }>>('GET', '/api/campaigns?search=%25');
    expect(searchPct.body).toHaveLength(0);

    const archived = await t.api<CampaignDto>('PATCH', `/api/campaigns/${a.id}`, { archived: true });
    expect(archived.body.archived).toBe(true);
    expect((await t.api<unknown[]>('GET', '/api/campaigns')).body).toHaveLength(1);
    expect((await t.api<unknown[]>('GET', '/api/campaigns?archived=only')).body).toHaveLength(1);
  });

  it('deletes campaigns and links', async () => {
    const c = await createCampaign();
    const link = await t.api<LinkDto>('POST', `/api/campaigns/${c.id}/links`, { sourceLabel: 'Extra' });
    expect((await t.api('DELETE', `/api/links/${link.body.id}`)).status).toBe(204);
    expect((await t.api('DELETE', `/api/links/${link.body.id}`)).status).toBe(404);
    expect((await t.api('DELETE', `/api/campaigns/${c.id}`)).status).toBe(204);
    expect((await t.api('GET', `/api/campaigns/${c.id}`)).status).toBe(404);
    expect(await t.db.selectFrom('links').selectAll().execute()).toHaveLength(0);
  });

  it('records an audit trail of redirects', async () => {
    const c = await createCampaign();
    await t.api('PATCH', `/api/campaigns/${c.id}`, { destinationUrl: 'https://example.com/v2' });
    await t.api('PATCH', `/api/links/${c.links[0]!.id}`, { destinationUrl: 'https://example.com/special' });
    const history = await t.api<Array<{ action: string; entityType: string; details: Record<string, unknown>; userName: string }>>(
      'GET',
      `/api/campaigns/${c.id}/history`,
    );
    expect(history.body[0]).toMatchObject({
      entityType: 'link',
      details: { destinationUrl: { from: null, to: 'https://example.com/special' } },
      userName: 'Alex Example',
    });
    expect(history.body[1]).toMatchObject({
      entityType: 'campaign',
      details: { destinationUrl: { from: 'https://example.com/spring', to: 'https://example.com/v2' } },
    });
  });

  it('applies a style to every link in a campaign', async () => {
    const c = await createCampaign({ links: [{ sourceLabel: 'a' }, { sourceLabel: 'b' }] });
    const res = await t.api<CampaignDto>('POST', `/api/campaigns/${c.id}/apply-style`, { style: { modules: { shape: 'classy' } } });
    expect(res.body.links.every((l) => l.qrStyle.modules.shape === 'classy')).toBe(true);
  });
});

describe('redirects and tracking', () => {
  it('redirects with 302 and records a detailed hit', async () => {
    const c = await createCampaign({ links: [{ sourceLabel: 'Poster', code: 'poster', utm: { source: 'poster', medium: 'qr' } }] });
    const res = await visit('poster', {
      referer: 'https://www.linkedin.com/',
      'accept-language': 'en-GB,en;q=0.8',
      'x-client-region': 'GB',
      'x-client-city': 'Leeds',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://example.com/spring?utm_source=poster&utm_medium=qr');
    expect(res.headers['cache-control']).toContain('no-store');

    const hits = await t.db.selectFrom('hits').selectAll().execute();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      link_id: c.links[0]!.id,
      campaign_id: c.id,
      ip: '203.0.113.7',
      device_type: 'mobile',
      os: 'iOS',
      referrer_host: 'www.linkedin.com',
      language: 'en-gb',
      country: 'GB',
      city: 'Leeds',
      is_bot: false,
    });
  });

  it('matches codes case-insensitively and with trailing slashes (as upper-case QR payloads arrive)', async () => {
    await createCampaign({ links: [{ sourceLabel: 'x', code: 'mixed-case' }] });
    expect((await visit('MIXED-CASE')).statusCode).toBe(302);
    expect((await visit('mixed-case/')).statusCode).toBe(302);
  });

  it('follows destination changes immediately (editable redirects)', async () => {
    const c = await createCampaign({ links: [{ sourceLabel: 'a', code: 'move-me' }] });
    expect((await visit('move-me')).headers.location).toBe('https://example.com/spring');
    await t.api('PATCH', `/api/campaigns/${c.id}`, { destinationUrl: 'https://example.com/summer' });
    expect((await visit('move-me')).headers.location).toBe('https://example.com/summer');
    await t.api('PATCH', `/api/links/${c.links[0]!.id}`, { destinationUrl: 'https://example.com/override' });
    expect((await visit('move-me')).headers.location).toBe('https://example.com/override');
    await t.api('PATCH', `/api/links/${c.links[0]!.id}`, { destinationUrl: null });
    expect((await visit('move-me')).headers.location).toBe('https://example.com/summer');
  });

  it('shows a 404 page for unknown or paused links', async () => {
    const c = await createCampaign({ links: [{ sourceLabel: 'a', code: 'paused' }] });
    await t.api('PATCH', `/api/links/${c.links[0]!.id}`, { active: false });
    const paused = await visit('paused');
    expect(paused.statusCode).toBe(404);
    expect(paused.body).toContain('no longer active');
    expect((await visit('nope-nope')).statusCode).toBe(404);
    expect((await visit('bad%20code')).statusCode).toBe(404);
    expect(await t.db.selectFrom('hits').selectAll().execute()).toHaveLength(0);
  });

  it('does not count HEAD requests', async () => {
    await createCampaign({ links: [{ sourceLabel: 'a', code: 'head-check' }] });
    const res = await t.app.inject({ method: 'HEAD', url: '/head-check' });
    expect(res.statusCode).toBe(302);
    expect(await t.db.selectFrom('hits').selectAll().execute()).toHaveLength(0);
  });

  it('redirects even if analytics cannot be written', async () => {
    await createCampaign({ links: [{ sourceLabel: 'a', code: 'resilient' }] });
    await sql`ALTER TABLE hits ADD CONSTRAINT block_all CHECK (false) NOT VALID`.execute(t.db);
    try {
      const res = await visit('resilient');
      expect(res.statusCode).toBe(302);
    } finally {
      await sql`ALTER TABLE hits DROP CONSTRAINT block_all`.execute(t.db);
    }
  });

  it('sends the bare domain to the app', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/' });
    expect(res.headers.location).toBe('/app');
  });

  it('applies IP retention', async () => {
    const c = await createCampaign({ links: [{ sourceLabel: 'a', code: 'old-hit' }] });
    await visit('old-hit');
    await visit('old-hit');
    await t.db.updateTable('hits').set({ occurred_at: new Date(Date.now() - 100 * 86_400_000) }).where('id', '=', 1).execute();
    expect(await applyRetention(t.db, { rawIpDays: 90, hitDays: 0 })).toEqual({ ipsCleared: 1, hitsDeleted: 0 });
    const hits = await t.db.selectFrom('hits').select(['id', 'ip']).orderBy('id').execute();
    expect(hits.map((h) => h.ip)).toEqual([null, '203.0.113.7']);
    expect(await applyRetention(t.db, { rawIpDays: 0, hitDays: 30 })).toEqual({ ipsCleared: 0, hitsDeleted: 1 });
    expect((await t.api<CampaignDto>('GET', `/api/campaigns/${c.id}`)).body.links[0]!.stats.hits).toBe(1);
  });
});

describe('reporting', () => {
  async function seed() {
    const c = await createCampaign({
      links: [
        { sourceLabel: 'Expo', code: 'expo' },
        { sourceLabel: 'Brochure', code: 'brochure' },
        { sourceLabel: 'Unused', code: 'unused' },
      ],
    });
    await visit('expo', { 'user-agent': IPHONE_UA, 'x-forwarded-for': '198.51.100.1', 'x-client-region': 'GB' });
    await visit('expo', { 'user-agent': IPHONE_UA, 'x-forwarded-for': '198.51.100.1', 'x-client-region': 'GB' });
    await visit('expo', { 'user-agent': ANDROID_UA, 'x-forwarded-for': '198.51.100.2', 'x-client-region': 'IE' });
    await visit('brochure', { 'user-agent': DESKTOP_UA, 'x-forwarded-for': '198.51.100.3', 'x-client-region': 'GB' });
    await visit('brochure', { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)', 'x-forwarded-for': '66.249.66.1' });
    return c;
  }

  it('breaks down a campaign by source, device and country', async () => {
    const c = await seed();
    const linkId = (code: string) => c.links.find((l) => l.code === code)!.id;
    const res = await t.api<{
      totals: { hits: number; uniqueVisitors: number; bots: number };
      bySource: Array<{ linkId: string; hits: number; uniqueVisitors: number }>;
      devices: Array<{ key: string; hits: number }>;
      countries: Array<{ key: string; hits: number }>;
      timeseries: Array<{ total: number; byLink: Record<string, number> }>;
      heatmap: Array<{ hits: number }>;
      range: { bucket: string };
    }>('GET', `/api/campaigns/${c.id}/stats?days=7&tz=Europe/London`);
    expect(res.status).toBe(200);
    const s = res.body;
    expect(s.totals).toEqual({ hits: 4, uniqueVisitors: 3, bots: 0 });
    expect(s.bySource.find((b) => b.linkId === linkId('expo'))).toMatchObject({ hits: 3, uniqueVisitors: 2 });
    expect(s.bySource.find((b) => b.linkId === linkId('brochure'))).toMatchObject({ hits: 1 });
    expect(Object.fromEntries(s.devices.map((d) => [d.key, d.hits]))).toEqual({ mobile: 3, desktop: 1 });
    expect(Object.fromEntries(s.countries.map((d) => [d.key, d.hits]))).toEqual({ GB: 3, IE: 1 });
    expect(s.range.bucket).toBe('day');
    expect(s.timeseries).toHaveLength(8);
    expect(s.timeseries.reduce((n, p) => n + p.total, 0)).toBe(4);
    expect(s.timeseries.at(-1)!.byLink[linkId('expo')]).toBe(3);
    expect(s.heatmap.reduce((n, h) => n + h.hits, 0)).toBe(4);

    const withBots = await t.api<{ totals: { hits: number; bots: number } }>('GET', `/api/campaigns/${c.id}/stats?includeBots=1`);
    expect(withBots.body.totals).toMatchObject({ hits: 5, bots: 1 });

    const filtered = await t.api<{ totals: { hits: number } }>('GET', `/api/campaigns/${c.id}/stats?links=${linkId('brochure')}`);
    expect(filtered.body.totals.hits).toBe(1);
  });

  it('includes per-link totals on the campaign', async () => {
    const c = await seed();
    const res = await t.api<CampaignDto>('GET', `/api/campaigns/${c.id}`);
    const byCode = Object.fromEntries(res.body.links.map((l) => [l.code, l.stats]));
    expect(byCode.expo).toMatchObject({ hits: 3, uniqueVisitors: 2 });
    expect(byCode.unused).toMatchObject({ hits: 0 });
    const list = await t.api<Array<{ hits: number; hits7d: number; linkCount: number }>>('GET', '/api/campaigns');
    expect(list.body[0]).toMatchObject({ hits: 4, hits7d: 4, linkCount: 3 });
  });

  it('pages through raw hits and exports CSV', async () => {
    const c = await seed();
    const page1 = await t.api<{ items: Array<{ id: number; code: string; ip: string }>; nextBefore: number | null }>(
      'GET',
      `/api/campaigns/${c.id}/hits?limit=3`,
    );
    expect(page1.body.items).toHaveLength(3);
    expect(page1.body.items[0]).toMatchObject({ code: 'brochure', ip: '198.51.100.3' });
    const page2 = await t.api<{ items: unknown[]; nextBefore: number | null }>(
      'GET',
      `/api/campaigns/${c.id}/hits?limit=3&before=${page1.body.nextBefore}`,
    );
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextBefore).toBeNull();

    const csv = await t.api<string>('GET', `/api/campaigns/${c.id}/hits.csv?includeBots=1`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('spring-launch-hits.csv');
    const lines = csv.body.trim().split('\r\n');
    expect(lines[0]).toContain('occurred_at,code,source,ip');
    expect(lines).toHaveLength(6);
  });

  it('summarises activity across campaigns', async () => {
    await seed();
    const res = await t.api<{ totals: { hits: number; campaigns: number; links: number }; topCampaigns: Array<{ name: string; hits: number }>; timeseries: unknown[] }>(
      'GET',
      '/api/stats/overview?days=30',
    );
    expect(res.body.totals).toMatchObject({ hits: 4, campaigns: 1, links: 3 });
    expect(res.body.topCampaigns).toEqual([expect.objectContaining({ name: 'Spring launch', hits: 4 })]);
    expect(res.body.timeseries).toHaveLength(31);
  });

  it('validates report parameters', async () => {
    const c = await createCampaign();
    expect((await t.api('GET', `/api/campaigns/${c.id}/stats?tz=Mars/Base`)).status).toBe(400);
    expect((await t.api('GET', `/api/campaigns/${c.id}/stats?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z`)).status).toBe(400);
    expect((await t.api('GET', `/api/campaigns/${c.id}/stats?links=nope`)).status).toBe(400);
    expect((await t.api('GET', `/api/campaigns/00000000-0000-4000-8000-000000000000/stats`)).status).toBe(404);
  });
});

describe('QR codes, templates and assets', () => {
  const svgLogo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#e11d48"/></svg>');

  it('uploads, de-duplicates and serves logos safely', async () => {
    const up = await t.api<{ id: string; mime: string }>('POST', '/api/assets', {
      filename: 'logo.svg',
      data: `data:image/svg+xml;base64,${svgLogo.toString('base64')}`,
    });
    expect(up.status).toBe(201);
    expect(up.body.mime).toBe('image/svg+xml');
    const again = await t.api<{ id: string }>('POST', '/api/assets', { filename: 'copy.svg', data: svgLogo.toString('base64') });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(up.body.id);

    const get = await t.api<string>('GET', `/api/assets/${up.body.id}`);
    expect(get.headers['content-security-policy']).toContain('sandbox');

    const evil = await t.api('POST', '/api/assets', {
      filename: 'x.svg',
      data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64'),
    });
    expect(evil.status).toBe(422);
    const notImage = await t.api('POST', '/api/assets', { filename: 'x.txt', data: Buffer.from('hello').toString('base64') });
    expect(notImage.status).toBe(415);
  });

  it('previews a design with warnings', async () => {
    const res = await t.api<{ svg: string; warnings: Array<{ code: string }>; modules: number }>('POST', '/api/qr/preview', {
      style: { foreground: { type: 'solid', color: '#eeeeee' } },
    });
    expect(res.status).toBe(200);
    expect(res.body.svg).toMatch(/^<svg/);
    expect(res.body.warnings.map((w) => w.code)).toContain('low-contrast');
  });

  it('downloads scannable PNG and SVG files for a link, with its saved logo', async () => {
    const logo = await t.api<{ id: string }>('POST', '/api/assets', { filename: 'logo.svg', data: svgLogo.toString('base64') });
    const c = await createCampaign({
      links: [{ sourceLabel: 'Flyer', code: 'flyer-1', qrStyle: { logo: { assetId: logo.body.id }, frame: { style: 'card-pill', text: 'SCAN ME' } } }],
    });
    const id = c.links[0]!.id;
    const png = await t.app.inject({
      method: 'GET',
      url: `/api/links/${id}/qr?format=png&width=800&download=1`,
      headers: { cookie: await t.login() },
    });
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['content-disposition']).toBe('attachment; filename="qr-flyer-1.png"');
    await expect(decodePng(png.rawPayload)).resolves.toBe('HTTPS://GO.EXAMPLE.COM/FLYER-1');

    const svg = await t.api<string>('GET', `/api/links/${id}/qr?format=svg&width=40&unit=mm`);
    expect(svg.headers['content-type']).toContain('image/svg+xml');
    expect(svg.body).toContain('width="40mm"');
    expect(svg.body).toContain('<image');

    const mm = await t.app.inject({ method: 'GET', url: `/api/links/${id}/qr?format=png&width=50&unit=mm&dpi=300`, headers: { cookie: await t.login() } });
    const { PNG } = await import('pngjs');
    expect(PNG.sync.read(mm.rawPayload).width).toBe(591);

    const tooBig = await t.api('GET', `/api/links/${id}/qr?format=png&width=100&unit=in&dpi=1200`);
    expect(tooBig.status).toBe(400);
    // Within the width cap, but the card frame makes it taller than wide: over the pixel budget.
    const tooManyPixels = await t.api<{ message: string }>('GET', `/api/links/${id}/qr?format=png&width=7000`);
    expect(tooManyPixels.status).toBe(400);
    expect(tooManyPixels.body.message).toMatch(/megapixels/);
  });

  it('manages templates', async () => {
    const created = await t.api<{ id: string; style: { frame: { style: string } } }>('POST', '/api/templates', {
      name: 'Event',
      style: { frame: { style: 'banner-bottom', text: 'SCAN AT THE STAND' } },
    });
    expect(created.status).toBe(201);
    expect(created.body.style.frame.style).toBe('banner-bottom');
    const updated = await t.api<{ name: string }>('PUT', `/api/templates/${created.body.id}`, { name: 'Event 2', style: {} });
    expect(updated.body.name).toBe('Event 2');
    expect((await t.api<unknown[]>('GET', '/api/templates')).body).toHaveLength(1);
    expect((await t.api('DELETE', `/api/templates/${created.body.id}`)).status).toBe(204);
    expect((await t.api('GET', `/api/templates/${created.body.id}`)).status).toBe(404);
  });
});

describe('operations', () => {
  it('reports health and readiness', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/readyz' })).json()).toEqual({ ok: true });
  });

  it('sets security headers', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
