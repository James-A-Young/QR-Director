import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, request } from '../lib/api';
import { bucketLabel, countryFlag, countryName, formatRelative, hostOf, pluralise } from '../lib/format';
import { jsonResponse, mockApi } from './utils';

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('sends the CSRF header and JSON body', async () => {
    const { calls } = mockApi({ 'POST /api/templates': { id: 't1' } });
    await api.createTemplate({ name: 'x', style: {} as never });
    expect(calls[0]!.headers['x-qrd-request']).toBe('1');
    expect(calls[0]!.headers['content-type']).toBe('application/json');
    expect(calls[0]!.body).toEqual({ name: 'x', style: {} });
  });

  it('raises ApiError with field details', async () => {
    mockApi({
      'POST /api/campaigns': () =>
        jsonResponse(400, { error: 'validation_error', message: 'Request validation failed', details: [{ path: 'destinationUrl', message: 'Must be a valid URL' }] }),
    });
    const err = await api.createCampaign({ name: 'x', destinationUrl: 'nope' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.field('destinationUrl')).toBe('Must be a valid URL');
    expect(err.field('name')).toBeUndefined();
  });

  it('handles empty 204 responses and non-JSON errors', async () => {
    mockApi({
      'DELETE /api/links/l1': () => new Response(null, { status: 204 }),
      'GET /api/me': () => new Response('Bad gateway', { status: 502 }),
    });
    await expect(api.deleteLink('l1')).resolves.toBeUndefined();
    await expect(request('GET', '/api/me')).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' });
  });

  it('builds download and stats URLs', () => {
    expect(api.qrUrl('l1', { format: 'png', width: 50, unit: 'mm', dpi: 300, download: true })).toBe(
      '/api/links/l1/qr?format=png&width=50&unit=mm&dpi=300&download=1',
    );
    expect(api.hitsCsvUrl('c1', { days: 7, includeBots: false })).toMatch(/^\/api\/campaigns\/c1\/hits\.csv\?tz=.+&days=7&includeBots=false$/);
  });
});

describe('format helpers', () => {
  it('formats relative times', () => {
    const now = Date.parse('2026-10-23T12:00:00Z');
    expect(formatRelative(null)).toBe('Never');
    expect(formatRelative('2026-10-23T11:00:00Z', now)).toMatch(/hour/);
    expect(formatRelative('2026-10-20T12:00:00Z', now)).toMatch(/3 days ago/);
  });

  it('turns country codes into names and flags', () => {
    expect(countryName('GB')).toMatch(/United Kingdom/);
    expect(countryName('Unknown')).toBe('Unknown');
    expect(countryFlag('gb')).toBe('🇬🇧');
    expect(countryFlag('Unknown')).toBe('🌐');
  });

  it('labels buckets and pluralises', () => {
    expect(bucketLabel('2026-03-05T00:00', 'day')).toMatch(/5/);
    expect(pluralise(1, 'source')).toBe('1 source');
    expect(pluralise(3, 'source')).toBe('3 sources');
    expect(hostOf('https://example.com/a?b')).toBe('example.com');
    expect(hostOf('not a url')).toBe('not a url');
  });
});
