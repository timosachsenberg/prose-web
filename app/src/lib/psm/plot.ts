// Geometry of the PSM view's two charts (the mirror spectrum and the fragment mass errors), drawn
// as SVG by hand: scales, round ticks, sticks as one path per series (a spectrum can have thousands
// of peaks), the tolerance band, and the placement of peak labels without overlaps.

import type { Tolerance } from './psm'

/** A linear map from `domain` to `range`. */
export function scale([d0, d1]: [number, number], [r0, r1]: [number, number]): (v: number) => number {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0)
  return (v) => r0 + (v - d0) * k
}

/** A step of 1, 2 or 5 × 10^n near `span / count` (the d3 rule). */
export function tickStep(span: number, count: number): number {
  const raw = span / Math.max(1, count)
  const power = 10 ** Math.floor(Math.log10(raw))
  const e = raw / power
  return power * (e >= Math.sqrt(50) ? 10 : e >= Math.sqrt(10) ? 5 : e >= Math.SQRT2 ? 2 : 1)
}

/** About `count` round ticks inside [min, max]. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return Number.isFinite(min) ? [min] : []
  const step = tickStep(max - min, count)
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  const ticks: number[] = []
  for (let k = Math.ceil(min / step - 1e-9); k * step <= max + step * 1e-9; k++) ticks.push(Number((k * step).toFixed(decimals)))
  return ticks
}

/** The m/z range of all the series, with 4 % (at least 20) on either side, from 0 at least. */
export function mzDomain(series: ArrayLike<number>[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const values of series) {
    for (let i = 0; i < values.length; i++) {
      const v = values[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!(hi >= lo)) return [0, 100]
  const pad = Math.max(20, (hi - lo) * 0.04)
  const round = (v: number) => Math.round(v * 10) / 10
  return [round(Math.max(0, lo - pad)), round(hi + pad)]
}

/** A coordinate as SVG writes it: one decimal, no trailing zeros. */
export function px(v: number): string {
  return String(Math.round(v * 10) / 10)
}

/** Vertical sticks from `base` to each top, as one path ("M10 50V5M20 50V8"). */
export function stickPath(xs: ArrayLike<number>, tops: ArrayLike<number>, base: number): string {
  let d = ''
  const b = px(base)
  for (let i = 0; i < xs.length; i++) d += `M${px(xs[i])} ${b}V${px(tops[i])}`
  return d
}

export type Sticks = { color: string; faint: boolean; xs: number[]; tops: number[]; clipped: number[] }

/**
 * Sticks grouped by colour (and faintness, for the lower half): their x on the shared m/z scale and
 * where they end (`y` of the ratio to the half's 100 %). A stick above 100 % ends at 100 % and is
 * listed in `clipped`, for a marker.
 */
export function stickGroups(
  items: { mz: number; ratio: number; color: string; faint?: boolean }[],
  x: (mz: number) => number,
  y: (ratio: number) => number,
): Sticks[] {
  const groups = new Map<string, Sticks>()
  for (const item of items) {
    const faint = item.faint === true
    const key = `${item.color}/${faint}`
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { color: item.color, faint, xs: [], tops: [], clipped: [] }))
    const at = x(item.mz)
    g.xs.push(at)
    g.tops.push(y(Math.min(1, Math.max(0, item.ratio))))
    if (item.ratio > 1) g.clipped.push(at)
  }
  return [...groups.values()]
}

/** Small triangles pointing away from the axis at `y`, marking sticks clipped at 100 % (`up`: upper half). */
export function clipMarks(xs: number[], y: number, up: boolean): string {
  const tip = up ? y - 5 : y + 5
  return xs.map((x) => `M${px(x - 3)} ${px(y)}L${px(x)} ${px(tip)}L${px(x + 3)} ${px(y)}Z`).join('')
}

