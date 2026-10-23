import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { CookieSigner } from '../src/auth/session.js';
import { isIdentityAllowed, DevAuthProvider } from '../src/auth/providers.js';
import { safeReturnTo } from '../src/auth/routes.js';
import { generateCode, normaliseCode, validateCode, GENERATED_CODE_LENGTH } from '../src/services/codes.js';
import { buildHit, parseUserAgent, resolveDestination, visitorHash } from '../src/services/tracking.js';
import { createGeoLookup } from '../src/services/geo.js';
import { contrastRatio, defaultStyle, effectiveErrorCorrection, parseStyle, styleWarnings } from '../src/qr/style.js';
import { sniffMime, svgProblem } from '../src/routes/assets.js';
import { csvCell } from '../src/routes/stats.js';
import { widthInPixels } from '../src/routes/qr.js';
import { bucketKeys, chooseBucket } from '../src/services/stats.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const baseEnv = {
  DATABASE_URL: 'postgres://localhost/x',
  PUBLIC_BASE_URL: 'https://go.example.com/',
  SESSION_SECRET: 'x'.repeat(32),
  AUTH_MODE: 'dev',
};

describe('config', () => {
  it('parses and normalises values', () => {
    const cfg = loadConfig({ ...baseEnv, AUTH_ALLOWED_EMAIL_DOMAINS: 'Example.com, foo.org ', QR_UPPERCASE_URLS: 'false' });
    expect(cfg.PUBLIC_BASE_URL).toBe('https://go.example.com');
    expect(cfg.allowedEmailDomains).toEqual(['example.com', 'foo.org']);
    expect(cfg.QR_UPPERCASE_URLS).toBe(false);
    expect(cfg.secureCookies).toBe(true);
    expect(cfg.PORT).toBe(8080);
  });

  it('requires Entra settings in entra mode', () => {
    expect(() => loadConfig({ ...baseEnv, AUTH_MODE: 'entra' })).toThrow(/AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET/);
    expect(() =>
      loadConfig({ ...baseEnv, AUTH_MODE: 'entra', AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's' }),
    ).not.toThrow();
  });

  it('refuses dev auth in production', () => {
    expect(() => loadConfig({ ...baseEnv, NODE_ENV: 'production' })).toThrow(/AUTH_MODE=dev is not permitted/);
  });

  it('rejects short secrets and missing values', () => {
    expect(() => loadConfig({ ...baseEnv, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ PUBLIC_BASE_URL: 'https://x', SESSION_SECRET: 'x'.repeat(32) })).toThrow(/DATABASE_URL/);
  });
});

describe('CookieSigner', () => {
  const signer = new CookieSigner('s'.repeat(32));

  it('round-trips payloads', () => {
    expect(signer.unseal<{ a: number }>(signer.seal({ a: 1 }, 60))?.a).toBe(1);
  });

  it('rejects tampered, foreign and expired cookies', () => {
    const sealed = signer.seal({ uid: 'u1' }, 60);
    const [body, sig] = sealed.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 'admin', exp: 9e9 })).toString('base64url');
    expect(signer.unseal(`${forged}.${sig}`)).toBeNull();
    expect(signer.unseal(`${body}.x${sig}`)).toBeNull();
    expect(new CookieSigner('t'.repeat(32)).unseal(sealed)).toBeNull();
    expect(signer.unseal(signer.seal({ uid: 'u1' }, -1))).toBeNull();
    expect(signer.unseal('garbage')).toBeNull();
    expect(signer.unseal(undefined)).toBeNull();
  });
});

describe('auth helpers', () => {
  it('only allows same-origin return paths', () => {
    expect(safeReturnTo('/app/campaigns/1')).toBe('/app/campaigns/1');
    expect(safeReturnTo('//evil.com')).toBe('/app');
    expect(safeReturnTo('/\\evil.com')).toBe('/app');
    expect(safeReturnTo('https://evil.com')).toBe('/app');
    expect(safeReturnTo(undefined)).toBe('/app');
  });

  it('enforces domain and group allow-lists', () => {
    const id = { oid: '1', email: 'a@example.com', name: 'A', groups: ['g1'] };
    expect(isIdentityAllowed(id, { allowedEmailDomains: [], AUTH_REQUIRED_GROUP_ID: undefined })).toBe(true);
    expect(isIdentityAllowed(id, { allowedEmailDomains: ['example.com'], AUTH_REQUIRED_GROUP_ID: undefined })).toBe(true);
    expect(isIdentityAllowed(id, { allowedEmailDomains: ['other.com'], AUTH_REQUIRED_GROUP_ID: undefined })).toBe(false);
    expect(isIdentityAllowed(id, { allowedEmailDomains: [], AUTH_REQUIRED_GROUP_ID: 'g1' })).toBe(true);
    expect(isIdentityAllowed(id, { allowedEmailDomains: [], AUTH_REQUIRED_GROUP_ID: 'g2' })).toBe(false);
    expect(isIdentityAllowed({ ...id, email: null }, { allowedEmailDomains: ['example.com'], AUTH_REQUIRED_GROUP_ID: undefined })).toBe(false);
  });

  it('dev provider validates state', async () => {
    const p = new DevAuthProvider('http://localhost');
    const { url, state } = await p.beginLogin('/app');
    expect(url).toContain('/auth/dev-login?state=');
    const ok = await p.completeLogin(new URL(`http://localhost/auth/callback?state=${state.state}&email=Me@X.com`), state);
    expect(ok).toMatchObject({ oid: 'dev:me@x.com', email: 'me@x.com' });
    await expect(p.completeLogin(new URL('http://localhost/auth/callback?state=nope'), state)).rejects.toThrow();
  });
});

