import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import type { Link } from '../db/schema.js';
import { HttpError, httpUrl, notFound, parse, uuidParam } from '../http.js';
import { defaultStyle, parseStyle, qrStyleSchema } from '../qr/style.js';
import { generateCode, normaliseCode, validateCode } from '../services/codes.js';
import { audit, campaignDto, linkDto, statsByLink } from '../services/repo.js';

const utmSchema = z
  .object({
    source: z.string().trim().max(200).optional(),
    medium: z.string().trim().max(200).optional(),
    campaign: z.string().trim().max(200).optional(),
    term: z.string().trim().max(200).optional(),
    content: z.string().trim().max(200).optional(),
  })
  .transform((u) => Object.fromEntries(Object.entries(u).filter(([, v]) => v)) as typeof u);

const codeInput = z
  .string()
  .transform(normaliseCode)
  .superRefine((code, ctx) => {
    const problem = validateCode(code);
    if (problem === 'invalid') {
      ctx.addIssue({ code: 'custom', message: 'Use 2-64 lower-case letters, digits or hyphens, starting with a letter or digit' });
    } else if (problem === 'reserved') {
      ctx.addIssue({ code: 'custom', message: 'This code is reserved by QR Director' });
    }
  });

const linkCreateSchema = z.object({
  sourceLabel: z.string().trim().min(1).max(120),
  code: codeInput.optional(),
  notes: z.string().max(2000).default(''),
  destinationUrl: httpUrl.nullable().optional(),
  utm: utmSchema.default({}),
  qrStyle: qrStyleSchema.optional(),
  active: z.boolean().default(true),
});

const linkUpdateSchema = z.object({
  sourceLabel: z.string().trim().min(1).max(120).optional(),
  code: codeInput.optional(),
  notes: z.string().max(2000).optional(),
  destinationUrl: httpUrl.nullable().optional(),
  utm: utmSchema.optional(),
  qrStyle: qrStyleSchema.optional(),
  active: z.boolean().optional(),
});

const campaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(4000).default(''),
  destinationUrl: httpUrl,
  defaultStyle: qrStyleSchema.optional(),
  templateId: z.string().uuid().optional(),
  /** Variants to create up front. Defaults to a single "Default" link. */
  links: z.array(linkCreateSchema).max(50).optional(),
});

const campaignUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(4000).optional(),
  destinationUrl: httpUrl.optional(),
  defaultStyle: qrStyleSchema.optional(),
  archived: z.boolean().optional(),
});

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === '23505';

/** Insert a link, generating a random code (with retries on the rare collision) when none was given. */
async function insertLink(
  db: DB,
  campaignId: string,
  input: z.infer<typeof linkCreateSchema>,
  style: unknown,
  userId: string,
): Promise<Link> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = input.code ?? generateCode(attempt < 5 ? 6 : 8);
    // ON CONFLICT DO NOTHING (rather than catching the error) keeps an enclosing transaction usable.
    const link = await db
      .insertInto('links')
      .values({
        campaign_id: campaignId,
        code,
        source_label: input.sourceLabel,
        notes: input.notes,
        destination_url: input.destinationUrl ?? null,
        utm: JSON.stringify(input.utm),
        qr_style: JSON.stringify(input.qrStyle ?? parseStyle(style)),
        active: input.active,
        created_by: userId,
        updated_by: userId,
      })
      .onConflict((oc) => oc.column('code').doNothing())
      .returningAll()
      .executeTakeFirst();
    if (link) return link;
    if (input.code) throw new HttpError(409, 'code_taken', `The code "${input.code}" is already in use`);
  }
  throw new HttpError(503, 'code_generation_failed', 'Could not allocate a unique code, please retry');
}