/**
 * The band of ±`tolerance` around 0 ppm over the m/z range: a rectangle for ppm; for Da a band that
 * narrows with m/z (a fixed Da tolerance is more ppm at low m/z), sampled at `steps` points and clipped
 * to `clip` (the ppm range of the plot).
 */
export function bandPath(
  tolerance: Tolerance,
  [mz0, mz1]: [number, number],
  x: (mz: number) => number,
  y: (ppm: number) => number,
  steps: number,
  clip: [number, number] = [-Infinity, Infinity],
): string {
  const limit = (ppm: number) => Math.min(clip[1], Math.max(clip[0], ppm))
  if (tolerance.unit === 'ppm') {
    const t = limit(tolerance.value)
    const b = limit(-tolerance.value)
    return `M${px(x(mz0))} ${px(y(t))}H${px(x(mz1))}V${px(y(b))}H${px(x(mz0))}Z`
  }
  const n = Math.max(2, steps)
  const at = Array.from({ length: n }, (_, i) => mz0 + ((mz1 - mz0) * i) / (n - 1))
  const ppm = (mz: number) => (tolerance.value / Math.max(mz, 1e-6)) * 1e6
  const upper = at.map((mz, i) => `${i === 0 ? 'M' : 'L'}${px(x(mz))} ${px(y(limit(ppm(mz))))}`)
  const lower = at.reverse().map((mz) => `L${px(x(mz))} ${px(y(limit(-ppm(mz))))}`)
  return `${upper.join('')}${lower.join('')}Z`
}

/**
 * Whether the label under the mirror spectrum and the similarity text fit side by side on one line of
 * `available` px (with `gap` px between them); if not, the similarity goes on a line of its own.
 */
export function stripFits(label: string, similarity: string | null, available: number, fontSize = 11, gap = 16): boolean {
  if (similarity === null) return true
  return textWidth(label, fontSize) + gap + textWidth(similarity, fontSize) <= available
}

/** The width of a label in pixels, estimated (the SVG is laid out before the text is measured). */
export function textWidth(text: string, fontSize: number): number {
  let w = 0
  for (const ch of text) {
    if (ch === ' ') w += 0.3
    else if (ch === '/' || ch === '.' || ch === '-') w += 0.38
    else if (/[₀-₉]/.test(ch)) w += 0.45
    else if (ch === '+') w += 0.62
    else if (/[A-Z]/.test(ch)) w += 0.68
    else if (/[0-9]/.test(ch)) w += 0.6
    else w += 0.56
  }
  return w * fontSize
}

/**
 * Places labels above their peaks, most important first: each at its own height `y` (a baseline),
 * or one line higher, up to `tries` positions, wherever it overlaps no label placed before (boxes
 * `width` wide around `x`, `lineHeight` high); never above `top`. A label without room is left out
 * (null): its peak keeps its colour and its tooltip.
 */
export function placeLabels(
  items: { x: number; y: number; width: number }[],
  { lineHeight, tries, top }: { lineHeight: number; tries: number; top: number },
): (number | null)[] {
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = []
  return items.map(({ x, y, width }) => {
    const x0 = x - width / 2
    const x1 = x + width / 2
    const start = Math.max(y, top)
    for (let k = 0; k < tries; k++) {
      const base = start - k * lineHeight
      if (base < top) break
      const box = { x0, x1, y0: base - lineHeight, y1: base }
      if (!placed.some((p) => p.x0 < box.x1 && box.x0 < p.x1 && p.y0 < box.y1 && box.y0 < p.y1)) {
        placed.push(box)
        return base
      }
    }
    return null
  })
}

/** The index of the value of sorted `values` nearest to `v` (-1 for none). */
export function nearest(values: ArrayLike<number>, v: number): number {
  let lo = 0
  let hi = values.length - 1
  if (hi < 0) return -1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (values[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo > 0 && Math.abs(values[lo - 1] - v) <= Math.abs(values[lo] - v) ? lo - 1 : lo
}
