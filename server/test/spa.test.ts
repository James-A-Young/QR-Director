import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { useTestApp } from './helpers.js';

const dir = mkdtempSync(join(tmpdir(), 'qrd-web-'));
mkdirSync(join(dir, 'assets'));
writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
writeFileSync(join(dir, 'favicon.svg'), '<svg/>');

const t = useTestApp({ config: { WEB_DIST_DIR: dir } });

describe('web UI hosting', () => {
  it('serves the SPA shell for client-side routes without caching it', async () => {
    for (const url of ['/app', '/app/', '/app/campaigns/123', '/app/links/x/design']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body).toContain('<div id="root">');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('serves hashed assets as immutable', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/app/assets/index-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['cache-control']).toContain('max-age=31536000');
  });

  it('serves other static files', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/app/favicon.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
  });

  it('does not escape the web directory', async () => {
    for (const url of ['/app/../package.json', '/app/%2e%2e/%2e%2e/etc/passwd', '/app/assets/../../../../etc/passwd']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.body, url).not.toContain('root:x:0');
      expect(res.body, url).not.toContain('"name"');
    }
  });

  it('keeps API and redirect routes working alongside the UI', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/campaigns' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/unknown-code' })).statusCode).toBe(404);
  });
});
