<script lang="ts">
  // The protein's peptides with their PSM counts per sample, by position: the first 100, then "Show 100
  // more" (a protein can have a thousand, and Peptides is the tab the panel opens with). A peptide (a
  // modified form of a sequence is a peptide of its own) expands in place to its PSMs, best q-value
  // first: 10, then "Show 50 more" and "All n in the PSM table". One PSM opens in the PSM view. One
  // peptide is open at a time: the strip above shows it. Focus follows what is revealed: the first new
  // peptide's expander, the last new PSM's button.
  import PeptideSequence from '$lib/components/PeptideSequence.svelte'
  import { Button } from '$lib/components/ui/button'
  import { massShift, peptideView } from '$lib/format/peptide'
  import { formatCount, formatQValue, sampleHeader, spectrumLabel } from '$lib/results/display'
  import { peptidePsms, type ProteinDetail } from '$lib/results/protein'
  import type { ResultsView } from '$lib/results/view.svelte'
  import { cn } from '$lib/utils'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import { tick } from 'svelte'
  import { signed } from '../results/cells'

  let {
    view,
    detail,
    expanded = $bindable(null),
    onOpenPsm,
    onOpenPsmTable,
  }: {
    view: ResultsView
    detail: ProteinDetail
    /** The peptide whose PSMs show (a row of `tables.peptides`), or null. */
    expanded?: number | null
    onOpenPsm: (psm: number) => void
    /** "All n in the PSM table": the PSM table filtered by one peptide. */
    onOpenPsmTable: (filter: { peptide: number }) => void
  } = $props()

  /** The peptides the list shows at first, and how many more each "Show more" adds. */
  const firstPeptides = 100
  const morePeptides = 100
  /** The PSMs a peptide shows at first, and how many more each "Show more" adds. */
  const firstPsms = 10
  const morePsms = 50

  const uid = $props.id()

  /** Pixels of a per-sample count column. */
  const sampleWidth = 34

  const m = $derived(view.model)
  const pt = $derived(m.tables.peptides)
  const ps = $derived(m.tables.psms)
  const nS = $derived(m.samples.length)
  const fixedMods = $derived(view.result.settings.fixedMods)

  // the columns of one condition sit under its name, as in the Proteins table
  const groups = $derived.by(() => {
    const out: { name: string | null; size: number }[] = []
    for (const s of m.samples) {
      const last = out[out.length - 1]
      if (last && last.name === s.condition) last.size++
      else out.push({ name: s.condition, size: 1 })
    }
    return out
  })
  const hasGroups = $derived(groups.some((g) => g.name !== null))

  /** "F2" next to the sample when the design has fractions. */
  const fractions = $derived(m.design.rows.some((r) => r.fraction > 1))

  // the peptides listed: the first 100 and what was asked for since; the open peptide is always listed
  // (it can be one that was revealed before a visit to another tab)
  let asked = $state(firstPeptides)
  const openIndex = $derived(expanded === null ? -1 : detail.peptides.findIndex((e) => e.peptide === expanded))
  const count = $derived(Math.min(detail.peptides.length, Math.max(asked, openIndex + 1)))
  const listed = $derived(detail.peptides.slice(0, count))
  const left = $derived(detail.peptides.length - count)

  /** Reveals the next peptides, and moves the focus to the first of them (the button moved down). */
  async function showMorePeptides() {
    const first = count
    asked = count + morePeptides
    await tick()
    document.getElementById(`${uid}-peptide-${detail.peptides[first].peptide}`)?.focus()
  }

  let shown = $state(firstPsms)
  const psms = $derived(expanded === null ? new Uint32Array(0) : peptidePsms(m, expanded))

  function toggle(peptide: number) {
    expanded = expanded === peptide ? null : peptide
    shown = firstPsms
  }

  /**
   * Reveals the next PSMs of the open peptide. The button stays where it is (below the new rows) while
   * there are more; when the last ones appear it goes, and the focus moves to the last PSM's button
   * instead of being lost.
   */
  async function showMorePsms() {
    shown += morePsms
    if (shown < psms.length) return
    await tick()
    document.getElementById(`${uid}-psm-${psms[psms.length - 1]}`)?.focus()
  }

  /** The columns the text of a PSM row spans (the q-value and the button take the rest). */
  const descriptionSpan = $derived(Math.min(nS, 6))

  /** "control 1 · F2 · scan 4711 · 2+ · Δ +0.6 ppm"; with a shift, the shift first (for the title). */
  function describe(i: number, shift: string | null = null): string {
    const parts: string[] = [m.samples[m.psmSample[i]].label]
    if (fractions) parts.push(`F${m.design.rows[ps.file[i]].fraction}`)
    parts.push(`scan ${spectrumLabel(ps.nativeId[i])}`, `${ps.charge[i]}+`)
    if (ps.precursorErrorPpm[i] === ps.precursorErrorPpm[i]) parts.push(`Δ ${signed(ps.precursorErrorPpm[i], 1)} ppm`)
    return `${shift === null ? '' : `[${shift}]? `}${parts.join(' · ')}`
  }

  const th = 'h-8 border-b px-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground'
  const td = 'border-b px-2 py-[7px] text-right whitespace-nowrap'
  // made once: a hundred rows of up to dozens of count cells are not worth a class merge each
  const countCell = 'border-b px-1 py-[7px] text-right whitespace-nowrap'
  const noCount = `${countCell} text-[#d4d4d8]`
