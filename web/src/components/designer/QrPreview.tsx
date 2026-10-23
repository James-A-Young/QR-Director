import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { QrStyle } from '../../lib/types';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Server-rendered preview, so what you see is exactly what downloads produce. */
export function useQrPreview(style: QrStyle, opts: { linkId?: string; code?: string } = {}) {
  const debounced = useDebounced(style, 150);
  return useQuery({
    queryKey: ['qr-preview', debounced, opts.linkId, opts.code],
    queryFn: () => api.preview(debounced, opts),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}

export const svgDataUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function QrPreview({
  style,
  linkId,
  code,
  className,
  showWarnings = true,
}: {
  style: QrStyle;
  linkId?: string;
  code?: string;
  className?: string;
  showWarnings?: boolean;
}) {
  const preview = useQrPreview(style, { linkId, code });
  const data = preview.data;
  return (
    <div className={className}>
      <div className={`checker relative flex items-center justify-center rounded-xl border border-border p-6 ${preview.isFetching ? 'opacity-90' : ''}`}>
        {data ? (
          <img
            src={svgDataUri(data.svg)}
            alt="QR code preview"
            className="h-auto max-h-[440px] w-full max-w-[360px] object-contain drop-shadow-sm"
          />
        ) : preview.error ? (
          <div className="py-20 text-sm text-danger">{preview.error.message}</div>
        ) : (
          <div className="aspect-square w-full max-w-[360px] animate-pulse rounded-lg bg-surface-2" />
        )}
      </div>
      {data && (
        <div className="mt-2 text-center text-xs text-muted">
          Version {data.version} · {data.modules}×{data.modules} modules
        </div>
      )}
      {showWarnings && data && data.warnings.length > 0 && (
        <ul className="mt-3 space-y-2">
          {data.warnings.map((w) => (
            <li key={w.message} className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Static thumbnail for lists; uses the same preview endpoint. */
export function QrThumb({ style, linkId, className = 'size-14' }: { style: QrStyle; linkId?: string; className?: string }) {
  const preview = useQrPreview(style, { linkId });
  return preview.data ? (
    <img src={svgDataUri(preview.data.svg)} alt="" className={`${className} object-contain`} />
  ) : (
    <div className={`${className} animate-pulse rounded bg-surface-2`} />
  );
}
