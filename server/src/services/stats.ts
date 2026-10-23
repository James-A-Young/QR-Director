import { sql, type RawBuilder, type SqlBool } from 'kysely';
import type { DB } from '../db/database.js';

export interface StatsFilter {
  campaignId?: string;
  linkIds?: string[];
  from: Date;
  to: Date;
  tz: string;
  includeBots: boolean;
}

const VALID_TIMEZONES = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
export const isValidTimezone = (tz: string) => VALID_TIMEZONES.has(tz);

/** WHERE clause over the hits table; raw SQL so it composes with queries that join other tables. */
export function hitsFilter(f: StatsFilter): RawBuilder<SqlBool> {
  const parts = [sql`hits.occurred_at >= ${f.from}`, sql`hits.occurred_at < ${f.to}`];
  if (f.campaignId) parts.push(sql`hits.campaign_id = ${f.campaignId}`);
  if (f.linkIds?.length) parts.push(sql`hits.link_id in (${sql.join(f.linkIds)})`);
  if (!f.includeBots) parts.push(sql`not hits.is_bot`);
  return sql<SqlBool>`${sql.join(parts, sql` and `)}`;
}

export type Bucket = 'hour' | 'day';

export function chooseBucket(from: Date, to: Date): Bucket {
  return to.getTime() - from.getTime() <= 3 * 86_400_000 ? 'hour' : 'day';
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Local wall-clock parts of an instant in a time zone (formatters are cached: they are costly). */
function localParts(date: Date, tz: string) {
  let fmt = formatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, fmt);
  }
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') };
}

/** Every bucket key in the range (formatted like Postgres: YYYY-MM-DDTHH:00), so charts show gaps as zeros. */
export function bucketKeys(from: Date, to: Date, tz: string, bucket: Bucket): string[] {
  const keys: string[] = [];
  if (to <= from) return keys;
  if (bucket === 'hour') {
    // Walk real hours; keys come from local wall time so DST shifts are handled.
    for (let t = from.getTime(); t < to.getTime(); t += 3_600_000) {
      const p = localParts(new Date(t), tz);
      const key = `${p.y}-${p.m}-${p.d}T${p.h}:00`;
      if (keys[keys.length - 1] !== key) keys.push(key);
    }
    return keys;
  }
  // Daily: enumerate calendar dates between the local first and last day (one step per day).
  const a = localParts(from, tz);
  const b = localParts(new Date(to.getTime() - 1), tz);
  const day = new Date(Date.UTC(Number(a.y), Number(a.m) - 1, Number(a.d)));
  const last = Date.UTC(Number(b.y), Number(b.m) - 1, Number(b.d));
  for (; day.getTime() <= last; day.setUTCDate(day.getUTCDate() + 1)) {
    keys.push(`${day.toISOString().slice(0, 10)}T00:00`);
  }
  return keys;
}

async function topValues(db: DB, f: StatsFilter, column: 'device_type' | 'os' | 'browser' | 'country' | 'city' | 'referrer_host' | 'language', limit = 15) {
  const rows = await db.selectFrom('hits').select((eb) => [
      sql<string | null>`${sql.ref(`hits.${column}`)}`.as('key'),
      eb.fn.countAll<number>().as('hits'),
      sql<number>`count(distinct hits.visitor_hash)::int`.as('unique_visitors'),
    ]).where(hitsFilter(f))
    .groupBy(`hits.${column}`)
    .orderBy('hits', 'desc')
    .limit(limit)
    .execute();
  return rows.map((r) => ({ key: r.key ?? 'Unknown', hits: Number(r.hits), uniqueVisitors: Number(r.unique_visitors) }));
}

