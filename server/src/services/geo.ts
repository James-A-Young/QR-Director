import maxmind, { type CityResponse, type Reader } from 'maxmind';
import type { FastifyBaseLogger } from 'fastify';

export interface GeoResult {
  country: string | null;
  region: string | null;
  city: string | null;
}

/** Edge proxies whose geo headers can be trusted. Headers are only honoured when the proxy adds them. */
export const GEO_HEADER_PROVIDERS = {
  'google-lb': { country: 'x-client-region', region: 'x-client-region-subdivision', city: 'x-client-city' },
  appengine: { country: 'x-appengine-country', region: 'x-appengine-region', city: 'x-appengine-city' },
  cloudflare: { country: 'cf-ipcountry', region: 'cf-region', city: 'cf-ipcity' },
  vercel: { country: 'x-vercel-ip-country', region: 'x-vercel-ip-country-region', city: 'x-vercel-ip-city' },
} as const;
export type GeoHeaderProvider = keyof typeof GEO_HEADER_PROVIDERS;

export interface GeoLookup {
  lookup(ip: string | null, headers: Record<string, string | string[] | undefined>): GeoResult;
}

const header = (headers: Record<string, string | string[] | undefined>, ...names: string[]): string | null => {
  for (const name of names) {
    const v = headers[name];
    const value = Array.isArray(v) ? v[0] : v;
    if (value && value.trim() && value !== 'ZZ' && value !== 'XX') {
      try {
        return decodeURIComponent(value.trim()).slice(0, 100);
      } catch {
        return value.trim().slice(0, 100);
      }
    }
  }
  return null;
};

/**
 * Resolves visitor location. Uses headers injected by trusted edge proxies (configured explicitly,
 * because on a bare deployment a client could send them itself), then a MaxMind database if any.
 */
export function createGeoLookup(reader: Reader<CityResponse> | null, providers: GeoHeaderProvider[] = []): GeoLookup {
  const names = providers.map((p) => GEO_HEADER_PROVIDERS[p]);
  return {
    lookup(ip, headers) {
      const fromHeaders: GeoResult = {
        country: header(headers, ...names.map((n) => n.country))?.toUpperCase() ?? null,
        region: header(headers, ...names.map((n) => n.region)),
        city: header(headers, ...names.map((n) => n.city)),
      };
      if (fromHeaders.country || !reader || !ip) return fromHeaders;
      try {
        const r = reader.get(ip);
        return {
          country: r?.country?.iso_code ?? r?.registered_country?.iso_code ?? null,
          region: r?.subdivisions?.[0]?.names?.en ?? null,
          city: r?.city?.names?.en ?? null,
        };
      } catch {
        return fromHeaders;
      }
    },
  };
}

export async function loadGeoLookup(
  path: string | undefined,
  providers: GeoHeaderProvider[],
  log: FastifyBaseLogger,
): Promise<GeoLookup> {
  if (!path) return createGeoLookup(null, providers);
  try {
    const reader = await maxmind.open<CityResponse>(path);
    log.info({ path }, 'Loaded GeoIP database');
    return createGeoLookup(reader, providers);
  } catch (err) {
    log.warn({ err, path }, 'Could not load GeoIP database; continuing without IP geolocation');
    return createGeoLookup(null, providers);
  }
}
