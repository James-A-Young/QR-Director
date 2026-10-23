import { Download } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api';
import { Input, Segmented, Select } from '../ui';

type Unit = 'px' | 'mm' | 'in';

const SIZE_PRESETS: Record<Unit, number[]> = {
  px: [512, 1024, 2048, 4096],
  mm: [20, 30, 50, 80, 100],
  in: [1, 2, 3, 4],
};

/** Download controls. Files are rendered server-side from the link's saved design. */
export function ExportPanel({ linkId, disabled, aspect }: { linkId: string; disabled?: boolean; aspect?: number }) {
  const [format, setFormat] = useState<'png' | 'svg'>('png');
  const [unit, setUnit] = useState<Unit>('px');
  const [width, setWidth] = useState(1024);
  const [dpi, setDpi] = useState(300);

  const pxWidth = unit === 'px' ? width : Math.round((unit === 'mm' ? width / 25.4 : width) * dpi);
  const tooBig = format === 'png' && pxWidth > 8000;
  const valid = width > 0 && !tooBig;
  const height = aspect ? width * aspect : width;
  const href = api.qrUrl(linkId, { format, width, unit, dpi, download: true });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Format" value={format} onChange={setFormat} options={[{ value: 'png', label: 'PNG' }, { value: 'svg', label: 'SVG (vector)' }]} />
        <Segmented
          label="Units"
          value={unit}
          onChange={(u) => {
            setUnit(u);
            setWidth(SIZE_PRESETS[u][u === 'px' ? 1 : 2]!);
          }}
          options={[{ value: 'px', label: 'px' }, { value: 'mm', label: 'mm' }, { value: 'in', label: 'in' }]}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="export-width" className="text-xs font-medium text-muted">
            Width ({unit})
          </label>
          <Input id="export-width" type="number" min={1} step={unit === 'px' ? 1 : 0.5} value={width} onChange={(e) => setWidth(Number(e.target.value))} invalid={!valid} />
        </div>
        {unit !== 'px' && format === 'png' ? (
          <div className="space-y-1.5">
            <label htmlFor="export-dpi" className="text-xs font-medium text-muted">
              Resolution
            </label>
            <Select id="export-dpi" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
              {[150, 300, 600, 1200].map((d) => (
                <option key={d} value={d}>
                  {d} dpi{d === 300 ? ' (print)' : ''}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted">Quick sizes</span>
            <div className="flex flex-wrap gap-1">
              {SIZE_PRESETS[unit].map((v) => (
                <button key={v} type="button" onClick={() => setWidth(v)} className={`rounded-md border px-2 py-1 text-xs ${v === width ? 'border-accent text-accent' : 'border-border text-muted hover:text-fg'}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="text-xs text-muted">
        {tooBig
          ? 'PNG exports are limited to 8000 px wide. Use SVG for very large prints.'
          : `Output ${format === 'png' ? `${pxWidth} px` : `${width} ${unit}`} wide${aspect && aspect !== 1 ? `, ${Math.round(height * 10) / 10} ${unit === 'px' && format === 'png' ? 'px' : unit} tall` : ''}.${format === 'svg' ? ' Vector files scale to any size without losing quality.' : ''}`}
      </p>
      <a
        href={valid && !disabled ? href : undefined}
        aria-disabled={!valid || disabled}
        className={`flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-accent-fg shadow-sm transition hover:bg-accent-hover ${!valid || disabled ? 'pointer-events-none opacity-50' : ''}`}
        download
      >
        <Download className="size-4" />
        Download {format.toUpperCase()}
      </a>
      {disabled && <p className="text-center text-xs text-muted">Save your changes to download them.</p>}
    </div>
  );
}
