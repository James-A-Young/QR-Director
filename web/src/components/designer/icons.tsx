import type { EyeInnerShape, EyeOuterShape, FrameStyle, LogoPlate, ModuleShape } from '../../lib/types';

// Small illustrative previews for the option pickers. Drawn on a 24x24 grid in currentColor.

const box = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-full" fill="currentColor" aria-hidden>
    {children}
  </svg>
);

// A 4x4 sample pattern so neighbour-aware shapes (rounded, vertical...) read correctly.
const SAMPLE = [
  [1, 1, 0, 1],
  [0, 1, 0, 1],
  [1, 1, 1, 1],
  [1, 0, 0, 1],
];

function sampleModules(shape: ModuleShape) {
  const cell = 5;
  const o = 2;
  const dark = (r: number, c: number) => SAMPLE[r]?.[c] === 1;
  const items: React.ReactNode[] = [];
  SAMPLE.forEach((row, r) =>
    row.forEach((v, c) => {
      if (!v) return;
      const x = o + c * cell;
      const y = o + r * cell;
      const key = `${r}-${c}`;
      const up = dark(r - 1, c), down = dark(r + 1, c), left = dark(r, c - 1), right = dark(r, c + 1);
      switch (shape) {
        case 'square':
          items.push(<rect key={key} x={x} y={y} width={cell} height={cell} />);
          break;
        case 'dots':
          items.push(<circle key={key} cx={x + cell / 2} cy={y + cell / 2} r={cell * 0.42} />);
          break;
        case 'diamond':
          items.push(<path key={key} d={`M${x + 2.5} ${y}L${x + 5} ${y + 2.5}L${x + 2.5} ${y + 5}L${x} ${y + 2.5}Z`} />);
          break;
        case 'rounded': {
          const rr = (a: boolean, b: boolean) => (!a && !b ? 2.5 : 0);
          items.push(<path key={key} d={roundRect(x, y, cell, cell, [rr(up, left), rr(up, right), rr(down, right), rr(down, left)])} />);
          break;
        }
        case 'classy':
          items.push(<path key={key} d={roundRect(x, y, cell, cell, [!up && !left ? 3 : 0, 0, !down && !right ? 3 : 0, 0])} />);
          break;
        case 'vertical':
          items.push(<path key={key} d={roundRect(x + 0.6, y, cell - 1.2, cell, [up ? 0 : 2, up ? 0 : 2, down ? 0 : 2, down ? 0 : 2])} />);
          break;
        case 'horizontal':
          items.push(<path key={key} d={roundRect(x, y + 0.6, cell, cell - 1.2, [left ? 0 : 2, right ? 0 : 2, right ? 0 : 2, left ? 0 : 2])} />);
          break;
      }
    }),
  );
  return items;
}

function roundRect(x: number, y: number, w: number, h: number, [tl, tr, br, bl]: number[]) {
  return `M${x + tl!} ${y}H${x + w - tr!}${tr ? `A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}` : ''}V${y + h - br!}${br ? `A${br} ${br} 0 0 1 ${x + w - br} ${y + h}` : ''}H${x + bl!}${bl ? `A${bl} ${bl} 0 0 1 ${x} ${y + h - bl}` : ''}V${y + tl!}${tl ? `A${tl} ${tl} 0 0 1 ${x + tl} ${y}` : ''}Z`;
}

export const moduleIcon = (shape: ModuleShape) => box(sampleModules(shape));

export function eyeOuterIcon(shape: EyeOuterShape) {
  const ring: Record<EyeOuterShape, string> = {
    square: roundRect(2, 2, 20, 20, [0, 0, 0, 0]) + roundRect(5, 5, 14, 14, [0, 0, 0, 0]),
    rounded: roundRect(2, 2, 20, 20, [6, 6, 6, 6]) + roundRect(5, 5, 14, 14, [3.5, 3.5, 3.5, 3.5]),
    'extra-rounded': roundRect(2, 2, 20, 20, [9, 9, 9, 9]) + roundRect(5, 5, 14, 14, [6, 6, 6, 6]),
    circle: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0ZM5 12a7 7 0 1 0 14 0a7 7 0 1 0 -14 0Z',
    leaf: roundRect(2, 2, 20, 20, [9, 0, 9, 0]) + roundRect(5, 5, 14, 14, [6, 0, 6, 0]),
  };
  return box(<path fillRule="evenodd" d={ring[shape]} />);
}

export function eyeInnerIcon(shape: EyeInnerShape) {
  const d: Record<EyeInnerShape, string> = {
    square: roundRect(6, 6, 12, 12, [0, 0, 0, 0]),
    rounded: roundRect(6, 6, 12, 12, [3.5, 3.5, 3.5, 3.5]),
    circle: 'M6 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0Z',
    diamond: 'M12 4.5L19.5 12L12 19.5L4.5 12Z',
    leaf: roundRect(6, 6, 12, 12, [6, 0, 6, 0]),
    star: 'M12 4.5l2.3 4.8 5.2.6-3.9 3.5 1.1 5.2L12 16l-4.7 2.6 1.1-5.2-3.9-3.5 5.2-.6Z',
  };
  return box(<path d={d[shape]} />);
}

export function plateIcon(plate: LogoPlate) {
  const d: Record<LogoPlate, string | null> = {
    none: null,
    square: roundRect(4, 4, 16, 16, [0, 0, 0, 0]),
    rounded: roundRect(4, 4, 16, 16, [4, 4, 4, 4]),
    circle: 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0Z',
    diamond: 'M12 2L22 12L12 22L2 12Z',
  };
  return box(
    <>
      {d[plate] ? <path d={d[plate]!} opacity={0.25} /> : <path d="M4 4h16v16H4z" fill="none" stroke="currentColor" strokeDasharray="2 2" opacity={0.5} />}
      <path d="M12 8l4 4-4 4-4-4Z" />
    </>,
  );
}

export function frameIcon(style: FrameStyle) {
  const qr = (x: number, y: number, s: number) => <rect x={x} y={y} width={s} height={s} rx={1} fill="currentColor" opacity={0.35} />;
  switch (style) {
    case 'none':
      return box(qr(5, 5, 14));
    case 'card-pill':
      return box(
        <>
          <rect x={4} y={1.5} width={16} height={16} rx={3} fill="none" stroke="currentColor" strokeWidth={1.6} />
          {qr(7, 4.5, 10)}
          <rect x={4} y={18.5} width={16} height={4} rx={2} />
        </>,
      );
    case 'banner-bottom':
      return box(
        <>
          <rect x={4} y={1.5} width={16} height={21} rx={2.5} />
          <rect x={5.5} y={3} width={13} height={13} rx={1} fill="var(--surface)" />
          {qr(7, 4.5, 10)}
        </>,
      );
    case 'banner-top':
      return box(
        <>
          <rect x={4} y={1.5} width={16} height={21} rx={2.5} />
          <rect x={5.5} y={8} width={13} height={13} rx={1} fill="var(--surface)" />
          {qr(7, 9.5, 10)}
        </>,
      );
    case 'outline-label':
      return box(
        <>
          <rect x={4} y={1.5} width={16} height={21} rx={2.5} fill="none" stroke="currentColor" strokeWidth={1.6} />
          {qr(7, 4.5, 10)}
          <rect x={8} y={17.5} width={8} height={2} rx={1} />
        </>,
      );
  }
}
