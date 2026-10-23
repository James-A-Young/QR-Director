import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { EyeInnerShape, EyeOuterShape, Fill, FrameStyle, LogoPlate, ModuleShape, QrStyle, Template } from '../../lib/types';
import { Button, Input, Segmented, Select, Switch, useToast } from '../ui';
import { ColorField, OptionGrid, RangeField, Section } from './controls';
import { eyeInnerIcon, eyeOuterIcon, frameIcon, moduleIcon, plateIcon } from './icons';
import { PRESETS } from './presets';

const MODULES: Array<{ value: ModuleShape; label: string }> = [
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'dots', label: 'Dots' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'classy', label: 'Classy' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'horizontal', label: 'Horizontal' },
];
const OUTER: Array<{ value: EyeOuterShape; label: string }> = [
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'extra-rounded', label: 'Soft' },
  { value: 'circle', label: 'Circle' },
  { value: 'leaf', label: 'Leaf' },
];
const INNER: Array<{ value: EyeInnerShape; label: string }> = [
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'circle', label: 'Circle' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'leaf', label: 'Leaf' },
  { value: 'star', label: 'Star' },
];
const PLATES: Array<{ value: LogoPlate; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'circle', label: 'Circle' },
  { value: 'diamond', label: 'Diamond' },
];
const FRAMES: Array<{ value: FrameStyle; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'card-pill', label: 'Card' },
  { value: 'banner-bottom', label: 'Banner' },
  { value: 'banner-top', label: 'Top' },
  { value: 'outline-label', label: 'Outline' },
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export function QrDesigner({
  value,
  onChange,
  templates,
}: {
  value: QrStyle;
  onChange: (style: QrStyle) => void;
  templates?: Template[];
}) {
  const s = value;
  const set = <K extends keyof QrStyle>(key: K, patch: Partial<QrStyle[K]>) =>
    onChange({ ...s, [key]: { ...(s[key] as object), ...patch } as QrStyle[K] });
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const fill = s.foreground;
  const setFill = (f: Fill) => onChange({ ...s, foreground: f });
  const fillFrom = fill.type === 'solid' ? fill.color : fill.from;
  const fillTo = fill.type === 'solid' ? fill.color : fill.to;

  async function upload(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      toast('Logos must be 2 MB or smaller', 'error');
      return;
    }
    setUploading(true);
    try {
      const asset = await api.uploadAsset(file.name, await readFileAsDataUrl(file));
      set('logo', { assetId: asset.id });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div>
      <Section title="Start from">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button key={p.name} size="sm" onClick={() => onChange(p.style(s))}>
              {p.name}
            </Button>
          ))}
        </div>
        {templates && templates.length > 0 && (
          <Select
            aria-label="Apply a saved template"
            value=""
            onChange={(e) => {
              const t = templates.find((x) => x.id === e.target.value);
              if (t) onChange(t.style);
            }}
          >
            <option value="">Apply a saved template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        )}
      </Section>

      <Section title="Colours">
        <Segmented
          label="Foreground fill"
          value={fill.type}
          onChange={(type) =>
            setFill(
              type === 'solid'
                ? { type, color: fillFrom }
                : type === 'linear'
                  ? { type, from: fillFrom, to: fillTo === fillFrom ? '#4f46e5' : fillTo, angle: 45 }
                  : { type, from: fillFrom, to: fillTo === fillFrom ? '#4f46e5' : fillTo },
            )
          }
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'linear', label: 'Linear' },
            { value: 'radial', label: 'Radial' },
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          {fill.type === 'solid' ? (
            <ColorField label="Foreground" value={fill.color} onChange={(c) => setFill({ type: 'solid', color: c! })} />
          ) : (
            <>
              <ColorField label="Gradient start" value={fill.from} onChange={(c) => setFill({ ...fill, from: c! })} />
              <ColorField label="Gradient end" value={fill.to} onChange={(c) => setFill({ ...fill, to: c! })} />
            </>
          )}
          <ColorField label="Background" value={s.background.color} onChange={(c) => set('background', { color: c! })} />
        </div>
        {fill.type === 'linear' && (
          <RangeField label="Gradient angle" min={0} max={360} step={15} value={fill.angle} onChange={(angle) => setFill({ ...fill, angle })} format={(v) => `${v}°`} />
        )}
        <label className="flex items-center justify-between text-sm">
          <span className="text-fg">Transparent background</span>
          <Switch label="Transparent background" checked={s.background.transparent} onChange={(transparent) => set('background', { transparent })} />
        </label>
      </Section>

      <Section title="Pattern">
        <OptionGrid label="Module shape" value={s.modules.shape} onChange={(shape) => set('modules', { shape })} options={MODULES.map((m) => ({ ...m, icon: moduleIcon(m.value) }))} />
        <RangeField label="Quiet zone" min={0} max={8} step={1} value={s.margin} onChange={(margin) => onChange({ ...s, margin })} format={(v) => `${v} modules`} />
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted">Error correction</div>
          <Segmented
            label="Error correction"
            value={s.logo.assetId ? 'H' : s.errorCorrection}
            onChange={(errorCorrection) => onChange({ ...s, errorCorrection })}
            options={[
              { value: 'L', label: 'Low', title: '~7% recovery, smallest code' },
              { value: 'M', label: 'Medium', title: '~15% recovery' },
              { value: 'Q', label: 'High', title: '~25% recovery' },
              { value: 'H', label: 'Max', title: '~30% recovery' },
            ]}
          />
          {s.logo.assetId && <p className="text-xs text-muted">Logos always use maximum error correction.</p>}
        </div>
      </Section>

      <Section title="Corner markers">
        <OptionGrid label="Frame shape" value={s.eyes.outerShape} onChange={(outerShape) => set('eyes', { outerShape })} options={OUTER.map((o) => ({ ...o, icon: eyeOuterIcon(o.value) }))} />
        <OptionGrid label="Centre shape" value={s.eyes.innerShape} onChange={(innerShape) => set('eyes', { innerShape })} options={INNER.map((o) => ({ ...o, icon: eyeInnerIcon(o.value) }))} />
        <div className="grid grid-cols-2 gap-3">
          <ColorField label="Frame colour" value={s.eyes.outerColor} onChange={(outerColor) => set('eyes', { outerColor })} inheritLabel="Auto" />
          <ColorField label="Centre colour" value={s.eyes.innerColor} onChange={(innerColor) => set('eyes', { innerColor })} inheritLabel="Auto" />
        </div>
      </Section>

      <Section title="Logo" defaultOpen={Boolean(s.logo.assetId)}>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          aria-label="Logo file"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        {s.logo.assetId ? (
          <div className="flex items-center gap-3 rounded-lg border border-border p-2">
            <img src={`/api/assets/${s.logo.assetId}`} alt="Logo" className="checker size-12 rounded-md object-contain p-1" />
            <div className="flex-1 text-sm text-muted">Logo added</div>
            <Button size="sm" onClick={() => fileRef.current?.click()} loading={uploading}>
              Replace
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => set('logo', { assetId: null })} aria-label="Remove logo" />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border-strong px-4 py-6 text-sm text-muted hover:border-accent hover:text-accent"
            disabled={uploading}
          >
            <ImagePlus className="size-5" />
            {uploading ? 'Uploading…' : 'Upload PNG, JPEG, WebP or SVG'}
          </button>
        )}
        {s.logo.assetId && (
          <>
            <OptionGrid label="Backing" value={s.logo.plate} onChange={(plate) => set('logo', { plate })} options={PLATES.map((p) => ({ ...p, icon: plateIcon(p.value) }))} />
            <RangeField label="Size" min={0.1} max={0.3} step={0.01} value={s.logo.size} onChange={(size) => set('logo', { size })} format={(v) => `${Math.round(v * 100)}%`} />
            <RangeField label="Padding" min={0} max={0.4} step={0.02} value={s.logo.padding} onChange={(padding) => set('logo', { padding })} format={(v) => `${Math.round(v * 100)}%`} />
            {s.logo.plate !== 'none' && (
              <div className="grid grid-cols-2 gap-3">
                <ColorField label="Backing colour" value={s.logo.plateColor} onChange={(plateColor) => set('logo', { plateColor: plateColor! })} />
                <ColorField label="Border" value={s.logo.borderColor} onChange={(borderColor) => set('logo', { borderColor })} inheritLabel="None" />
              </div>
            )}
            <label className="flex items-center justify-between text-sm">
              <span className="text-fg">Clear modules behind logo</span>
              <Switch label="Clear modules behind logo" checked={s.logo.excavate} onChange={(excavate) => set('logo', { excavate })} />
            </label>
          </>
        )}
      </Section>

      <Section title="Call-to-action frame">
        <OptionGrid label="Frame" value={s.frame.style} onChange={(style) => set('frame', { style })} options={FRAMES.map((f) => ({ ...f, icon: frameIcon(f.value) }))} />
        {s.frame.style !== 'none' && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="frame-text" className="text-xs font-medium text-muted">
                Text
              </label>
              <Input id="frame-text" value={s.frame.text} maxLength={40} onChange={(e) => set('frame', { text: e.target.value })} placeholder="SCAN ME" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ColorField label="Frame colour" value={s.frame.color} onChange={(color) => set('frame', { color: color! })} />
              <ColorField label="Text colour" value={s.frame.textColor} onChange={(textColor) => set('frame', { textColor: textColor! })} />
              <ColorField label="Panel colour" value={s.frame.innerColor} onChange={(innerColor) => set('frame', { innerColor: innerColor! })} />
            </div>
            <RangeField label="Corner rounding" min={0} max={1} step={0.05} value={s.frame.rounding} onChange={(rounding) => set('frame', { rounding })} format={(v) => `${Math.round(v * 100)}%`} />
            {s.frame.style !== 'outline-label' && (
              <label className="flex items-center justify-between text-sm">
                <span className="text-fg">Show scan icon</span>
                <Switch label="Show scan icon" checked={s.frame.showIcon} onChange={(showIcon) => set('frame', { showIcon })} />
              </label>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
