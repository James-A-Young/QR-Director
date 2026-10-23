import maxmind, { type CityResponse, type Reader } from 'maxmind';
import type { FastifyBaseLogger } from 'fastify';

export interface GeoResult {
  country: string | null;
  region: string | null;
  city: string | null;
}

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
 * Resolves visitor location. Prefers headers injected by an edge proxy (Google Cloud load balancer
 * custom headers, App Engine, Cloudflare) and falls back to a MaxMind database if one is configured.
 */
export function createGeoLookup(reader: Reader<CityResponse> | null): GeoLookup {
  return {
    lookup(ip, headers) {
      const fromHeaders: GeoResult = {
        country: header(headers, 'x-client-region', 'x-appengine-country', 'cf-ipcountry', 'x-vercel-ip-country')?.toUpperCase() ?? null,
        region: header(headers, 'x-client-region-subdivision', 'x-appengine-region', 'x-vercel-ip-country-region'),
        city: header(headers, 'x-client-city', 'x-appengine-city', 'x-vercel-ip-city'),
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

export async function loadGeoLookup(path: string | undefined, log: FastifyBaseLogger): Promise<GeoLookup> {
  if (!path) return createGeoLookup(null);
  try {
    const reader = await maxmind.open<CityResponse>(path);
    log.info({ path }, 'Loaded GeoIP database');
    return createGeoLookup(reader);
  } catch (err) {
    log.warn({ err, path }, 'Could not load GeoIP database; continuing without IP geolocation');
    return createGeoLookup(null);
  }
}
