import { sql } from 'kysely';
import type { DB } from '../db/database.js';
import type { Campaign, Link, QrTemplate } from '../db/schema.js';
import { parseStyle } from '../qr/style.js';
import type { Config } from '../config.js';

export function shortUrl(config: Pick<Config, 'PUBLIC_BASE_URL'>, code: string): string {
  return `${config.PUBLIC_BASE_URL}/${code}`;
}

export interface LinkStats {
  hits: number;
  uniqueVisitors: number;
  lastHitAt: Date | null;
}

export function linkDto(config: Config, link: Link, campaign: Pick<Campaign, 'destination_url'>, stats?: LinkStats) {
  return {
    id: link.id,
    campaignId: link.campaign_id,
    code: link.code,
    shortUrl: shortUrl(config, link.code),
    sourceLabel: link.source_label,
    notes: link.notes,
    destinationUrl: link.destination_url,
    effectiveDestinationUrl: link.destination_url ?? campaign.destination_url,
    utm: link.utm,
    qrStyle: parseStyle(link.qr_style),
    active: link.active,
    createdAt: link.created_at,
    updatedAt: link.updated_at,
    stats: stats ?? { hits: 0, uniqueVisitors: 0, lastHitAt: null },
  };
}

export function campaignDto(campaign: Campaign & { created_by_name?: string | null }) {
  return {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    destinationUrl: campaign.destination_url,
    defaultStyle: parseStyle(campaign.default_style),
    archived: campaign.archived_at !== null,
    archivedAt: campaign.archived_at,
    createdAt: campaign.created_at,
    updatedAt: campaign.updated_at,
    createdByName: campaign.created_by_name ?? null,
  };
}

export function templateDto(t: QrTemplate) {
  return { id: t.id, name: t.name, style: parseStyle(t.style), createdAt: t.created_at, updatedAt: t.updated_at };
}

/** Hit totals per link (bots excluded). */
export async function statsByLink(db: DB, linkIds: string[]): Promise<Map<string, LinkStats>> {
  const map = new Map<string, LinkStats>();
  if (linkIds.length === 0) return map;
  const rows = await db
    .selectFrom('hits')
    .select((eb) => [
      'link_id',
      eb.fn.countAll<number>().as('hits'),
      sql<number>`count(distinct visitor_hash)::int`.as('unique_visitors'),
      eb.fn.max('occurred_at').as('last_hit_at'),
    ])
    .where('link_id', 'in', linkIds)
    .where('is_bot', '=', false)
    .groupBy('link_id')
    .execute();
  for (const r of rows) {
    map.set(r.link_id, { hits: Number(r.hits), uniqueVisitors: Number(r.unique_visitors), lastHitAt: r.last_hit_at as Date | null });
  }
  return map;
}

export async function audit(
  db: DB,
  entry: { userId: string; entityType: 'campaign' | 'link' | 'template'; entityId: string; action: string; details?: Record<string, unknown> },
) {
  await db
    .insertInto('audit_log')
    .values({
      user_id: entry.userId,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      action: entry.action,
      details: JSON.stringify(entry.details ?? {}),
    })
    .execute();
}

const logoCache = new Map<string, string>();
const LOGO_CACHE_MAX = 100;

/** Load a logo asset as a data URI. Assets are immutable, so they are cached in memory. */
export async function loadLogoHref(db: DB, assetId: string | null): Promise<string | null> {
  if (!assetId) return null;
  const cached = logoCache.get(assetId);
  if (cached) return cached;
  const asset = await db.selectFrom('assets').select(['mime', 'data']).where('id', '=', assetId).executeTakeFirst();
  if (!asset) return null;
  const href = `data:${asset.mime};base64,${asset.data.toString('base64')}`;
  if (logoCache.size >= LOGO_CACHE_MAX) logoCache.delete(logoCache.keys().next().value!);
  logoCache.set(assetId, href);
  return href;
}
