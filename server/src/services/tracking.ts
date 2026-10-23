import { createHash } from 'node:crypto';
import { isbot } from 'isbot';
import UAParser from 'ua-parser-js';
import type { NewHit, UtmParams } from '../db/schema.js';
import type { GeoLookup } from './geo.js';

export interface HitRequest {
  ip: string | null;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const clip = (v: string | null | undefined, max: number) => (v ? v.slice(0, max) : null);

export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'tv' | 'wearable' | 'console' | 'bot' | 'other';

export function parseUserAgent(ua: string | null) {
  const parsed = new UAParser(ua ?? '').getResult();
  const bot = !ua || isbot(ua);
  const raw = parsed.device.type;
  let deviceType: DeviceType;
  if (bot) deviceType = 'bot';
  else if (raw === 'mobile' || raw === 'tablet' || raw === 'wearable' || raw === 'console') deviceType = raw;
  else if (raw === 'smarttv') deviceType = 'tv';
  else if (raw === 'embedded') deviceType = 'other';
  else deviceType = 'desktop';
  return {
    isBot: bot,
    deviceType,
    browser: parsed.browser.name ?? null,
    browserVersion: parsed.browser.major ?? null,
    os: parsed.os.name ?? null,
    osVersion: parsed.os.version ?? null,
    deviceVendor: parsed.device.vendor ?? null,
    deviceModel: parsed.device.model ?? null,
  };
}

/** Stable pseudonymous id for unique-visitor counts, without cookies. */
export function visitorHash(secret: string, ip: string | null, ua: string | null): string {
  return createHash('sha256').update(`${secret}\u0000${ip ?? ''}\u0000${ua ?? ''}`).digest('base64url').slice(0, 22);
}

function primaryLanguage(acceptLanguage: string | null): string | null {
  const tag = acceptLanguage?.split(',')[0]?.split(';')[0]?.trim();
  return tag && /^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/.test(tag) ? tag.toLowerCase() : null;
}

function referrerHost(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Only flat string query params are recorded (UTM tags etc.), capped to keep rows small. */
function sanitiseQuery(query: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query).slice(0, 20)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (typeof value === 'string') out[k.slice(0, 64)] = value.slice(0, 256);
  }
  return out;
}

export function buildHit(
  req: HitRequest,
  ctx: { linkId: string; campaignId: string; destinationUrl: string; secret: string; geo: GeoLookup },
): NewHit {
  const ua = clip(first(req.headers['user-agent']), 512);
  const device = parseUserAgent(ua);
  const referrer = clip(first(req.headers['referer']), 1024);
  const geo = ctx.geo.lookup(req.ip, req.headers);
  return {
    link_id: ctx.linkId,
    campaign_id: ctx.campaignId,
    ip: req.ip,
    visitor_hash: visitorHash(ctx.secret, req.ip, ua),
    user_agent: ua,
    browser: device.browser,
    browser_version: device.browserVersion,
    os: device.os,
    os_version: device.osVersion,
    device_type: device.deviceType,
    device_vendor: device.deviceVendor,
    device_model: device.deviceModel,
    is_bot: device.isBot,
    referrer,
    referrer_host: referrerHost(referrer),
    language: primaryLanguage(first(req.headers['accept-language'])),
    country: geo.country,
    region: geo.region,
    city: geo.city,
    query: JSON.stringify(sanitiseQuery(req.query)),
    destination_url: ctx.destinationUrl,
  };
}

const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

/**
 * Final URL a visitor is sent to: the destination plus the link's UTM tags. Tags already present on
 * the destination are left untouched, and incoming utm_* params on the short link are passed through.
 */
export function resolveDestination(destination: string, utm: UtmParams, incoming: Record<string, unknown> = {}): string {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return destination;
  }
  for (const key of UTM_KEYS) {
    const name = `utm_${key}`;
    const passthrough = incoming[name];
    const value = typeof passthrough === 'string' && passthrough ? passthrough : utm[key];
    if (value && !url.searchParams.has(name)) url.searchParams.set(name, value);
  }
  return url.toString();
}
