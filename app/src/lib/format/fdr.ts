// FDR is always shown as a percentage with the q-value beside it: "1 %" · "q ≤ 0.01".

/** Quick choices of the FDR fields, as q-values (0.1 %, 1 %, 5 %). */
export const fdrChoices: readonly number[] = [0.001, 0.01, 0.05]

// plain digits with an optional decimal point or comma and exponent, then an optional "%"
const percentPattern = /^(\d+(?:[.,]\d*)?|[.,]\d+)(?:e([+-]?\d+))?\s*%?$/i

/**
 * The q-value of a typed percentage: "1", "1 %" and "1%" are 0.01, "0.01" is 0.0001 (the number is
 * always a percentage). Junk, zero and values above 100 give null.
 */
export function parsePercent(input: string): number | null {
  const match = percentPattern.exec(input.trim())
  if (!match) return null
  const percent = Number(match[1].replace(',', '.') + (match[2] ? `e${match[2]}` : ''))
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null
  return Number((percent / 100).toPrecision(12)) // 0.07 / 100 is not 0.0007 in binary floating point
}

/** The number of a q-value's percentage, without the sign: 0.01 is "1", 0.001 is "0.1". */
export function percentNumber(q: number): string {
  return String(Number((q * 100).toPrecision(6)))
}

/** A q-value as a percentage: 0.01 is "1 %", 0.001 is "0.1 %". */
export function formatPercent(q: number): string {
  return `${percentNumber(q)} %`
}

/** The q-value itself: 0.01 is "q ≤ 0.01", tiny values (below 0.0001) use scientific notation ("q ≤ 4.0e-6"). */
export function formatQ(q: number): string {
  const text = q === 0 || q >= 1e-4 ? String(Number(q.toPrecision(3))) : q.toExponential(1)
  return `q ≤ ${text}`
}
