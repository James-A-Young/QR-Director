import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { QrStyle } from '../qr/style.js';

type Timestamp = ColumnType<Date, Date | string, Date | string>;
/** Timestamp with a database default: optional on insert. */
type DefaultTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Json<T> = ColumnType<T, T | string, T | string>;

export interface UtmParams {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface UsersTable {
  id: Generated<string>;
  entra_oid: string;
  email: string | null;
  name: string | null;
  created_at: DefaultTimestamp;
  last_login_at: Timestamp | null;
}

export interface AssetsTable {
  id: Generated<string>;
  filename: string;
  mime: string;
  byte_size: number;
  sha256: string;
  data: Buffer;
  created_by: string | null;
  created_at: DefaultTimestamp;
}

export interface QrTemplatesTable {
  id: Generated<string>;
  name: string;
  style: Json<QrStyle>;
  created_by: string | null;
  updated_by: string | null;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface CampaignsTable {
  id: Generated<string>;
  name: string;
  description: string;
  destination_url: string;
  default_style: Json<QrStyle>;
  archived_at: Timestamp | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface LinksTable {
  id: Generated<string>;
  campaign_id: string;
  code: string;
  source_label: string;
  notes: string;
  /** Overrides the campaign destination when set. */
  destination_url: string | null;
  utm: Json<UtmParams>;
  qr_style: Json<QrStyle>;
  active: Generated<boolean>;
  created_by: string | null;
  updated_by: string | null;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface HitsTable {
  id: Generated<number>;
  link_id: string;
  campaign_id: string;
  occurred_at: DefaultTimestamp;
  ip: string | null;
  visitor_hash: string;
  user_agent: string | null;
  browser: string | null;
  browser_version: string | null;
  os: string | null;
  os_version: string | null;
  device_type: string;
  device_vendor: string | null;
  device_model: string | null;
  is_bot: boolean;
  referrer: string | null;
  referrer_host: string | null;
  language: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  query: Json<Record<string, string>>;
  destination_url: string;
}

export interface AuditLogTable {
  id: Generated<number>;
  user_id: string | null;
  entity_type: 'campaign' | 'link' | 'template';
  entity_id: string;
  action: string;
  details: Json<Record<string, unknown>>;
  created_at: DefaultTimestamp;
}

export interface Database {
  users: UsersTable;
  assets: AssetsTable;
  qr_templates: QrTemplatesTable;
  campaigns: CampaignsTable;
  links: LinksTable;
  hits: HitsTable;
  audit_log: AuditLogTable;
}

export type User = Selectable<UsersTable>;
export type Campaign = Selectable<CampaignsTable>;
export type NewCampaign = Insertable<CampaignsTable>;
export type CampaignUpdate = Updateable<CampaignsTable>;
export type Link = Selectable<LinksTable>;
export type NewLink = Insertable<LinksTable>;
export type LinkUpdate = Updateable<LinksTable>;
export type NewHit = Insertable<HitsTable>;
export type QrTemplate = Selectable<QrTemplatesTable>;
export type Asset = Selectable<AssetsTable>;