</script>

{#if detail.peptides.length === 0}
  <p class="py-8 text-center text-muted-foreground">
    No peptide of this protein has a PSM at the search's PSM FDR.
  </p>
{:else}
  <p class="mb-1.5 text-xs text-muted-foreground" data-testid="peptide-note">
    {#if left > 0}
      Showing {formatCount(count)} of {formatCount(detail.peptides.length)} peptides{#if detail.peptides.length !== detail.sequences}
        ({formatCount(detail.sequences)} sequences; modified forms are listed apart){/if}, by position.
    {:else if detail.peptides.length !== detail.sequences}
      {formatCount(detail.peptides.length)} peptide forms of {formatCount(detail.sequences)} peptides: modified forms of a
      sequence are listed apart.
    {:else}
      Click a peptide to list its PSMs, a PSM to open its spectrum.
    {/if}
  </p>
  <div class="overflow-x-auto">
    <table
      class="w-full table-fixed border-separate border-spacing-0 text-[12.5px] tabular-nums"
      style:min-width="{154 + sampleWidth * nS + 170}px"
      aria-label="Peptides of the protein">
      <colgroup>
        <col />
        <col style:width="46px" />
        <col style:width="48px" />
        <col style:width="60px" />
        {#each m.samples as s (s.index)}<col style:width="{sampleWidth}px" />{/each}
      </colgroup>
      <thead class="sticky top-0 z-10 bg-background">
        <tr>
          <th scope="col" rowspan={hasGroups ? 2 : 1} class={cn(th, 'text-left')}>Peptide</th>
          <th scope="col" rowspan={hasGroups ? 2 : 1} class={th} title="First residue of the peptide in the protein (1-based)">Start</th>
          <th scope="col" rowspan={hasGroups ? 2 : 1} class={th} title="PSMs at the search PSM FDR">PSMs</th>
          <th scope="col" rowspan={hasGroups ? 2 : 1} class={th} title="Best PSM q-value">best q</th>
          {#if hasGroups}
            {#each groups as g, i (i)}
              <th scope="colgroup" colspan={g.size} class="h-7 border-b border-l px-1 pt-1 text-center text-xs font-semibold text-foreground">{g.name ?? ''}</th>
            {/each}
          {:else}
            {#each m.samples as s (s.index)}<th scope="col" class={th} title={s.label}>{s.label}</th>{/each}
          {/if}
        </tr>
        {#if hasGroups}
          <tr>
            {#each m.samples as s (s.index)}
              <th scope="col" class={cn(th, 'h-6 px-1')} title={s.label}>{sampleHeader(s)}</th>
            {/each}
          </tr>
        {/if}
      </thead>
      <tbody>
        {#each listed as e (e.peptide)}
          {@const open = expanded === e.peptide}
          {@const start = e.located ? e.spans[0].start + 1 : null}
          <!-- the whole row toggles; the button in its first cell is the keyboard's way in (its click bubbles up here) -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
          <tr
            data-testid="panel-peptide"
            data-sequence={pt.sequence[e.peptide]}
            class={cn('cursor-default hover:bg-muted/50', open && 'bg-muted')}
            onclick={() => toggle(e.peptide)}>
            <td class="overflow-hidden border-b py-[5px] pr-2 pl-1">
              <button
                type="button"
                id="{uid}-peptide-{e.peptide}"
                aria-expanded={open}
                title={pt.proforma[e.peptide]}
                class="flex max-w-full items-center gap-1 rounded-sm py-0.5 pr-1 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
                <ChevronRight class={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden="true" />
                <!-- a long peptide (ProForma text is longer) ends in an ellipsis; its title has all of it -->
                <span class="min-w-0 truncate"><PeptideSequence view={peptideView(pt, e.peptide, fixedMods)} /></span><span class="sr-only">, {e.psms} PSMs</span>
              </button>
            </td>
            <td class={td} data-column="start" title={e.located ? `Residues ${e.spans.map((s) => `${s.start + 1}–${s.end}`).join(', ')}` : 'The search recorded no place for it in the sequence'}>
              {start ?? '–'}
            </td>
            <td class={td} data-column="psms">{formatCount(e.psms)}</td>
            <td class={td} data-column="bestq">{formatQValue(m.peptide.bestQ[e.peptide])}</td>
            {#each m.samples as s (s.index)}
              {@const count = m.peptide.perSample[e.peptide * nS + s.index]}
              <td class={count === 0 ? noCount : countCell}>{count === 0 ? '–' : formatCount(count)}</td>
            {/each}
          </tr>
          {#if open}
            {#each psms.subarray(0, shown) as i (i)}
              {@const shift = massShift(ps.deltaMass[i])}
              <!-- one line: the text takes the first columns (up to six), the q-value and the button what is right of them -->
              <tr data-testid="panel-psm" data-scan={spectrumLabel(ps.nativeId[i])} class="bg-[#fafafa] text-xs">
                <td colspan={descriptionSpan} class="overflow-hidden border-b py-1 pr-2 pl-[34px] text-left text-ellipsis whitespace-nowrap" title={describe(i, shift)}>
                  {#if shift !== null}<span class="font-mono text-muted-foreground">[{shift}]?</span>{' '}{/if}{describe(i)}
                </td>
                <td colspan="2" class="border-b px-2 py-1 text-right whitespace-nowrap">{formatQValue(ps.qValue[i])}</td>
                <td colspan={nS - descriptionSpan + 2} class="border-b px-2 py-1 text-left whitespace-nowrap">
                  <button
                    type="button"
                    id="{uid}-psm-{i}"
                    data-psm={i}
                    class="rounded-sm px-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    aria-label="Open the PSM of scan {spectrumLabel(ps.nativeId[i])}"
                    onclick={() => onOpenPsm(i)}>PSM ›</button>
                </td>
              </tr>
            {/each}
            {#if psms.length > firstPsms}
              <tr class="bg-[#fafafa] text-xs">
                <td colspan={4 + nS} class="border-b py-1 pl-[34px] text-left whitespace-nowrap">
                  {#if psms.length > shown}
                    <button
                      type="button"
                      class="mr-4 rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      onclick={showMorePsms}>Show {Math.min(morePsms, psms.length - shown)} more ({formatCount(psms.length - shown)} left)</button>
                  {/if}
                  <button
                    type="button"
                    class="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    onclick={() => onOpenPsmTable({ peptide: e.peptide })}>All {formatCount(psms.length)} in the PSM table ›</button>
                </td>
              </tr>
            {/if}
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
  {#if left > 0}
    <div class="mt-2 mb-1 flex justify-center">
      <Button variant="outline" size="sm" class="h-7 px-2.5 text-xs" onclick={showMorePeptides}
        >Show {Math.min(morePeptides, left)} more ({formatCount(left)} left)</Button>
    </div>
  {/if}
{/if}
