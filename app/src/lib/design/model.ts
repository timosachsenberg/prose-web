// The experimental design: what the user entered per file (File, Condition, Replicate, Fraction, all
// optional) resolved into samples, fraction groups and notices. Pure functions, no UI.

/** One file of the design table, as entered. Empty fields are `undefined`. */
export type DesignInput = {
  id: string
  fileName: string
  fileSize: number
  condition?: string
  replicate?: number
  fraction?: number
  techReplicate?: number
}

/** A design row with every field filled in. `assumed` says which values were not entered. */
export type ResolvedRow = Omit<DesignInput, 'condition' | 'replicate' | 'fraction' | 'techReplicate'> & {
  condition: string | null
  replicate: number
  fraction: number
  /** Which measurement of the same sample and fraction this file is (1, 2, ...). */
  techReplicate: number
  /** Index into `DesignResolution.samples` (0-based). */
  sample: number
  /** OpenMS Fraction_Group: 1-based and consecutive. The files of one measurement of one sample share it. */
  fractionGroup: number
  assumed: { replicate: boolean; fraction: boolean }
}

/** A biological sample: Condition + Replicate, or a single file without either. */
export type Sample = {
  index: number
  condition: string | null
  replicate: number
  /** "EGF 1", or the file stem for a file without a condition. */
  label: string
}

export type Notice = {
  kind:
    | 'techReplicate'
    | 'fractionGap'
    | 'unevenFractions'
    | 'multiplexed'
    | 'unknownColumn'
    | 'duplicateFile'
  message: string
  /** Ids of the rows concerned; empty for notices about a loaded file. */
  rows: string[]
}

export type DesignResolution = {
  rows: ResolvedRow[]
  samples: Sample[]
  conditions: string[]
  notices: Notice[]
  /** "6 files → 3 samples · 2 conditions · fractions 1–2" */
  summary: string
}

/** The file name without directories and without its last extension. */
export function fileStem(fileName: string): string {
  const base = fileName.slice(Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** A whole number of at least 1, or `undefined` (empty or invalid fields count as not entered). */
export function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "1–2, 4" for [1, 2, 4]. */
function ranges(sorted: number[]): string {
  const parts: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : `${sorted[i]}`)
    i = j + 1
  }
  return parts.join(', ')
}

const names = (stems: string[]) =>
  stems.length <= 2 ? stems.join(' and ') : `${stems.slice(0, -1).join(', ')} and ${stems[stems.length - 1]}`

type SampleGroup = {
  rows: number[]
  condition: string | null
  replicate: number
  /** Without a condition: the replicate number was worked out from the fractions. */
  derived: boolean
}

