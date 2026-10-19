// Numbers as the page writes them. One helper signs them, so that every table, tooltip and panel
// writes a minus the same way: a real minus (U+2212), as in typeset numbers, and never "-0.00".

/** The minus sign (U+2212). A hyphen (-) is for ProForma and CSV, which are read by programs. */
export const MINUS = '−'

/**
 * `v` with `digits` decimals and its sign: "+2.05", "−5.91". The number is rounded first, so that
 * what rounds to zero has no sign ("0.00", never "−0.00"). `plus: false` leaves the plus out (a
 * score that is usually positive: "3.142", "−1.500"). `trim` drops the zeros at the end of the
 * decimals (axis ticks: "−2.5", "0", "1"). What is no number is a dash ("–").
 */
export function signedNumber(
  v: number,
  digits: number,
  { plus = true, trim = false }: { plus?: boolean; trim?: boolean } = {},
): string {
  if (!Number.isFinite(v)) return '–'
  let text = Math.abs(v).toFixed(digits)
  if (trim) text = String(Number(text))
  if (Number(text) === 0) return text
  return `${v < 0 ? MINUS : plus ? '+' : ''}${text}`
}