describe('codes', () => {
  it('generates unambiguous lower-case codes', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toHaveLength(GENERATED_CODE_LENGTH);
      expect(code).toMatch(/^[2-9a-hjkmnp-z]+$/);
      expect(validateCode(code)).toBeNull();
    }
  });

  it('validates custom codes', () => {
    expect(validateCode(normaliseCode('  Spring-Fair  '))).toBeNull();
    expect(validateCode('a')).toBe('invalid');
    expect(validateCode('-abc')).toBe('invalid');
    expect(validateCode('has space')).toBe('invalid');
    expect(validateCode('under_score')).toBe('invalid');
    expect(validateCode('x'.repeat(65))).toBe('invalid');
    expect(validateCode('api')).toBe('reserved');
    expect(validateCode('app')).toBe('reserved');
  });
});

describe('tracking', () => {
  it('classifies devices and bots', () => {
    expect(parseUserAgent(IPHONE)).toMatchObject({ deviceType: 'mobile', os: 'iOS', browser: 'Mobile Safari', deviceVendor: 'Apple', isBot: false });
    expect(parseUserAgent(ANDROID_TABLET)).toMatchObject({ deviceType: 'tablet', os: 'Android' });
    expect(parseUserAgent(DESKTOP)).toMatchObject({ deviceType: 'desktop', os: 'Windows', browser: 'Edge' });
    expect(parseUserAgent(GOOGLEBOT)).toMatchObject({ deviceType: 'bot', isBot: true });
    expect(parseUserAgent(null)).toMatchObject({ isBot: true });
  });

  it('hashes visitors stably and per secret', () => {
    expect(visitorHash('s', '1.2.3.4', 'ua')).toBe(visitorHash('s', '1.2.3.4', 'ua'));
    expect(visitorHash('s', '1.2.3.4', 'ua')).not.toBe(visitorHash('s', '1.2.3.5', 'ua'));
    expect(visitorHash('s', '1.2.3.4', 'ua')).not.toBe(visitorHash('t', '1.2.3.4', 'ua'));
  });

  it('builds a hit record from the request', () => {
    const geo = createGeoLookup(null);
    const hit = buildHit(
      {
        ip: '203.0.113.9',
        headers: {
          'user-agent': IPHONE,
          referer: 'https://www.linkedin.com/feed/',
          'accept-language': 'en-GB,en;q=0.9',
          'x-client-region': 'gb',
          'x-client-city': 'Birmingham',
        },
        query: { utm_source: 'flyer', nested: { a: 1 }, list: ['x', 'y'] },
      },
      { linkId: 'l', campaignId: 'c', destinationUrl: 'https://d', secret: 's', geo },
    );
    expect(hit).toMatchObject({
      ip: '203.0.113.9',
      device_type: 'mobile',
      referrer_host: 'www.linkedin.com',
      language: 'en-gb',
      country: 'GB',
      city: 'Birmingham',
      is_bot: false,
    });
    expect(JSON.parse(hit.query as string)).toEqual({ utm_source: 'flyer', list: 'x' });
  });

  it('appends UTM tags without clobbering existing ones', () => {
    expect(resolveDestination('https://example.com/p?a=1', { source: 'qr', medium: 'print' })).toBe(
      'https://example.com/p?a=1&utm_source=qr&utm_medium=print',
    );
    expect(resolveDestination('https://example.com/?utm_source=keep', { source: 'qr' })).toBe('https://example.com/?utm_source=keep');
    expect(resolveDestination('https://example.com/', { source: 'qr' }, { utm_source: 'email' })).toBe(
      'https://example.com/?utm_source=email',
    );
    expect(resolveDestination('not a url', { source: 'qr' })).toBe('not a url');
  });
});

