const escapeHtml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Small self-contained HTML page for visitors (unknown links, sign-in errors). */
export function errorPage(title: string, message: string, actionHref?: string, actionLabel?: string): string {
  const action = actionHref
    ? `<a href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel ?? 'Continue')}</a>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="robots" content="noindex">
<style>
:root{color-scheme:light dark;--bg:#f8fafc;--card:#fff;--fg:#0f172a;--muted:#64748b;--accent:#4f46e5}
@media (prefers-color-scheme:dark){:root{--bg:#0b1120;--card:#111827;--fg:#e2e8f0;--muted:#94a3b8}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}
main{background:var(--card);border-radius:16px;padding:2.5rem 2rem;max-width:420px;text-align:center;box-shadow:0 10px 30px -12px #0003}
h1{font-size:1.35rem;margin:0 0 .5rem}p{color:var(--muted);line-height:1.5;margin:0 0 1.5rem}
a{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:.65rem 1.2rem;border-radius:10px;font-weight:600}
</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${action}</main></body></html>`;
}