export async function campaignRoutes(app: FastifyInstance) {
  const { db, config } = app.ctx;
  const userId = (req: FastifyRequest) => req.user!.uid;

  async function loadCampaignWithLinks(id: string) {
    const campaign = await db
      .selectFrom('campaigns')
      .leftJoin('users', 'users.id', 'campaigns.created_by')
      .selectAll('campaigns')
      .select('users.name as created_by_name')
      .where('campaigns.id', '=', id)
      .executeTakeFirst();
    if (!campaign) throw notFound('Campaign');
    const links = await db.selectFrom('links').selectAll().where('campaign_id', '=', id).orderBy('created_at').execute();
    const stats = await statsByLink(db, links.map((l) => l.id));
    return { ...campaignDto(campaign), links: links.map((l) => linkDto(config, l, campaign, stats.get(l.id))) };
  }

  app.get('/api/campaigns', async (req) => {
    const q = parse(
      z.object({ archived: z.enum(['exclude', 'include', 'only']).default('exclude'), search: z.string().max(200).optional() }),
      req.query,
    );
    let query = db
      .selectFrom('campaigns')
      .leftJoin('users', 'users.id', 'campaigns.created_by')
      .selectAll('campaigns')
      .select('users.name as created_by_name')
      .select((eb) => [
        eb.selectFrom('links').whereRef('links.campaign_id', '=', 'campaigns.id').select(eb.fn.countAll<number>().as('n')).as('link_count'),
        eb
          .selectFrom('hits')
          .whereRef('hits.campaign_id', '=', 'campaigns.id')
          .where('hits.is_bot', '=', false)
          .select(eb.fn.countAll<number>().as('n'))
          .as('hit_count'),
        eb
          .selectFrom('hits')
          .whereRef('hits.campaign_id', '=', 'campaigns.id')
          .where('hits.is_bot', '=', false)
          .where('hits.occurred_at', '>', sql<Date>`now() - interval '7 days'`)
          .select(eb.fn.countAll<number>().as('n'))
          .as('hit_count_7d'),
      ])
      .orderBy('campaigns.updated_at', 'desc');
    if (q.archived === 'exclude') query = query.where('campaigns.archived_at', 'is', null);
    if (q.archived === 'only') query = query.where('campaigns.archived_at', 'is not', null);
    if (q.search) {
      const term = `%${q.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      query = query.where((eb) =>
        eb.or([
          eb('campaigns.name', 'ilike', term),
          eb('campaigns.description', 'ilike', term),
          eb.exists(
            eb
              .selectFrom('links')
              .whereRef('links.campaign_id', '=', 'campaigns.id')
              .where((e) => e.or([e('links.code', 'ilike', term), e('links.source_label', 'ilike', term)]))
              .select('links.id'),
          ),
        ]),
      );
    }
    const rows = await query.execute();
    return rows.map((r) => ({
      ...campaignDto(r),
      linkCount: Number(r.link_count ?? 0),
      hits: Number(r.hit_count ?? 0),
      hits7d: Number(r.hit_count_7d ?? 0),
    }));
  });

  app.post('/api/campaigns', async (req, reply) => {
    const body = parse(campaignCreateSchema, req.body);
    let style = body.defaultStyle ?? defaultStyle;
    if (body.templateId && !body.defaultStyle) {
      const template = await db.selectFrom('qr_templates').select('style').where('id', '=', body.templateId).executeTakeFirst();
      if (!template) throw notFound('Template');
      style = parseStyle(template.style);
    }
    const id = await db.transaction().execute(async (trx) => {
      const campaign = await trx
        .insertInto('campaigns')
        .values({
          name: body.name,
          description: body.description,
          destination_url: body.destinationUrl,
          default_style: JSON.stringify(style),
          created_by: userId(req),
          updated_by: userId(req),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const variants = body.links?.length ? body.links : [parse(linkCreateSchema, { sourceLabel: 'Default' })];
      const seen = new Set<string>();
      for (const v of variants) {
        if (v.code && seen.has(v.code)) throw new HttpError(409, 'code_taken', `The code "${v.code}" is used twice`);
        if (v.code) seen.add(v.code);
        await insertLink(trx, campaign.id, v, style, userId(req));
      }
      await audit(trx, { userId: userId(req), entityType: 'campaign', entityId: campaign.id, action: 'created', details: { name: body.name } });
      return campaign.id;
    });
    return reply.code(201).send(await loadCampaignWithLinks(id));
  });

  app.get('/api/campaigns/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    return loadCampaignWithLinks(id);
  });

  app.patch('/api/campaigns/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const body = parse(campaignUpdateSchema, req.body);
    const before = await db.selectFrom('campaigns').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw notFound('Campaign');
    await db
      .updateTable('campaigns')
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.destinationUrl !== undefined && { destination_url: body.destinationUrl }),
        ...(body.defaultStyle !== undefined && { default_style: JSON.stringify(body.defaultStyle) }),
        ...(body.archived !== undefined && { archived_at: body.archived ? (before.archived_at ?? new Date()) : null }),
        updated_by: userId(req),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
    const changes: Record<string, unknown> = {};
    if (body.destinationUrl !== undefined && body.destinationUrl !== before.destination_url) {
      changes.destinationUrl = { from: before.destination_url, to: body.destinationUrl };
    }
    if (body.name !== undefined && body.name !== before.name) changes.name = { from: before.name, to: body.name };
    if (body.archived !== undefined && body.archived !== (before.archived_at !== null)) changes.archived = body.archived;
    if (body.defaultStyle !== undefined) changes.defaultStyle = true;
    if (Object.keys(changes).length > 0) {
      await audit(db, { userId: userId(req), entityType: 'campaign', entityId: id, action: 'updated', details: changes });
    }
    return loadCampaignWithLinks(id);
  });

  app.delete('/api/campaigns/:id', async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const res = await db.deleteFrom('campaigns').where('id', '=', id).executeTakeFirst();
    if (Number(res.numDeletedRows) === 0) throw notFound('Campaign');
    return reply.code(204).send();
  });

  /** Apply a style to every link of a campaign (and make it the campaign default). */
  app.post('/api/campaigns/:id/apply-style', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { style } = parse(z.object({ style: qrStyleSchema }), req.body);
    await db.transaction().execute(async (trx) => {
      const res = await trx
        .updateTable('campaigns')
        .set({ default_style: JSON.stringify(style), updated_by: userId(req), updated_at: new Date() })
        .where('id', '=', id)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) === 0) throw notFound('Campaign');
      await trx
        .updateTable('links')
        .set({ qr_style: JSON.stringify(style), updated_by: userId(req), updated_at: new Date() })
        .where('campaign_id', '=', id)
        .execute();
    });
    return loadCampaignWithLinks(id);
  });

  app.get('/api/campaigns/:id/history', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const linkIds = db.selectFrom('links').select('id').where('campaign_id', '=', id);
    const rows = await db
      .selectFrom('audit_log')
      .leftJoin('users', 'users.id', 'audit_log.user_id')
      .select([
        'audit_log.id',
        'audit_log.entity_type',
        'audit_log.entity_id',
        'audit_log.action',
        'audit_log.details',
        'audit_log.created_at',
        'users.name as user_name',
      ])
      .where((eb) => eb.or([eb('audit_log.entity_id', '=', id), eb('audit_log.entity_id', 'in', linkIds)]))
      .orderBy('audit_log.created_at', 'desc')
      .orderBy('audit_log.id', 'desc')
      .limit(200)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      details: r.details,
      createdAt: r.created_at,
      userName: r.user_name,
    }));
  });

  // ---- links -------------------------------------------------------------------------------

  app.post('/api/campaigns/:id/links', async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const body = parse(linkCreateSchema, req.body);
    const campaign = await db.selectFrom('campaigns').selectAll().where('id', '=', id).executeTakeFirst();
    if (!campaign) throw notFound('Campaign');
    const link = await insertLink(db, id, body, campaign.default_style, userId(req));
    await audit(db, {
      userId: userId(req),
      entityType: 'link',
      entityId: link.id,
      action: 'created',
      details: { code: link.code, sourceLabel: link.source_label },
    });
    return reply.code(201).send(linkDto(config, link, campaign));
  });

  async function loadLink(id: string) {
    const link = await db.selectFrom('links').selectAll().where('id', '=', id).executeTakeFirst();
    if (!link) throw notFound('Link');
    const campaign = await db.selectFrom('campaigns').selectAll().where('id', '=', link.campaign_id).executeTakeFirstOrThrow();
    const stats = await statsByLink(db, [link.id]);
    return { ...linkDto(config, link, campaign, stats.get(link.id)), campaignName: campaign.name };
  }

  app.get('/api/links/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    return loadLink(id);
  });

  app.patch('/api/links/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const body = parse(linkUpdateSchema, req.body);
    const before = await db.selectFrom('links').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw notFound('Link');
    try {
      await db
        .updateTable('links')
        .set({
          ...(body.sourceLabel !== undefined && { source_label: body.sourceLabel }),
          ...(body.code !== undefined && { code: body.code }),
          ...(body.notes !== undefined && { notes: body.notes }),
          ...(body.destinationUrl !== undefined && { destination_url: body.destinationUrl }),
          ...(body.utm !== undefined && { utm: JSON.stringify(body.utm) }),
          ...(body.qrStyle !== undefined && { qr_style: JSON.stringify(body.qrStyle) }),
          ...(body.active !== undefined && { active: body.active }),
          updated_by: userId(req),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'code_taken', `The code "${body.code}" is already in use`);
      throw err;
    }
    const changes: Record<string, unknown> = {};
    if (body.destinationUrl !== undefined && body.destinationUrl !== before.destination_url) {
      changes.destinationUrl = { from: before.destination_url, to: body.destinationUrl };
    }
    if (body.code !== undefined && body.code !== before.code) changes.code = { from: before.code, to: body.code };
    if (body.sourceLabel !== undefined && body.sourceLabel !== before.source_label) {
      changes.sourceLabel = { from: before.source_label, to: body.sourceLabel };
    }
    if (body.active !== undefined && body.active !== before.active) changes.active = body.active;
    if (body.utm !== undefined) changes.utm = body.utm;
    if (body.qrStyle !== undefined) changes.qrStyle = true;
    if (Object.keys(changes).length > 0) {
      await audit(db, { userId: userId(req), entityType: 'link', entityId: id, action: 'updated', details: changes });
    }
    return loadLink(id);
  });

  app.delete('/api/links/:id', async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const res = await db.deleteFrom('links').where('id', '=', id).executeTakeFirst();
    if (Number(res.numDeletedRows) === 0) throw notFound('Link');
    return reply.code(204).send();
  });

  app.get('/api/codes/:code', async (req) => {
    const code = normaliseCode(String((req.params as { code: string }).code));
    const problem = validateCode(code);
    if (problem) return { code, available: false, reason: problem };
    const existing = await db.selectFrom('links').select('id').where('code', '=', code).executeTakeFirst();
    return { code, available: !existing, reason: existing ? 'taken' : null };
  });
}
