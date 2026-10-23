// Mirrors of the server's API payloads.

export type ModuleShape = 'square' | 'rounded' | 'dots' | 'diamond' | 'vertical' | 'horizontal' | 'classy';
export type EyeOuterShape = 'square' | 'rounded' | 'extra-rounded' | 'circle' | 'leaf';
export type EyeInnerShape = 'square' | 'rounded' | 'circle' | 'diamond' | 'leaf' | 'star';
export type LogoPlate = 'none' | 'square' | 'rounded' | 'circle' | 'diamond';
export type FrameStyle = 'none' | 'card-pill' | 'banner-bottom' | 'banner-top' | 'outline-label';

export type Fill =
  | { type: 'solid'; color: string }
  | { type: 'linear'; from: string; to: string; angle: number }
  | { type: 'radial'; from: string; to: string };

export interface QrStyle {
  errorCorrection: 'L' | 'M' | 'Q' | 'H';
  margin: number;
  foreground: Fill;
  background: { color: string; transparent: boolean };
  modules: { shape: ModuleShape };
  eyes: { outerShape: EyeOuterShape; innerShape: EyeInnerShape; outerColor: string | null; innerColor: string | null };
  logo: {
    assetId: string | null;
    size: number;
    padding: number;
    plate: LogoPlate;
    plateColor: string;
    borderColor: string | null;
    excavate: boolean;
  };
  frame: {
    style: FrameStyle;
    color: string;
    innerColor: string;
    text: string;
    textColor: string;
    showIcon: boolean;
    rounding: number;
  };
}

export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface LinkStats {
  hits: number;
  uniqueVisitors: number;
  lastHitAt: string | null;
}

export interface Link {
  id: string;
  campaignId: string;
  code: string;
  shortUrl: string;
  sourceLabel: string;
  notes: string;
  destinationUrl: string | null;
  effectiveDestinationUrl: string;
  utm: Utm;
  qrStyle: QrStyle;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  stats: LinkStats;
  campaignName?: string;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  destinationUrl: string;
  defaultStyle: QrStyle;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
}

export interface CampaignSummary extends Campaign {
  linkCount: number;
  hits: number;
  hits7d: number;
}

export interface CampaignDetail extends Campaign {
  links: Link[];
}

export interface Template {
  id: string;
  name: string;
  style: QrStyle;
  createdAt: string;
  updatedAt: string;
}

export interface Me {
  id: string;
  name: string | null;
  email: string | null;
  authMode: 'entra' | 'dev';
}

export interface AppConfig {
  publicBaseUrl: string;
  authMode: 'entra' | 'dev';
  rawIpRetentionDays: number;
}

export interface Breakdown {
  key: string;
  hits: number;
  uniqueVisitors: number;
}

export interface CampaignStats {
  range: { from: string; to: string; tz: string; bucket: 'hour' | 'day' };
  totals: { hits: number; uniqueVisitors: number; bots: number };
  bySource: Array<{ linkId: string; hits: number; uniqueVisitors: number; lastHitAt: string | null }>;
  timeseries: Array<{ t: string; total: number; byLink: Record<string, number> }>;
  devices: Breakdown[];
  os: Breakdown[];
  browsers: Breakdown[];
  countries: Breakdown[];
  cities: Breakdown[];
  referrers: Breakdown[];
  languages: Breakdown[];
  heatmap: Array<{ dow: number; hour: number; hits: number }>;
  deviceBySource: Array<{ linkId: string; deviceType: string; hits: number }>;
}

export interface OverviewStats {
  range: { from: string; to: string; tz: string; bucket: 'day' };
  totals: { hits: number; uniqueVisitors: number; campaigns: number; links: number };
  timeseries: Array<{ t: string; total: number }>;
  topCampaigns: Array<{ id: string; name: string; hits: number }>;
}

export interface Hit {
  id: number;
  occurredAt: string;
  linkId: string;
  code: string;
  sourceLabel: string;
  ip: string | null;
  deviceType: string;
  deviceVendor: string | null;
  deviceModel: string | null;
  os: string | null;
  osVersion: string | null;
  browser: string | null;
  browserVersion: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  referrer: string | null;
  language: string | null;
  isBot: boolean;
  visitorId: string;
}

export interface HistoryEntry {
  id: number;
  entityType: 'campaign' | 'link' | 'template';
  entityId: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
  userName: string | null;
}

export interface PreviewResult {
  svg: string;
  width: number;
  height: number;
  version: number;
  modules: number;
  warnings: Array<{ code: string; message: string }>;
}
