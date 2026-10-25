import type {
  AppConfig,
  CampaignDetail,
  CampaignStats,
  CampaignSummary,
  HistoryEntry,
  Hit,
  Link,
  Me,
  OverviewStats,
  PreviewResult,
  QrStyle,
  Template,
  Utm,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }

  /** Message for a particular field, if validation failed on it. */
  field(path: string): string | undefined {
    return this.details?.find((d) => d.path === path || d.path.startsWith(`${path}.`))?.message;
  }
}

export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      // Required by the server on mutations (CSRF guard).
      'x-qrd-request': '1',
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? `Request failed (${res.status})`, data?.details);
  }
  return data as T;
}

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export interface LinkInput {
  sourceLabel: string;
  code?: string;
  notes?: string;
  destinationUrl?: string | null;
  utm?: Utm;
  qrStyle?: QrStyle;
  active?: boolean;
}

export interface StatsParams {
  days?: number;
  from?: string;
  to?: string;
  tz?: string;
  includeBots?: boolean;
  links?: string;
}

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export const api = {
  me: () => request<Me>('GET', '/api/me'),
  config: () => request<AppConfig>('GET', '/api/config'),

  campaigns: (params: { archived?: 'exclude' | 'include' | 'only'; search?: string } = {}) =>
    request<CampaignSummary[]>('GET', `/api/campaigns${qs(params)}`),
  campaign: (id: string) => request<CampaignDetail>('GET', `/api/campaigns/${id}`),
  createCampaign: (body: { name: string; description?: string; destinationUrl: string; templateId?: string; links?: LinkInput[] }) =>
    request<CampaignDetail>('POST', '/api/campaigns', body),
  updateCampaign: (
    id: string,
    body: Partial<{ name: string; description: string; destinationUrl: string; defaultStyle: QrStyle; archived: boolean }>,
  ) => request<CampaignDetail>('PATCH', `/api/campaigns/${id}`, body),
  deleteCampaign: (id: string) => request<void>('DELETE', `/api/campaigns/${id}`),
  applyStyle: (id: string, style: QrStyle) => request<CampaignDetail>('POST', `/api/campaigns/${id}/apply-style`, { style }),
  history: (id: string) => request<HistoryEntry[]>('GET', `/api/campaigns/${id}/history`),

  link: (id: string) => request<Link>('GET', `/api/links/${id}`),
  createLink: (campaignId: string, body: LinkInput) => request<Link>('POST', `/api/campaigns/${campaignId}/links`, body),
  updateLink: (id: string, body: Partial<LinkInput>) => request<Link>('PATCH', `/api/links/${id}`, body),
  deleteLink: (id: string) => request<void>('DELETE', `/api/links/${id}`),
  codeAvailable: (code: string) =>
    request<{ code: string; available: boolean; reason: string | null }>('GET', `/api/codes/${encodeURIComponent(code)}`),

  templates: () => request<Template[]>('GET', '/api/templates'),
  template: (id: string) => request<Template>('GET', `/api/templates/${id}`),
  createTemplate: (body: { name: string; style: QrStyle }) => request<Template>('POST', '/api/templates', body),
  updateTemplate: (id: string, body: { name: string; style: QrStyle }) => request<Template>('PUT', `/api/templates/${id}`, body),
  deleteTemplate: (id: string) => request<void>('DELETE', `/api/templates/${id}`),

  uploadAsset: (filename: string, data: string) =>
    request<{ id: string; filename: string; mime: string; size: number }>('POST', '/api/assets', { filename, data }),

  preview: (style: QrStyle, opts: { linkId?: string; code?: string } = {}) =>
    request<PreviewResult>('POST', '/api/qr/preview', { style, ...opts }),
  qrUrl: (linkId: string, opts: { format: 'png' | 'svg'; width: number; unit: 'px' | 'mm' | 'in'; dpi?: number; download?: boolean }) =>
    `/api/links/${linkId}/qr${qs({ ...opts, download: opts.download ? 1 : undefined })}`,

  overview: (params: StatsParams) => request<OverviewStats>('GET', `/api/stats/overview${qs({ tz: browserTimeZone(), ...params })}`),
  campaignStats: (id: string, params: StatsParams) =>
    request<CampaignStats>('GET', `/api/campaigns/${id}/stats${qs({ tz: browserTimeZone(), ...params })}`),
  hits: (id: string, params: StatsParams & { limit?: number; before?: number }) =>
    request<{ items: Hit[]; nextBefore: number | null }>('GET', `/api/campaigns/${id}/hits${qs({ tz: browserTimeZone(), ...params })}`),
  hitsCsvUrl: (id: string, params: StatsParams) => `/api/campaigns/${id}/hits.csv${qs({ tz: browserTimeZone(), ...params })}`,
};
