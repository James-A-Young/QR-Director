import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { routes } from '../App';
import { DEFAULT_STYLE } from '../components/designer/presets';
import { jsonResponse, makeCampaign, makeLink, ME, mockApi, PREVIEW, renderRoutes } from './utils';

beforeAll(() => {
  // jsdom lacks these browser APIs used by dialogs and charts.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(() => vi.unstubAllGlobals());

const STATS = {
  range: { from: '', to: '', tz: 'UTC', bucket: 'day' },
  totals: { hits: 15, uniqueVisitors: 12, bots: 2 },
  bySource: [
    { linkId: 'l1', hits: 12, uniqueVisitors: 9, lastHitAt: '2026-10-20T10:00:00Z' },
    { linkId: 'l2', hits: 3, uniqueVisitors: 3, lastHitAt: null },
  ],
  timeseries: [{ t: '2026-10-20T00:00', total: 15, byLink: { l1: 12, l2: 3 } }],
  devices: [{ key: 'mobile', hits: 14, uniqueVisitors: 11 }, { key: 'desktop', hits: 1, uniqueVisitors: 1 }],
  os: [],
  browsers: [],
  countries: [{ key: 'GB', hits: 15, uniqueVisitors: 12 }],
  cities: [],
  referrers: [],
  languages: [],
  heatmap: [],
  deviceBySource: [{ linkId: 'l1', deviceType: 'mobile', hits: 12 }],
};

describe('routing and auth', () => {
  it('redirects to sign-in when the session is missing', async () => {
    mockApi({ 'GET /api/me': () => jsonResponse(401, { error: 'unauthenticated' }) });
    const { router } = renderRoutes(routes, '/campaigns');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    const link = await screen.findByRole('link', { name: /sign in with microsoft/i });
    expect(link).toHaveAttribute('href', '/auth/login?returnTo=%2Fapp%2Fcampaigns');
  });
});

describe('campaigns', () => {
  it('lists campaigns and searches', async () => {
    const { calls } = mockApi({
      'GET /api/me': ME,
      'GET /api/campaigns': ({ url }) =>
        url.searchParams.get('search') === 'nothing'
          ? []
          : [{ ...makeCampaign(), linkCount: 2, hits: 15, hits7d: 4 }],
    });
    renderRoutes(routes, '/campaigns');
    expect(await screen.findByText('Spring launch')).toBeInTheDocument();
    expect(screen.getByText(/2 sources/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search campaigns'), 'nothing');
    expect(await screen.findByText('No matching campaigns')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/campaigns')).toBe(true);
  });

  it('creates a campaign with several sources', async () => {
    const { calls } = mockApi({
      'GET /api/me': ME,
      'GET /api/campaigns': [],
      'GET /api/templates': [],
      'POST /api/campaigns': makeCampaign({ id: 'new-1' }),
      'GET /api/campaigns/new-1': makeCampaign({ id: 'new-1' }),
      'POST /api/qr/preview': PREVIEW,
    });
    const { router } = renderRoutes(routes, '/campaigns');
    await userEvent.click((await screen.findAllByRole('button', { name: /new campaign/i }))[0]!);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Campaign name'), 'Autumn fair');
    const url = within(dialog).getByLabelText('Destination URL');
    await userEvent.clear(url);
    await userEvent.type(url, 'https://example.com/autumn');
    await userEvent.type(within(dialog).getByLabelText('Source 1'), 'Stand A');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add source' }));
    await userEvent.type(within(dialog).getByLabelText('Source 2'), 'Flyer');
    await userEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/campaigns/new-1'));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/campaigns')!;
    expect(post.body).toEqual({
      name: 'Autumn fair',
      description: '',
      destinationUrl: 'https://example.com/autumn',
      links: [{ sourceLabel: 'Stand A' }, { sourceLabel: 'Flyer' }],
    });
  });

  it('shows sources and pauses one', async () => {
    let campaign = makeCampaign();
    const { calls } = mockApi({
      'GET /api/me': ME,
      'GET /api/campaigns/c1': () => campaign,
      'POST /api/qr/preview': PREVIEW,
      'PATCH /api/links/l2': ({ body }) => {
        campaign = { ...campaign, links: campaign.links.map((l) => (l.id === 'l2' ? { ...l, ...(body as object) } : l)) };
        return campaign.links[1];
      },
    });
    renderRoutes(routes, '/campaigns/c1');
    expect(await screen.findByRole('heading', { name: 'Expo stand' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Brochure' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Brochure active' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ active: false }));
    expect(await screen.findByText('Paused', { selector: 'span' })).toBeInTheDocument();
  });

  it('adds a source with a custom code and UTM tags', async () => {
    const { calls } = mockApi({
      'GET /api/me': ME,
      'GET /api/config': { publicBaseUrl: 'https://go.example.com', authMode: 'dev', rawIpRetentionDays: 90 },
      'GET /api/campaigns/c1': makeCampaign(),
      'POST /api/qr/preview': PREVIEW,
      'GET /api/codes/stand-b': { code: 'stand-b', available: true, reason: null },
      'POST /api/campaigns/c1/links': makeLink({ id: 'l3' }),
    });
    renderRoutes(routes, '/campaigns/c1');
    await userEvent.click(await screen.findByRole('button', { name: 'Add source' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Source name'), 'Stand B');
    await userEvent.type(within(dialog).getByLabelText('Short code'), 'Stand-B');
    expect(await within(dialog).findByText(/go\.example\.com\/stand-b is available/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('utm_medium'), 'qr');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add source' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/api/campaigns/c1/links')).toBeDefined());
    expect(calls.find((c) => c.path === '/api/campaigns/c1/links')!.body).toEqual({
      sourceLabel: 'Stand B',
      code: 'stand-b',
      destinationUrl: null,
      notes: '',
      utm: { medium: 'qr' },
    });
  });

  it('warns when a custom code is already taken', async () => {
    mockApi({
      'GET /api/me': ME,
      'GET /api/config': { publicBaseUrl: 'https://go.example.com', authMode: 'dev', rawIpRetentionDays: 90 },
      'GET /api/campaigns/c1': makeCampaign(),
      'POST /api/qr/preview': PREVIEW,
      'GET /api/codes/taken': { code: 'taken', available: false, reason: 'taken' },
    });
    renderRoutes(routes, '/campaigns/c1');
    await userEvent.click(await screen.findByRole('button', { name: 'Add source' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Short code'), 'taken');
    expect(await within(dialog).findByText('That code is already in use')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add source' })).toBeDisabled();
  });

  it('reports analytics broken down by source', async () => {
    mockApi({
      'GET /api/me': ME,
      'GET /api/campaigns/c1': makeCampaign(),
      'GET /api/campaigns/c1/stats': STATS,
      'GET /api/campaigns/c1/hits': { items: [], nextBefore: null },
    });
    renderRoutes(routes, '/campaigns/c1?tab=analytics');
    const table = (await screen.findByText('By source')).closest('.rounded-xl')!;
    const rows = within(table as HTMLElement).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Expo stand');
    expect(rows[1]).toHaveTextContent('12');
    expect(rows[1]).toHaveTextContent('80%');
    expect(rows[2]).toHaveTextContent('Brochure');
    expect(screen.getByText('93%')).toBeInTheDocument(); // mobile share
    expect(screen.getByRole('link', { name: /export csv/i })).toHaveAttribute('href', expect.stringContaining('/api/campaigns/c1/hits.csv'));
  });
});

describe('QR designer page', () => {
  it('saves a design and blocks downloads while unsaved', async () => {
    const link = { ...makeLink(), campaignName: 'Spring launch' };
    const { calls } = mockApi({
      'GET /api/me': ME,
      'GET /api/links/l1': link,
      'GET /api/templates': [],
      'POST /api/qr/preview': PREVIEW,
      'PATCH /api/links/l1': ({ body }) => ({ ...link, ...(body as object) }),
    });
    renderRoutes(routes, '/links/l1/design');
    expect(await screen.findByRole('heading', { name: 'QR code · Expo stand' })).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save design' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('link', { name: /download png/i })).toHaveAttribute('href', expect.stringContaining('/api/links/l1/qr?format=png'));

    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Module shape' })).getByRole('radio', { name: 'Dots' }));
    expect(save).toBeEnabled();
    expect(screen.getByText('Save your changes to download them.')).toBeInTheDocument();
    await userEvent.click(save);
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeDefined());
    expect((calls.find((c) => c.method === 'PATCH')!.body as { qrStyle: typeof DEFAULT_STYLE }).qrStyle.modules.shape).toBe('dots');
    await waitFor(() => expect(save).toBeDisabled());
  });

  it('switches export units and flags oversized PNGs', async () => {
    mockApi({
      'GET /api/me': ME,
      'GET /api/links/l1': { ...makeLink(), campaignName: 'Spring launch' },
      'GET /api/templates': [],
      'POST /api/qr/preview': PREVIEW,
    });
    renderRoutes(routes, '/links/l1/design');
    await userEvent.click(await screen.findByRole('radio', { name: 'mm' }));
    expect(screen.getByRole('link', { name: /download png/i })).toHaveAttribute('href', expect.stringContaining('unit=mm'));
    const width = screen.getByLabelText('Width (mm)');
    await userEvent.clear(width);
    await userEvent.type(width, '2000');
    expect(screen.getByText(/limited to 8000 px wide and 36 megapixels/)).toBeInTheDocument();
  });
});

describe('sign out', () => {
  it('posts to /auth/logout with the CSRF header', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { calls } = mockApi({
      'GET /api/me': ME,
      'GET /api/campaigns': [],
      'POST /auth/logout': () => new Response(null, { status: 204 }),
    });
    renderRoutes(routes, '/campaigns');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Sign out' }))[0]!);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/app/login'));
    const call = calls.find((c) => c.path === '/auth/logout')!;
    expect(call.method).toBe('POST');
    expect(call.headers['x-qrd-request']).toBe('1');
  });
});
