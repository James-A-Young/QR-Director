/** Geometry helpers producing SVG path data. All numbers are in module units. */

export type Corners = [tl: number, tr: number, br: number, bl: number];

const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

export function rectPath(x: number, y: number, w: number, h: number, corners: Corners = [0, 0, 0, 0]): string {
  const max = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = corners.map((c) => Math.max(0, Math.min(c, max))) as Corners;
  let d = `M${n(x + tl)} ${n(y)}H${n(x + w - tr)}`;
  if (tr) d += `A${n(tr)} ${n(tr)} 0 0 1 ${n(x + w)} ${n(y + tr)}`;
  d += `V${n(y + h - br)}`;
  if (br) d += `A${n(br)} ${n(br)} 0 0 1 ${n(x + w - br)} ${n(y + h)}`;
  d += `H${n(x + bl)}`;
  if (bl) d += `A${n(bl)} ${n(bl)} 0 0 1 ${n(x)} ${n(y + h - bl)}`;
  d += `V${n(y + tl)}`;
  if (tl) d += `A${n(tl)} ${n(tl)} 0 0 1 ${n(x + tl)} ${n(y)}`;
  return `${d}Z`;
}

export function circlePath(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)}Z`;
}

export function diamondPath(cx: number, cy: number, half: number): string {
  return `M${n(cx)} ${n(cy - half)}L${n(cx + half)} ${n(cy)}L${n(cx)} ${n(cy + half)}L${n(cx - half)} ${n(cy)}Z`;
}

export function starPath(cx: number, cy: number, outer: number, inner: number, points = 5): string {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    d += `${i === 0 ? 'M' : 'L'}${n(cx + r * Math.cos(a))} ${n(cy + r * Math.sin(a))}`;
  }
  return `${d}Z`;
}

/** Rotate a TL/TR/BR/BL corner array so asymmetric shapes (leaf) point consistently for each eye. */
export function orientCorners(corners: Corners, position: 'top-left' | 'top-right' | 'bottom-left'): Corners {
  const [tl, tr, br, bl] = corners;
  if (position === 'top-right') return [tr, tl, bl, br];
  if (position === 'bottom-left') return [bl, br, tr, tl];
  return corners;
}

export { n as fmt };
