import { clsx } from 'clsx';
import { useId, useState, type ReactNode } from 'react';

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ColorField({
  label,
  value,
  onChange,
  inheritLabel,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  /** When set, the colour can be cleared to inherit (e.g. "Same as foreground"). */
  inheritLabel?: string;
}) {
  const id = useId();
  // Local text only while typing an incomplete hex value; otherwise show the real value.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value ?? '';
  const inherited = value === null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {label}
        </label>
        {inheritLabel && (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={inherited}
              onChange={(e) => onChange(e.target.checked ? null : '#111827')}
            />
            {inheritLabel}
          </label>
        )}
      </div>
      <div className={clsx('flex items-center gap-2 rounded-lg border border-border-strong bg-surface p-1 pr-2', inherited && 'opacity-50')}>
        <input
          type="color"
          aria-label={`${label} picker`}
          disabled={inherited}
          value={value ?? '#111827'}
          onChange={(e) => onChange(e.target.value)}
          className="size-8 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
        />
        <input
          id={id}
          disabled={inherited}
          value={inherited ? '' : text}
          placeholder={inherited ? 'Inherited' : '#000000'}
          onChange={(e) => {
            const v = e.target.value.trim();
            setDraft(v);
            if (HEX.test(v)) onChange(v.toLowerCase());
          }}
          onBlur={() => setDraft(null)}
          className="w-full min-w-0 bg-transparent font-mono text-sm uppercase text-fg outline-none"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => String(v),
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={id} className="font-medium text-muted">
          {label}
        </label>
        <span className="tabular-nums text-fg">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </div>
  );
}

export function OptionGrid<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; icon: ReactNode }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            aria-label={o.label}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={clsx(
              'flex h-16 flex-col items-center justify-center gap-1 rounded-lg border p-1.5 text-fg transition',
              value === o.value ? 'border-accent bg-accent-soft ring-2 ring-[var(--ring)]' : 'border-border hover:border-border-strong hover:bg-surface-2',
            )}
          >
            <span className="flex size-7 items-center justify-center">{o.icon}</span>
            <span className="truncate text-[10px] leading-none text-muted">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group border-b border-border last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-semibold text-fg select-none [&::-webkit-details-marker]:hidden">
        {title}
        <svg viewBox="0 0 20 20" className="size-4 text-muted transition-transform group-open:rotate-180" aria-hidden>
          <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="space-y-4 px-5 pb-5">{children}</div>
    </details>
  );
}
