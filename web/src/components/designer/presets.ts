import type { QrStyle } from '../../lib/types';

export const DEFAULT_STYLE: QrStyle = {
  errorCorrection: 'Q',
  margin: 3,
  foreground: { type: 'solid', color: '#111827' },
  background: { color: '#ffffff', transparent: false },
  modules: { shape: 'square' },
  eyes: { outerShape: 'square', innerShape: 'square', outerColor: null, innerColor: null },
  logo: { assetId: null, size: 0.24, padding: 0.12, plate: 'rounded', plateColor: '#ffffff', borderColor: null, excavate: true },
  frame: { style: 'none', color: '#111827', innerColor: '#ffffff', text: 'SCAN ME', textColor: '#ffffff', showIcon: true, rounding: 0.5 },
};

type Preset = { name: string; style: (s: QrStyle) => QrStyle };

/** Starting points; they keep the current logo and frame text. */
export const PRESETS: Preset[] = [
  {
    name: 'Classic',
    style: (s) => ({ ...DEFAULT_STYLE, logo: s.logo, frame: { ...DEFAULT_STYLE.frame, text: s.frame.text } }),
  },
  {
    name: 'Fresh',
    style: (s) => ({
      ...s,
      foreground: { type: 'solid', color: '#4179a7' },
      background: { color: '#ffffff', transparent: false },
      modules: { shape: 'rounded' },
      eyes: { outerShape: 'extra-rounded', innerShape: 'diamond', outerColor: null, innerColor: '#72b856' },
      frame: { ...s.frame, style: 'card-pill', color: '#72b856', innerColor: '#ffffff', textColor: '#ffffff', rounding: 0.7 },
    }),
  },
  {
    name: 'Midnight',
    style: (s) => ({
      ...s,
      foreground: { type: 'linear', from: '#1e1b4b', to: '#4f46e5', angle: 45 },
      background: { color: '#ffffff', transparent: false },
      modules: { shape: 'dots' },
      eyes: { outerShape: 'circle', innerShape: 'circle', outerColor: '#1e1b4b', innerColor: '#4f46e5' },
      frame: { ...s.frame, style: 'banner-bottom', color: '#1e1b4b', innerColor: '#ffffff', textColor: '#ffffff', rounding: 0.5 },
    }),
  },
  {
    name: 'Sunset',
    style: (s) => ({
      ...s,
      foreground: { type: 'linear', from: '#be123c', to: '#c2410c', angle: 135 },
      background: { color: '#fff7ed', transparent: false },
      modules: { shape: 'classy' },
      eyes: { outerShape: 'leaf', innerShape: 'leaf', outerColor: null, innerColor: null },
      frame: { ...s.frame, style: 'outline-label', color: '#be123c', innerColor: '#fff7ed', textColor: '#9f1239', rounding: 0.6 },
    }),
  },
  {
    name: 'Minimal',
    style: (s) => ({
      ...s,
      foreground: { type: 'solid', color: '#0f172a' },
      background: { color: '#ffffff', transparent: false },
      modules: { shape: 'vertical' },
      eyes: { outerShape: 'rounded', innerShape: 'rounded', outerColor: null, innerColor: null },
      frame: { ...s.frame, style: 'none' },
    }),
  },
];
