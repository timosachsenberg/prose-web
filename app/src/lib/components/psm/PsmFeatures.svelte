<script lang="ts">
  // The PSM's features (mockup 3): its score (Percolator's when the search rescored, else
  // ln(hyperscore)), q-value and PEP, the matched ions of the annotation shown, PeptDeep's similarity
  // when the search computed it, errors, missed cleavages, the modifications; where else its peptide was
  // found; and every feature the search has, under "All features".
  import { signedNumber } from '$lib/format/number'
  import { formatCount, formatQValue, formatScore } from '$lib/results/display'
  import type { ResultModel } from '$lib/results/model'
  import { featureValue, modificationList } from '$lib/psm/psm'
  import { massShift } from '$lib/format/peptide'

  let {
    model,
    row,
    fixedMods,
    matched,
  }: {
    model: ResultModel
    row: number
    fixedMods: string[]
    /** Of the annotation shown: matched ions of those shown, and the share of the intensity they explain. */
    matched: { matched: number; total: number; intensityFraction: number } | null
  } = $props()

  const ps = $derived(model.tables.psms)
  const pt = $derived(model.tables.peptides)
  const k = $derived(ps.peptide[row])
  const names = $derived(ps.featureNames)
  const feature = (name: string) => featureValue(names, ps.features, row, name)
  const number = (v: number, digits = 3) => (Number.isFinite(v) ? String(Number(v.toPrecision(digits + 1))) : '–')

  const modifications = $derived(modificationList(pt, k, fixedMods))

  /** The samples (other than this PSM's) where the peptide has PSMs at the search's FDR. */
  const alsoIn = $derived.by(() => {
    const nS = model.samples.length
    const mine = model.psmSample[row]
    const out: string[] = []
    for (let s = 0; s < nS; s++) if (s !== mine && model.peptide.perSample[k * nS + s] > 0) out.push(model.samples[s].label)
    return out
  })

  /** The PSMs of the other forms of the sequence (modified or not) at the search's FDR. */
  const otherForms = $derived.by(() => {
    const sequence = pt.sequence[k]
    let psms = 0
    let forms = 0
    for (let j = 0; j < pt.count; j++) {
      if (j === k || pt.sequence[j] !== sequence || pt.decoy[j] !== pt.decoy[k]) continue
      if (model.peptide.psms[j] > 0) (psms += model.peptide.psms[j]), forms++
    }
    return { psms, forms }
  })

  const scoreName = $derived(model.rescored ? 'Percolator score' : 'ln(hyperscore)')
  const shift = $derived(massShift(ps.deltaMass[row]))

  type Item = { name: string; value: string; title?: string; note?: string }
  const items = $derived.by(() => {
    const list: Item[] = [{ name: scoreName, value: formatScore(ps.score[row], ps.qValue[row]) }]
    list.push({ name: 'q-value', value: formatQValue(ps.qValue[row]) })
    if (Number.isFinite(ps.pep[row])) list.push({ name: 'PEP', value: formatQValue(ps.pep[row]) })
    if (model.rescored && Number.isFinite(feature('ln(hyperscore)'))) list.push({ name: 'ln(hyperscore)', value: number(feature('ln(hyperscore)'), 3) })
    if (matched) {
      const share = Number.isFinite(matched.intensityFraction) ? ` · ${Math.round(matched.intensityFraction * 100)} % int.` : ''
      list.push({
        name: 'Matched ions',
        value: `${matched.matched} / ${matched.total}${share}`,
        title: 'Of the ions shown (the toggles above); the share of the spectrum’s intensity that their peaks carry',
      })
    }
    for (const name of ['ms2_cosine', 'ms2_spectral_angle', 'ms2_pearson']) {
      const v = feature(name)
      if (Number.isFinite(v)) list.push({ name, value: number(v, 3), title: 'PeptDeep feature of the search (over all ions)' })
    }
    const rtError = feature('rt_abs_error')
    if (Number.isFinite(rtError)) {
      list.push({ name: 'rt_abs_error', value: `${number(rtError, 3)} s`, title: 'PeptDeep feature of the search: |RT − predicted RT| after calibration' })
    }
    if (shift === null) {
      list.push({ name: 'Precursor error', value: `${signedNumber(ps.precursorErrorPpm[row], 2)} ppm` })
    } else {
      // the shift as a number on the page (a real minus), not as ProForma text
      const shiftText = signedNumber(ps.deltaMass[row], 4)
      list.push({
        name: 'Precursor error',
        value: '—',
        note: 'not shown: the open search puts the whole mass difference into the shift',
        title:
          `The open search puts the whole mass difference into the shift (${shiftText} Da), so no error is left to show. ` +
          `The PSM table's ${signedNumber(ps.precursorErrorPpm[row], 1)} ppm is relative to the unmodified peptide.`,
      })
      list.push({ name: 'Mass shift', value: `${shiftText} Da`, title: 'Unassigned mass shift of the open search, not localized' })
    }
    list.push({ name: 'Isotope error', value: String(ps.isotopeError[row]) })
    const missed = feature('enzInt')
    if (Number.isFinite(missed)) list.push({ name: 'Missed cleavages', value: String(missed) })
    list.push({ name: 'Modifications', value: modifications.length > 0 ? modifications.join(' · ') : 'none' })
    return list
  })
</script>

<div data-testid="psm-features">
  <h3 class="mb-1.5 text-[13px] font-semibold">PSM features</h3>
  <dl class="kv">
    {#each items as item (item.name)}
      <dt title={item.title}>{item.name}</dt>
      <dd title={item.title}>{item.value}{#if item.note}<span class="sr-only"> ({item.note})</span>{/if}</dd>
    {/each}
  </dl>
  {#if alsoIn.length > 0 || otherForms.psms > 0}
    <p class="mt-2.5 text-xs text-muted-foreground">
      {#if alsoIn.length > 0}Also identified in: {alsoIn.join(', ')}{/if}{#if alsoIn.length > 0 && otherForms.psms > 0}{' · '}{/if}{#if otherForms.psms > 0}other
        {otherForms.forms === 1 ? 'form' : 'forms'} of the sequence: {formatCount(otherForms.psms)}
        {otherForms.psms === 1 ? 'PSM' : 'PSMs'}{/if}
    </p>
  {/if}
  {#if names.length > 0}
    <details class="mt-2.5 text-xs">
      <summary class="cursor-pointer text-muted-foreground hover:text-foreground">All {names.length} features</summary>
      <dl class="kv mt-1.5">
        {#each names as name, j (name)}
          <dt>{name}</dt>
          <dd>{number(ps.features[row * names.length + j], 4)}</dd>
        {/each}
      </dl>
    </details>
  {/if}
</div>

<style>
  .kv {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 12px;
    font-size: 12px;
  }
  .kv dt {
    color: var(--color-muted-foreground);
  }
  .kv dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
</style>
