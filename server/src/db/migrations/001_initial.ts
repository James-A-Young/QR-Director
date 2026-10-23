import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entra_oid text NOT NULL UNIQUE,
      email text,
      name text,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz
    )`.execute(db);

  await sql`
    CREATE TABLE assets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filename text NOT NULL,
      mime text NOT NULL,
      byte_size integer NOT NULL,
      sha256 text NOT NULL,
      data bytea NOT NULL,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  await sql`
    CREATE TABLE qr_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      style jsonb NOT NULL,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  await sql`
    CREATE TABLE campaigns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      destination_url text NOT NULL,
      default_style jsonb NOT NULL,
      archived_at timestamptz,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  await sql`
    CREATE TABLE links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
      source_label text NOT NULL,
      notes text NOT NULL DEFAULT '',
      destination_url text,
      utm jsonb NOT NULL DEFAULT '{}'::jsonb,
      qr_style jsonb NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX links_campaign_idx ON links (campaign_id)`.execute(db);

  await sql`
    CREATE TABLE hits (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      link_id uuid NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      ip inet,
      visitor_hash text NOT NULL,
      user_agent text,
      browser text,
      browser_version text,
      os text,
      os_version text,
      device_type text NOT NULL,
      device_vendor text,
      device_model text,
      is_bot boolean NOT NULL DEFAULT false,
      referrer text,
      referrer_host text,
      language text,
      country text,
      region text,
      city text,
      query jsonb NOT NULL DEFAULT '{}'::jsonb,
      destination_url text NOT NULL
    )`.execute(db);
  await sql`CREATE INDEX hits_campaign_time_idx ON hits (campaign_id, occurred_at)`.execute(db);
  await sql`CREATE INDEX hits_link_time_idx ON hits (link_id, occurred_at)`.execute(db);
  await sql`CREATE INDEX hits_time_idx ON hits (occurred_at)`.execute(db);

  await sql`
    CREATE TABLE audit_log (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      entity_type text NOT NULL,
      entity_id uuid NOT NULL,
      action text NOT NULL,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX audit_entity_idx ON audit_log (entity_type, entity_id, created_at DESC)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['audit_log', 'hits', 'links', 'campaigns', 'qr_templates', 'assets', 'users']) {
    await sql`DROP TABLE IF EXISTS ${sql.table(table)} CASCADE`.execute(db);
  }
}
