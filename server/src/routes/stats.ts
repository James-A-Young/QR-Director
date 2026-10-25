import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, notFound, parse, uuidParam } from '../http.js';
import { campaignStats, isValidTimezone, overviewStats, recentHitsQuery, type StatsFilter } from '../services/stats.js';

const DAY = 86_400_000;

const statsQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  /** Shorthand for "last N days" when from/to are omitted. */
  days: z.coerce.number().int().min(1).max(3660).default(30),
  tz: z.string().max(64).default('UTC'),
  includeBots: z.enum(['0', '1', 'true', 'false']).optional().transform((v) => v === '1' || v === 'true'),
  /** Comma separated link ids to restrict to. */
  links: z.string().max(4000).optional(),
});

export function buildFilter(raw: unknown, campaignId?: string): StatsFilter {
  const q = parse(statsQuery, raw);
  if (!isValidTimezone(q.tz)) throw new HttpError(400, 'invalid_timezone', `Unknown time zone "${q.tz}"`);
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - q.days * DAY);
  if (from >= to) throw new HttpError(400, 'invalid_range', '"from" must be before "to"');
  if (to.getTime() - from.getTime() > 3660 * DAY) throw new HttpError(400, 'invalid_range', 'Range is limited to 10 years');
  const linkIds = q.links?.split(',').map((s) => s.trim()).filter(Boolean);
  if (linkIds?.some((id) => !z.string().uuid().safeParse(id).success)) {
    throw new HttpError(400, 'invalid_links', 'links must be a comma separated list of ids');
  }
  return { campaignId, linkIds, from, to, tz: q.tz, includeBots: q.includeBots };
}

const CSV_PAGE_SIZE = 2000;
const CSV_MAX_ROWS = 1_000_000;

const CSV_COLUMNS = [
  'occurred_at', 'code', 'source', 'ip', 'country', 'region', 'city', 'device_type', 'device_vendor', 'device_model',
  'os', 'os_version', 'browser', 'browser_version', 'language', 'referrer', 'is_bot', 'visitor_id', 'query',
  'destination_url', 'user_agent',
] as const;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function statsRoutes(app: FastifyInstance) {
  const { db } = app.ctx;

  async function assertCampaign(id: string) {
    const c = await db.selectFrom('campaigns').select('id').where('id', '=', id).executeTakeFirst();
    if (!c) throw notFound('Campaign');
  }

  app.get('/api/stats/overview', async (req) => overviewStats(db, buildFilter(req.query)));

  app.get('/api/campaigns/:id/stats', async (req) => {
    const { id } = parse(uuidParam, req.params);
    await assertCampaign(id);
    return campaignStats(db, buildFilter(req.query, id));
  });

  app.get('/api/campaigns/:id/hits', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { limit, before } = parse(
      z.object({ limit: z.coerce.number().int().min(1).max(500).default(50), before: z.coerce.number().int().positive().optional() }),
      req.query,
    );
    await assertCampaign(id);
    let q = recentHitsQuery(db, buildFilter(req.query, id)).limit(limit + 1);
    if (before) q = q.where('hits.id', '<', before);
    const rows = await q.execute();
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        linkId: r.link_id,
        code: r.code,
        sourceLabel: r.source_label,
        ip: r.ip,
        deviceType: r.device_type,
        deviceVendor: r.device_vendor,
        deviceModel: r.device_model,
        os: r.os,
        osVersion: r.os_version,
        browser: r.browser,
        browserVersion: r.browser_version,
        country: r.country,
        region: r.region,
        city: r.city,
        referrer: r.referrer,
        language: r.language,
        isBot: r.is_bot,
        visitorId: r.visitor_hash,
        query: r.query,
      })),
      nextBefore: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  });

  app.get('/api/campaigns/:id/hits.csv', async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const campaign = await db.selectFrom('campaigns').select('name').where('id', '=', id).executeTakeFirst();
    if (!campaign) throw notFound('Campaign');
    const filter = buildFilter(req.query, id);

    // Stream in keyset pages so memory stays flat however many rows are exported.
    async function* rows() {
      yield `\uFEFF${CSV_COLUMNS.join(',')}\r\n`;
      let before: number | undefined;
      for (let exported = 0; exported < CSV_MAX_ROWS; ) {
        let q = recentHitsQuery(db, filter).limit(CSV_PAGE_SIZE);
        if (before !== undefined) q = q.where('hits.id', '<', before);
        const page = await q.execute();
        if (page.length === 0) return;
        let chunk = '';
        for (const r of page) {
          chunk +=
            [
              r.occurred_at, r.code, r.source_label, r.ip, r.country, r.region, r.city, r.device_type, r.device_vendor,
              r.device_model, r.os, r.os_version, r.browser, r.browser_version, r.language, r.referrer, r.is_bot,
              r.visitor_hash, r.query, r.destination_url, r.user_agent,
            ]
              .map(csvCell)
              .join(',') + '\r\n';
        }
        yield chunk;
        exported += page.length;
        before = page[page.length - 1]!.id;
        if (page.length < CSV_PAGE_SIZE) return;
      }
    }

    const slug = campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campaign';
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${slug}-hits.csv"`)
      .send(Readable.from(rows()));
  });
}
