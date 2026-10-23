const numberFmt = new Intl.NumberFormat();
export const formatNumber = (n: number) => numberFmt.format(n);

export function formatDate(value: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(value));
}

export const formatDateTime = (value: string | Date | null | undefined) =>
  formatDate(value, { dateStyle: 'medium', timeStyle: 'short' });

export function formatRelative(value: string | Date | null | undefined, now = Date.now()): string {
  if (!value) return 'Never';
  const diff = (new Date(value).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 30 * 86_400) return rtf.format(Math.round(diff / 86_400), 'day');
  return formatDate(value);
}

const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(undefined, { type: 'region' }) : null;

export function countryName(code: string): string {
  if (!code || code === 'Unknown') return 'Unknown';
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function countryFlag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '🌐';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

/** Bucket key from the API ("2026-05-01T13:00") as a short axis label. */
export function bucketLabel(t: string, bucket: 'hour' | 'day'): string {
  const [date, time] = t.split('T');
  const [y, m, d] = (date ?? '').split('-').map(Number);
  const local = new Date(y!, (m ?? 1) - 1, d ?? 1, Number((time ?? '00').slice(0, 2)));
  return bucket === 'hour'
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', day: 'numeric', month: 'short' }).format(local)
    : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(local);
}

export function pluralise(n: number, singular: string, plural = `${singular}s`) {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
