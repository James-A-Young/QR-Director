import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { DEFAULT_STYLE } from '../components/designer/presets';
import type { CampaignDetail, Link } from '../lib/types';

type Handler = (req: { url: URL; method: string; body: unknown }) => unknown;
export interface MockCall {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

/**
 * Route-table fetch mock. Keys are "METHOD /path" (query string ignored). Handlers return a JSON
 * body, or a `Response` for full control. Unmatched requests fail the test loudly.
 */
export function mockApi(routes: Record<string, Handler | object | null>) {
  const calls: MockCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = `${method} ${url.pathname}`;
    if (!(key in routes)) throw new Error(`Unmocked request: ${key}`);
    const route = routes[key];
    const result = typeof route === 'function' ? (route as Handler)({ url, method, body }) : route;
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result ?? null), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

export function renderRoutes(routes: RouteObject[], initialPath: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const utils = renderWithProviders(<RouterProvider router={router} />);
  return { ...utils, router };
}

export const ME = { id: 'u1', name: 'Alex Example', email: 'alex@example.com', authMode: 'dev' as const };

export function makeLink(overrides: Partial<Link> = {}): Link {
  return {
    id: 'l1',
    campaignId: 'c1',
    code: 'expo',
    shortUrl: 'https://go.example.com/expo',
    sourceLabel: 'Expo stand',
    notes: '',
    destinationUrl: null,
    effectiveDestinationUrl: 'https://example.com/spring',
    utm: {},
    qrStyle: DEFAULT_STYLE,
    active: true,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
    stats: { hits: 12, uniqueVisitors: 9, lastHitAt: '2026-10-20T10:00:00Z' },
    ...overrides,
  };
}

export function makeCampaign(overrides: Partial<CampaignDetail> = {}): CampaignDetail {
  return {
    id: 'c1',
    name: 'Spring launch',
    description: '',
    destinationUrl: 'https://example.com/spring',
    defaultStyle: DEFAULT_STYLE,
    archived: false,
    archivedAt: null,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
    createdByName: 'Alex',
    links: [makeLink(), makeLink({ id: 'l2', code: 'brochure', sourceLabel: 'Brochure', stats: { hits: 3, uniqueVisitors: 3, lastHitAt: null } })],
    ...overrides,
  };
}

export const PREVIEW = { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', width: 35, height: 35, version: 2, modules: 25, warnings: [] };
