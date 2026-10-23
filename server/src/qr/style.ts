import { z } from 'zod';

export const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Colour must be #RRGGBB or #RRGGBBAA')
  .transform((c) => c.toLowerCase());

export const MODULE_SHAPES = ['square', 'rounded', 'dots', 'diamond', 'vertical', 'horizontal', 'classy'] as const;
export const EYE_OUTER_SHAPES = ['square', 'rounded', 'extra-rounded', 'circle', 'leaf'] as const;
export const EYE_INNER_SHAPES = ['square', 'rounded', 'circle', 'diamond', 'leaf', 'star'] as const;
export const LOGO_PLATES = ['none', 'square', 'rounded', 'circle', 'diamond'] as const;
export const FRAME_STYLES = ['none', 'card-pill', 'banner-bottom', 'banner-top', 'outline-label'] as const;
export const ERROR_CORRECTION = ['L', 'M', 'Q', 'H'] as const;

const fillSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('solid'), color: hexColor }),
  z.object({
    type: z.literal('linear'),
    from: hexColor,
    to: hexColor,
    /** Degrees, 0 = left to right, 90 = top to bottom. */
    angle: z.number().min(0).max(360).default(45),
  }),
  z.object({ type: z.literal('radial'), from: hexColor, to: hexColor }),
]);
export type Fill = z.infer<typeof fillSchema>;

export const qrStyleSchema = z.object({
  errorCorrection: z.enum(ERROR_CORRECTION).default('Q'),
  /** Quiet zone around the code, in modules. The QR spec recommends 4; 2 scans reliably on most phones. */
  margin: z.number().int().min(0).max(10).default(3),
  foreground: fillSchema.default({ type: 'solid', color: '#111827' }),
  background: z
    .object({
      color: hexColor.default('#ffffff'),
      transparent: z.boolean().default(false),
    })
    .default({}),
  modules: z
    .object({
      shape: z.enum(MODULE_SHAPES).default('square'),
    })
    .default({}),
  eyes: z
    .object({
      outerShape: z.enum(EYE_OUTER_SHAPES).default('square'),
      innerShape: z.enum(EYE_INNER_SHAPES).default('square'),
      /** null inherits the foreground fill. */
      outerColor: hexColor.nullable().default(null),
      innerColor: hexColor.nullable().default(null),
    })
    .default({}),
  logo: z
    .object({
      assetId: z.string().uuid().nullable().default(null),
      /** Width of the area cleared for the logo, as a fraction of the symbol width (excluding quiet zone). */
      size: z.number().min(0.1).max(0.3).default(0.24),
      /** Gap between the logo and the edge of the cleared area, as a fraction of the logo size. */
      padding: z.number().min(0).max(0.5).default(0.12),
      plate: z.enum(LOGO_PLATES).default('rounded'),
      plateColor: hexColor.default('#ffffff'),
      /** Optional ring drawn around the plate. */
      borderColor: hexColor.nullable().default(null),
      /** Remove modules behind the logo rather than drawing over them. */
      excavate: z.boolean().default(true),
    })
    .default({}),
  frame: z
    .object({
      style: z.enum(FRAME_STYLES).default('none'),
      color: hexColor.default('#111827'),
      /** Colour of the panel inside the frame (behind the QR). */
      innerColor: hexColor.default('#ffffff'),
      text: z.string().max(40).default('SCAN ME'),
      textColor: hexColor.default('#ffffff'),
      showIcon: z.boolean().default(true),
      /** Corner rounding, 0 (square) to 1 (fully rounded). */
      rounding: z.number().min(0).max(1).default(0.5),
    })
    .default({}),
});

export type QrStyle = z.infer<typeof qrStyleSchema>;
export type QrStyleInput = z.input<typeof qrStyleSchema>;

export const defaultStyle: QrStyle = qrStyleSchema.parse({});

/** Parse arbitrary JSON (e.g. stored in the DB or sent by the UI) into a complete style, filling defaults. */
export function parseStyle(input: unknown): QrStyle {
  return qrStyleSchema.parse(input ?? {});
}

/** Error correction actually used: a logo needs the highest level to survive the modules it hides. */
export function effectiveErrorCorrection(style: QrStyle): (typeof ERROR_CORRECTION)[number] {
  return style.logo.assetId ? 'H' : style.errorCorrection;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

export interface StyleWarning {
  code: string;
  message: string;
}

/** Scannability heuristics surfaced to the designer UI. */
export function styleWarnings(style: QrStyle): StyleWarning[] {
  const warnings: StyleWarning[] = [];
  const bg = style.background.transparent ? '#ffffff' : style.background.color;
  const fgColors =
    style.foreground.type === 'solid' ? [style.foreground.color] : [style.foreground.from, style.foreground.to];
  for (const c of [...fgColors, style.eyes.outerColor, style.eyes.innerColor]) {
    if (!c) continue;
    const ratio = contrastRatio(c, bg);
    if (ratio < 3) {
      warnings.push({
        code: 'low-contrast',
        message: `Colour ${c} has low contrast (${ratio.toFixed(1)}:1) against the background; aim for at least 4:1.`,
      });
    }
    if (luminance(c.slice(0, 7)) > luminance(bg.slice(0, 7))) {
      warnings.push({
        code: 'inverted',
        message: 'The foreground is lighter than the background. Some older scanners cannot read inverted codes.',
      });
    }
  }
  if (style.margin < 2) {
    warnings.push({ code: 'small-margin', message: 'A quiet zone under 2 modules may stop some phones scanning the code.' });
  }
  if (style.logo.assetId && style.logo.size > 0.27) {
    warnings.push({ code: 'large-logo', message: 'Large logos hide a lot of data. Test-scan before printing.' });
  }
  if (style.background.transparent) {
    warnings.push({
      code: 'transparent',
      message: 'Transparent backgrounds only scan when printed on a light, plain surface.',
    });
  }
  // De-duplicate identical messages (e.g. two gradient stops with the same problem).
  return warnings.filter((w, i) => warnings.findIndex((o) => o.message === w.message) === i);
}
