import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound, parse, uuidParam } from '../http.js';
import { qrStyleSchema } from '../qr/style.js';
import { audit, templateDto } from '../services/repo.js';

const templateSchema = z.object({ name: z.string().trim().min(1).max(120), style: qrStyleSchema });

export async function templateRoutes(app: FastifyInstance) {
  const { db } = app.ctx;

  app.get('/api/templates', async () => {
    const rows = await db.selectFrom('qr_templates').selectAll().orderBy('name').execute();
    return rows.map(templateDto);
  });

  app.post('/api/templates', async (req, reply) => {
    const body = parse(templateSchema, req.body);
    const row = await db
      .insertInto('qr_templates')
      .values({ name: body.name, style: JSON.stringify(body.style), created_by: req.user!.uid, updated_by: req.user!.uid })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(db, { userId: req.user!.uid, entityType: 'template', entityId: row.id, action: 'created', details: { name: row.name } });
    return reply.code(201).send(templateDto(row));
  });

  app.get('/api/templates/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const row = await db.selectFrom('qr_templates').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Template');
    return templateDto(row);
  });

  app.put('/api/templates/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const body = parse(templateSchema, req.body);
    const row = await db
      .updateTable('qr_templates')
      .set({ name: body.name, style: JSON.stringify(body.style), updated_by: req.user!.uid, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw notFound('Template');
    return templateDto(row);
  });

  app.delete('/api/templates/:id', async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const res = await db.deleteFrom('qr_templates').where('id', '=', id).executeTakeFirst();
    if (Number(res.numDeletedRows) === 0) throw notFound('Template');
    return reply.code(204).send();
  });
}