describe('style', () => {
  it('fills defaults', () => {
    expect(parseStyle(undefined)).toEqual(defaultStyle);
    expect(parseStyle({ modules: { shape: 'dots' } }).eyes.outerShape).toBe('square');
  });

  it('normalises and validates colours', () => {
    expect(parseStyle({ background: { color: '#ABCDEF' } }).background.color).toBe('#abcdef');
    expect(() => parseStyle({ background: { color: 'red' } })).toThrow();
  });

  it('uses H error correction with a logo', () => {
    expect(effectiveErrorCorrection(parseStyle({ errorCorrection: 'L' }))).toBe('L');
    expect(effectiveErrorCorrection(parseStyle({ errorCorrection: 'L', logo: { assetId: '00000000-0000-4000-8000-000000000001' } }))).toBe('H');
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('warns about risky designs', () => {
    const codes = (s: object) => styleWarnings(parseStyle(s)).map((w) => w.code);
    expect(codes({})).toEqual([]);
    expect(codes({ foreground: { type: 'solid', color: '#dddddd' } })).toContain('low-contrast');
    expect(codes({ foreground: { type: 'solid', color: '#ffffff' }, background: { color: '#000000' } })).toContain('inverted');
    expect(codes({ margin: 1 })).toContain('small-margin');
    // A brand green pupil (2.4:1) is fine; the same colour for data modules is not.
    expect(codes({ eyes: { innerColor: '#72b856' } })).toEqual([]);
    expect(codes({ foreground: { type: 'solid', color: '#72b856' } })).toContain('low-contrast');
    expect(codes({ eyes: { innerColor: '#e5e7eb' } })).toContain('low-contrast');
    expect(codes({ background: { transparent: true } })).toContain('transparent');
    expect(codes({ logo: { assetId: '00000000-0000-4000-8000-000000000001', size: 0.3 } })).toContain('large-logo');
  });
});

describe('assets', () => {
  it('sniffs image types from bytes', () => {
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
    expect(sniffMime(Buffer.from('<html><svg></svg></html>'))).toBeNull();
    expect(sniffMime(Buffer.from('GIF89a'))).toBeNull();
  });

  it('rejects dangerous SVG content', () => {
    expect(svgProblem('<svg><path d="M0 0"/></svg>')).toBeNull();
    expect(svgProblem('<svg><use href="#a"/><image href="data:image/png;base64,AA"/></svg>')).toBeNull();
    expect(svgProblem('<svg><script>alert(1)</script></svg>')).toMatch(/scripts/);
    expect(svgProblem('<svg onload="x()"></svg>')).toMatch(/event handlers/);
    expect(svgProblem('<svg><foreignObject/></svg>')).toMatch(/foreignObject/);
    expect(svgProblem('<svg><script/></svg>')).toMatch(/scripts/);
    expect(svgProblem('<svg><image href="file:///etc/passwd"/></svg>')).toMatch(/embedded/);
    expect(svgProblem('<svg><image xlink:href="https://evil/x.png"/></svg>')).toMatch(/embedded/);
    expect(svgProblem('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>')).toMatch(/entities/);
    expect(svgProblem('<svg><rect style="fill:url(https://x)"/></svg>')).toMatch(/url/);
  });
});

describe('export helpers', () => {
  it('converts physical sizes to pixels', () => {
    expect(widthInPixels(512, 'px', 300)).toBe(512);
    expect(widthInPixels(25.4, 'mm', 300)).toBeCloseTo(300);
    expect(widthInPixels(2, 'in', 600)).toBe(1200);
  });

  it('escapes CSV cells and blocks formula injection', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(null)).toBe('');
    expect(csvCell(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe('time buckets', () => {
  it('chooses hourly buckets for short ranges', () => {
    const now = new Date('2026-06-10T12:00:00Z');
    expect(chooseBucket(new Date(now.getTime() - 86_400_000), now)).toBe('hour');
    expect(chooseBucket(new Date(now.getTime() - 30 * 86_400_000), now)).toBe('day');
  });

  it('produces contiguous local-time keys across DST changes', () => {
    // UK clocks go back on 25 Oct 2026; the 25th is a 25-hour day. The range end is exclusive.
    const keys = bucketKeys(new Date('2026-10-23T23:00:00Z'), new Date('2026-10-27T00:00:00Z'), 'Europe/London', 'day');
    expect(keys).toEqual(['2026-10-24T00:00', '2026-10-25T00:00', '2026-10-26T00:00']);
    const hours = bucketKeys(new Date('2026-06-01T00:00:00Z'), new Date('2026-06-01T03:00:00Z'), 'UTC', 'hour');
    expect(hours).toEqual(['2026-06-01T00:00', '2026-06-01T01:00', '2026-06-01T02:00']);
  });
});

describe('buildApp', () => {
  it('accepts a pino logger instance (as used in production)', async () => {
    const { pino } = await import('pino');
    const { buildApp } = await import('../src/app.js');
    const { createDatabase } = await import('../src/db/database.js');
    const db = createDatabase({ connectionString: 'postgres://localhost:1/none' });
    const app = await buildApp({ config: loadConfig(baseEnv), db, logger: pino({ level: 'silent' }) });
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    await app.close();
    await db.destroy();
  });
});