export function resolveDesign(inputs: DesignInput[]): DesignResolution {
  const n = inputs.length
  const condition = inputs.map((i) => i.condition?.trim() || null)
  const givenReplicate = inputs.map((i) => positiveInt(i.replicate))
  const givenFraction = inputs.map((i) => positiveInt(i.fraction))
  const givenTech = inputs.map((i) => positiveInt(i.techReplicate))
  const fraction = givenFraction.map((f) => f ?? 1)

  // Replicates. A blank one is numbered by order of appearance within its condition: the n-th file with
  // a given fraction number is replicate n (F1 F2 F1 F2 and F1 F1 F2 F2 both give replicates 1 2 for each
  // fraction; unfractionated files all have fraction 1, so they give 1 2 3). Files without a condition
  // but with a fraction form one implicit group that is numbered the same way. Replicates that were
  // entered stay as they are. A file with neither condition nor fraction is its own sample.
  const replicate: number[] = new Array(n)
  const standalone: boolean[] = new Array(n)
  const derived: boolean[] = new Array(n).fill(false)
  const occurrences = new Map<string, Map<number, number>>()
  for (let i = 0; i < n; i++) {
    standalone[i] = condition[i] === null && givenReplicate[i] === undefined && givenFraction[i] === undefined
    const given = givenReplicate[i]
    if (given !== undefined) {
      replicate[i] = given
    } else if (standalone[i]) {
      replicate[i] = 1
    } else {
      const group = condition[i] === null ? '\0' : `c\0${condition[i]}`
      let seen = occurrences.get(group)
      if (!seen) occurrences.set(group, (seen = new Map()))
      const count = (seen.get(fraction[i]) ?? 0) + 1
      seen.set(fraction[i], count)
      replicate[i] = count
      derived[i] = condition[i] === null
    }
  }

  // Samples: Condition + Replicate. Without a condition, files with a replicate or a fraction are grouped
  // by their replicate number; any other file stands alone.
  const groups = new Map<string, SampleGroup>()
  const groupOf: SampleGroup[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const key =
      condition[i] !== null
        ? `c\0${condition[i]}\0${replicate[i]}`
        : standalone[i]
          ? `f\0${i}`
          : `r\0${replicate[i]}`
    let g = groups.get(key)
    if (!g) {
      groups.set(key, (g = { rows: [], condition: condition[i], replicate: replicate[i], derived: false }))
    }
    g.rows.push(i)
    g.derived ||= derived[i]
    groupOf[i] = g
  }

  const conditions: string[] = []
  for (const c of condition) if (c !== null && !conditions.includes(c)) conditions.push(c)

  // Condition by first appearance, then replicate; files without a condition follow in file order.
  const ordered = [...groups.values()].sort((a, b) => {
    const ra = a.condition === null ? Infinity : conditions.indexOf(a.condition)
    const rb = b.condition === null ? Infinity : conditions.indexOf(b.condition)
    if (ra !== rb) return ra < rb ? -1 : 1
    if (a.condition !== null && a.replicate !== b.replicate) return a.replicate - b.replicate
    return a.rows[0] - b.rows[0]
  })
  const usedLabels = new Set<string>()
  const samples: Sample[] = ordered.map((g, index) => {
    let label =
      g.condition !== null
        ? `${g.condition} ${g.replicate}`
        : g.rows.length === 1 && !g.derived
          ? fileStem(inputs[g.rows[0]].fileName)
          : `Replicate ${g.replicate}`
    if (usedLabels.has(label)) {
      let k = 2
      while (usedLabels.has(`${label} (${k})`)) k++
      label = `${label} (${k})`
    }
    usedLabels.add(label)
    return { index, condition: g.condition, replicate: g.replicate, label }
  })
  const sampleOf = new Map<SampleGroup, number>(ordered.map((g, i) => [g, i]))
  const sample = groupOf.map((g) => sampleOf.get(g)!)

  // Technical replicates: the same sample and fraction again. Explicit numbers are kept (the first file
  // to claim a number gets it); the others take the smallest free number in file order.
  const tech: number[] = new Array(n)
  const autoTech: boolean[] = new Array(n).fill(false)
  const sameMeasurement = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const key = `${sample[i]}\0${fraction[i]}`
    const list = sameMeasurement.get(key)
    if (list) list.push(i)
    else sameMeasurement.set(key, [i])
  }
  for (const rows of sameMeasurement.values()) {
    const taken = new Set<number>()
    for (const i of rows) {
      const t = givenTech[i]
      if (t !== undefined && !taken.has(t)) {
        tech[i] = t
        taken.add(t)
      }
    }
    for (const i of rows) {
      if (tech[i] !== undefined) continue
      let t = 1
      while (taken.has(t)) t++
      tech[i] = t
      taken.add(t)
      autoTech[i] = true
    }
  }

  // Fraction groups: one per sample and technical replicate, numbered consecutively from 1.
  const groupKeys = [...new Set(inputs.map((_, i) => `${sample[i]}\0${tech[i]}`))]
    .map((k) => k.split('\0').map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const groupNumber = new Map(groupKeys.map(([s, t], i) => [`${s}\0${t}`, i + 1]))

  const rows: ResolvedRow[] = inputs.map((input, i) => ({
    ...input,
    condition: condition[i],
    replicate: replicate[i],
    fraction: fraction[i],
    techReplicate: tech[i],
    sample: sample[i],
    fractionGroup: groupNumber.get(`${sample[i]}\0${tech[i]}`)!,
    assumed: { replicate: givenReplicate[i] === undefined, fraction: givenFraction[i] === undefined },
  }))

  const notices: Notice[] = []

  // The same file name twice: the rows stay apart here, but a design needs one name per file.
  const byName = new Map<string, number[]>()
  inputs.forEach((input, i) => {
    const list = byName.get(input.fileName)
    if (list) list.push(i)
    else byName.set(input.fileName, [i])
  })
  for (const [name, list] of byName) {
    if (list.length < 2) continue
    notices.push({
      kind: 'duplicateFile',
      message: `${name} is listed ${list.length} times. Rename or remove one of them: every file needs its own name.`,
      rows: list.map((i) => inputs[i].id),
    })
  }

  // The same sample and fraction twice: kept as technical replicates, with a way to change it.
  for (const list of sameMeasurement.values()) {
    if (list.length < 2 || !list.some((i) => autoTech[i])) continue
    // The same file listed twice is reported above; it is not a technical replicate of itself.
    const distinct = [...new Set(list.map((i) => inputs[i].fileName))]
    if (distinct.length < 2) continue
    const s = samples[sample[list[0]]]
    const where = rows[list[0]].assumed.fraction ? s.label : `${s.label}, fraction ${fraction[list[0]]}`
    const files = names(distinct.map(fileStem))
    notices.push({
      kind: 'techReplicate',
      message: `${files} are the same sample (${where}) and are kept as technical replicates.`,
      rows: list.map((i) => inputs[i].id),
    })
  }

  // Fraction numbers should run 1..max without holes.
  const fractionsUsed = [...new Set(fraction)].sort((a, b) => a - b)
  const max = fractionsUsed[fractionsUsed.length - 1] ?? 0
  const missing: number[] = []
  for (let f = 1; f < max; f++) if (!fractionsUsed.includes(f)) missing.push(f)
  if (missing.length > 0) {
    const next = (f: number) => missing.includes(f - 1) || missing.includes(f + 1)
    notices.push({
      kind: 'fractionGap',
      message: `Fraction numbers skip ${ranges(missing)} (fractions used: ${ranges(fractionsUsed)}).`,
      rows: rows.filter((r) => next(r.fraction)).map((r) => r.id),
    })
  }

  // Replicates of one condition should have the same number of fractions.
  for (const c of conditions) {
    const perGroup = new Map<number, number[]>()
    rows.forEach((r, i) => {
      if (r.condition !== c) return
      const list = perGroup.get(r.fractionGroup)
      if (list) list.push(i)
      else perGroup.set(r.fractionGroup, [i])
    })
    const sizes = [...perGroup.values()].map((l) => l.length)
    const most = Math.max(...sizes)
    if (sizes.every((s) => s === most)) continue
    const short = [...perGroup.values()].filter((l) => l.length < most)
    const describe = (l: number[]) => {
      const s = samples[sample[l[0]]]
      const repeated = new Set(ordered[s.index].rows.map((i) => tech[i])).size > 1
      const measurement = repeated ? ` (measurement ${tech[l[0]]})` : ''
      return `${s.label}${measurement}: ${plural(l.length, 'fraction', 'fractions')}`
    }
    notices.push({
      kind: 'unevenFractions',
      message: `Replicates of ${c} have different numbers of fractions (up to ${most}); fewer in ${short.map(describe).join(', ')}.`,
      rows: short.flatMap((l) => l.map((i) => inputs[i].id)),
    })
  }

  let summary = `${plural(n, 'file', 'files')} → ${plural(samples.length, 'sample', 'samples')}`
  if (conditions.length > 0) summary += ` · ${plural(conditions.length, 'condition', 'conditions')}`
  if (givenFraction.some((f) => f !== undefined)) {
    const lo = fractionsUsed[0]
    summary += ` · ${lo === max ? `fraction ${lo}` : `fractions ${lo}–${max}`}`
  }

  return { rows, samples, conditions, notices, summary }
}