export async function campaignStats(db: DB, f: StatsFilter) {
  const bucket = chooseBucket(f.from, f.to);
  const fmt = bucket === 'hour' ? 'YYYY-MM-DD"T"HH24:00' : 'YYYY-MM-DD"T00:00"';

  const [totals, bySource, series, devices, os, browsers, countries, cities, referrers, languages, heat, deviceBySource] =
    await Promise.all([
      db.selectFrom('hits').select((eb) => [
          eb.fn.countAll<number>().as('hits'),
          sql<number>`count(distinct hits.visitor_hash)::int`.as('unique_visitors'),
          sql<number>`count(*) filter (where hits.is_bot)::int`.as('bots'),
        ]).where(hitsFilter(f)).executeTakeFirstOrThrow(),
      db.selectFrom('hits').select((eb) => [
          'hits.link_id',
          eb.fn.countAll<number>().as('hits'),
          sql<number>`count(distinct hits.visitor_hash)::int`.as('unique_visitors'),
          eb.fn.max('hits.occurred_at').as('last_hit_at'),
        ]).where(hitsFilter(f))
        .groupBy('hits.link_id')
        .execute(),
      db.selectFrom('hits').select((eb) => [
          sql<string>`to_char(hits.occurred_at AT TIME ZONE ${f.tz}, ${fmt})`.as('bucket'),
          'hits.link_id',
          eb.fn.countAll<number>().as('hits'),
        ]).where(hitsFilter(f))
        .groupBy(['bucket', 'hits.link_id'])
        .execute(),
      topValues(db, f, 'device_type'),
      topValues(db, f, 'os'),
      topValues(db, f, 'browser'),
      topValues(db, f, 'country', 50),
      topValues(db, f, 'city', 25),
      topValues(db, f, 'referrer_host'),
      topValues(db, f, 'language'),
      db.selectFrom('hits').select((eb) => [
          sql<number>`extract(isodow from hits.occurred_at AT TIME ZONE ${f.tz})::int`.as('dow'),
          sql<number>`extract(hour from hits.occurred_at AT TIME ZONE ${f.tz})::int`.as('hour'),
          eb.fn.countAll<number>().as('hits'),
        ]).where(hitsFilter(f))
        .groupBy(['dow', 'hour'])
        .execute(),
      db.selectFrom('hits').select((eb) => ['hits.link_id', 'hits.device_type', eb.fn.countAll<number>().as('hits')]).where(hitsFilter(f))
        .groupBy(['hits.link_id', 'hits.device_type'])
        .execute(),
    ]);

  const keys = bucketKeys(f.from, f.to, f.tz, bucket);
  const points = new Map(keys.map((k) => [k, { t: k, total: 0, byLink: {} as Record<string, number> }]));
  for (const row of series) {
    let p = points.get(row.bucket);
    if (!p) {
      p = { t: row.bucket, total: 0, byLink: {} };
      points.set(row.bucket, p);
    }
    p.total += Number(row.hits);
    p.byLink[row.link_id] = (p.byLink[row.link_id] ?? 0) + Number(row.hits);
  }

  return {
    range: { from: f.from, to: f.to, tz: f.tz, bucket },
    totals: { hits: Number(totals.hits), uniqueVisitors: Number(totals.unique_visitors), bots: Number(totals.bots) },
    bySource: bySource.map((r) => ({
      linkId: r.link_id,
      hits: Number(r.hits),
      uniqueVisitors: Number(r.unique_visitors),
      lastHitAt: r.last_hit_at,
    })),
    timeseries: [...points.values()].sort((a, b) => a.t.localeCompare(b.t)),
    devices,
    os,
    browsers,
    countries,
    cities,
    referrers,
    languages,
    heatmap: heat.map((h) => ({ dow: Number(h.dow), hour: Number(h.hour), hits: Number(h.hits) })),
    deviceBySource: deviceBySource.map((r) => ({ linkId: r.link_id, deviceType: r.device_type, hits: Number(r.hits) })),
  };
}

export function recentHitsQuery(db: DB, f: StatsFilter) {
  return db
      .selectFrom('hits')
      .innerJoin('links', 'links.id', 'hits.link_id')
      .select([
        'hits.id',
        'hits.occurred_at',
        'hits.link_id',
        'links.code',
        'links.source_label',
        sql<string | null>`host(hits.ip)`.as('ip'),
        'hits.device_type',
        'hits.device_vendor',
        'hits.device_model',
        'hits.os',
        'hits.os_version',
        'hits.browser',
        'hits.browser_version',
        'hits.country',
        'hits.region',
        'hits.city',
        'hits.referrer',
        'hits.language',
        'hits.is_bot',
        'hits.visitor_hash',
        'hits.user_agent',
        'hits.query',
        'hits.destination_url',
      ]).where(hitsFilter(f)).orderBy('hits.id', 'desc');
}

export async function overviewStats(db: DB, f: StatsFilter) {
  const bucket: Bucket = 'day';
  const [totals, series, top, counts] = await Promise.all([
    db.selectFrom('hits').select((eb) => [
        eb.fn.countAll<number>().as('hits'),
        sql<number>`count(distinct hits.visitor_hash)::int`.as('unique_visitors'),
      ]).where(hitsFilter(f)).executeTakeFirstOrThrow(),
    db.selectFrom('hits').select((eb) => [
        sql<string>`to_char(hits.occurred_at AT TIME ZONE ${f.tz}, 'YYYY-MM-DD"T00:00"')`.as('bucket'),
        eb.fn.countAll<number>().as('hits'),
      ]).where(hitsFilter(f))
      .groupBy('bucket')
      .execute(),
    db
        .selectFrom('hits')
        .innerJoin('campaigns', 'campaigns.id', 'hits.campaign_id')
        .select((eb) => ['campaigns.id', 'campaigns.name', eb.fn.countAll<number>().as('hits')]).where(hitsFilter(f))
      .groupBy(['campaigns.id', 'campaigns.name'])
      .orderBy('hits', 'desc')
      .limit(8)
      .execute(),
    db
      .selectNoFrom((eb) => [
        eb.selectFrom('campaigns').where('archived_at', 'is', null).select(eb.fn.countAll<number>().as('n')).as('campaigns'),
        eb.selectFrom('links').select(eb.fn.countAll<number>().as('n')).as('links'),
      ])
      .executeTakeFirstOrThrow(),
  ]);
  const byKey = new Map(series.map((s) => [s.bucket, Number(s.hits)]));
  return {
    range: { from: f.from, to: f.to, tz: f.tz, bucket },
    totals: {
      hits: Number(totals.hits),
      uniqueVisitors: Number(totals.unique_visitors),
      campaigns: Number(counts.campaigns ?? 0),
      links: Number(counts.links ?? 0),
    },
    timeseries: bucketKeys(f.from, f.to, f.tz, bucket).map((t) => ({ t, total: byKey.get(t) ?? 0 })),
    topCampaigns: top.map((t) => ({ id: t.id, name: t.name, hits: Number(t.hits) })),
  };
}
