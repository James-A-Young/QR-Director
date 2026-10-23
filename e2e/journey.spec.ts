import { expect, test, type Page } from '@playwright/test';

const unique = () => Math.random().toString(36).slice(2, 8);

async function signIn(page: Page, name = 'Robin Tester') {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/login/);
  await page.getByRole('link', { name: /sign in with microsoft/i }).click();
  // AUTH_MODE=dev shows a simple form in place of Microsoft.
  await page.getByLabel('Email').fill('robin@example.com');
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /welcome back, robin/i })).toBeVisible();
}

test('create a campaign, design a QR code, track scans and redirect it', async ({ page, request }) => {
  const id = unique();
  await signIn(page);

  // Create a campaign with two sources.
  await page.getByRole('button', { name: 'New campaign' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Campaign name').fill(`Autumn fair ${id}`);
  await dialog.getByLabel('Destination URL').fill('https://example.com/autumn');
  await dialog.getByLabel('Source 1', { exact: true }).fill('Main stand');
  await dialog.getByRole('button', { name: 'Add source' }).click();
  await dialog.getByLabel('Source 2', { exact: true }).fill('Leaflet');
  await page.getByRole('button', { name: 'Create campaign' }).click();

  await expect(page.getByRole('heading', { name: `Autumn fair ${id}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Main stand' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Leaflet' })).toBeVisible();

  // Give the leaflet a memorable custom code.
  await page.getByRole('button', { name: 'Edit Leaflet' }).click();
  await page.getByRole('dialog').getByLabel('Short code').fill(`leaflet-${id}`);
  await expect(page.getByRole('dialog').getByText(/is available/)).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('link', { name: new RegExp(`leaflet-${id}`) })).toBeVisible();

  // Design its QR code.
  await page.getByRole('link', { name: 'Design Leaflet QR code' }).click();
  await expect(page.getByRole('heading', { name: 'QR code · Leaflet' })).toBeVisible();
  await page.getByRole('button', { name: 'Fresh' }).click();
  await page.getByRole('radiogroup', { name: 'Frame' }).getByRole('radio', { name: 'Card' }).click();
  await page.getByLabel('Text', { exact: true }).fill('SCAN FOR MORE INFO');
  await expect(page.getByAltText('QR code preview')).toBeVisible();
  await page.getByRole('button', { name: 'Save design' }).click();
  await expect(page.getByText('Design saved')).toBeVisible();

  // Download the print file.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: /download png/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`qr-leaflet-${id}.png`);

  // A visitor scans the code (upper case, as the QR encodes it).
  const scan = await request.get(`/LEAFLET-${id.toUpperCase()}`, {
    maxRedirects: 0,
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' },
  });
  expect(scan.status()).toBe(302);
  expect(scan.headers().location).toBe('https://example.com/autumn');

  // Analytics attribute the scan to the leaflet.
  await page.getByRole('link', { name: `Autumn fair ${id}` }).click();
  await page.getByRole('tab', { name: 'Analytics' }).click();
  const leafletRow = page.getByRole('row').filter({ hasText: 'Leaflet' });
  await expect(leafletRow).toContainText('100%');
  await expect(page.getByRole('cell', { name: 'Mobile' })).toBeVisible();

  // Redirect every printed code to a new page.
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Destination URL').fill('https://example.com/winter');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Campaign saved')).toBeVisible();
  const again = await request.get(`/leaflet-${id}`, { maxRedirects: 0 });
  expect(again.headers().location).toBe('https://example.com/winter');

  // The change is in the audit history.
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('Campaign redirected to https://example.com/winter')).toBeVisible();
});

test('save and reuse a template', async ({ page }) => {
  const id = unique();
  await signIn(page);
  await page.getByRole('link', { name: 'Templates' }).click();
  await page.getByRole('link', { name: 'New template' }).first().click();
  await page.getByLabel('Template name').fill(`Brand ${id}`);
  await page.getByRole('radiogroup', { name: 'Module shape' }).getByRole('radio', { name: 'Dots' }).click();
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('Template saved')).toBeVisible();
  await page.getByRole('link', { name: 'Templates' }).first().click();
  await expect(page.getByRole('link', { name: `Brand ${id}` })).toBeVisible();
});

test('unknown short links show a friendly page', async ({ page }) => {
  const res = await page.goto('/does-not-exist-xyz');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Link not found' })).toBeVisible();
});
