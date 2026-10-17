// Sizes for people in binary units (1 GB = 2³⁰ bytes), as the module's 4 GB limit counts: one unit
// system for file sizes and memory throughout the app.

export const KB = 2 ** 10
export const MB = 2 ** 20
export const GB = 2 ** 30

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** "312 MB", "6.2 MB", "1.9 GB": one decimal below 10 (from MB on), whole numbers otherwise. */
export function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return '0 B'
  let e = Math.min(UNITS.length - 1, Math.floor(Math.log2(bytes) / 10))
  let value = bytes / 2 ** (10 * e)
  const text = (v: number, unit: number) => (v < 10 && unit > 1 ? v.toFixed(1) : String(Math.round(v)))
  if (Number(text(value, e)) >= 1024 && e < UNITS.length - 1) {
    e++
    value /= 1024
  }
  return `${text(value, e)} ${UNITS[e]}`
}
