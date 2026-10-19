// Small helpers of the hand-drawn SVG charts: tick labels and bar outlines.

import { textWidth } from '../psm/plot'
import { MINUS } from './number'

/**
 * A tick label: round numbers plainly ("2.5"), thousands compact ("1.5K", "20K", "1.2M"), a negative
 * one with a real minus (U+2212). What is no number is empty.
 */
export function tickLabel(v: number): string {
  if (!Number.isFinite(v)) return ''
  const abs = Math.abs(v)
  const sign = v < 0 && abs !== 0 ? MINUS : ''
  const plain = (x: number) => String(Number(x.toPrecision(6)))
  if (abs >= 1_000_000) return `${sign}${plain(abs / 1_000_000)}M`
  if (abs >= 1000) return `${sign}${plain(abs / 1000)}K`
  return `${sign}${plain(abs)}`
}

const px = (v: number) => String(Math.round(v * 10) / 10)

/**
 * A column from its top-left corner (`x`, `y`) to the baseline `y + h`, the data end (the top)
 * rounded with radius `r` and the baseline square. The radius is at most half the width and the
 * height. Empty for a bar without area.
 */
export function barPath(x: number, y: number, w: number, h: number, r: number): string {
  if (!(w > 0 && h > 0)) return ''
  const k = Math.min(r, w / 2, h)
  return `M${px(x)} ${px(y + h)}V${px(y + k)}Q${px(x)} ${px(y)} ${px(x + k)} ${px(y)}H${px(x + w - k)}Q${px(x + w)} ${px(y)} ${px(x + w)} ${px(y + k)}V${px(y + h)}Z`
}

/** A horizontal bar from the baseline `x` to `x + w`, its right end (the data end) rounded; `y`, `h` its top and height. */
export function hBarPath(x: number, y: number, w: number, h: number, r: number): string {
  if (!(w > 0 && h > 0)) return ''
  const k = Math.min(r, w, h / 2)
  return `M${px(x)} ${px(y)}H${px(x + w - k)}Q${px(x + w)} ${px(y)} ${px(x + w)} ${px(y + k)}V${px(y + h - k)}Q${px(x + w)} ${px(y + h)} ${px(x + w - k)} ${px(y + h)}H${px(x)}Z`
}

/**
 * `text` shortened in the middle with "…" to fit `maxWidth` px at `fontSize` (the width is estimated);
 * a file name keeps its start and its end ("sample_with_a_long…_1.mzML").
 */
export function fitText(text: string, maxWidth: number, fontSize: number): string {
  if (textWidth(text, fontSize) <= maxWidth) return text
  const chars = Array.from(text)
  let keep = chars.length - 1
  while (keep > 2) {
    const head = Math.ceil(keep / 2)
    const tail = keep - head
    const candidate = `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`
    if (textWidth(candidate, fontSize) <= maxWidth) return candidate
    keep--
  }
  return '…'
}
