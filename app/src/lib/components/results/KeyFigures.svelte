<script lang="ts">
  // The key figures above the tables: what the search found at its own cutoffs.
  import { formatPercent } from '$lib/format/fdr'
  import { formatCount } from '$lib/results/display'
  import type { KeyFigures } from '$lib/results/figures'

  let { figures, proteinFdr, proteinFdrApplied }: { figures: KeyFigures; proteinFdr: number; proteinFdrApplied: boolean } = $props()

  // proteins that cannot be told apart count once here, but each has a row in the Proteins tab
  const groupTitle = $derived.by(() => {
    const { proteins, proteinGroups } = figures
    const base = `Target protein groups at the protein FDR (contaminants included). Proteins that share all their identified peptides cannot be told apart and form one group, so they count once here, while the Proteins tab lists every protein.`
    if (proteins === proteinGroups) return `${base} Here every protein is a group of its own: ${formatCount(proteins)} proteins in ${formatCount(proteinGroups)} groups.`
    return `${base} Here: ${formatCount(proteins)} proteins in ${formatCount(proteinGroups)} groups.`
  })
  const share = $derived(figures.psmShareOfMs2 === null ? null : `${(figures.psmShareOfMs2 * 100).toFixed(0)} % of MS2`)
  const stats = $derived([
    {
      value: formatCount(figures.proteinGroups),
      note: proteinFdrApplied ? `protein groups · ${formatPercent(proteinFdr)} FDR` : 'protein groups · no protein FDR',
      title: groupTitle,
      testid: 'protein-count',
    },
    { value: formatCount(figures.peptides), note: 'peptides', title: 'Target peptides (with their modifications) at the PSM FDR', testid: 'peptide-count' },
    {
      value: formatCount(figures.psms),
      note: share ? `PSMs · ${share}` : 'PSMs',
      title: `Target PSMs at the PSM FDR, of ${formatCount(figures.ms2)} MS2 spectra`,
      testid: 'psm-count',
    },
    {
      value: formatCount(figures.samples),
      note: `${figures.samples === 1 ? 'sample' : 'samples'}${figures.conditions > 0 ? ` · ${figures.conditions} ${figures.conditions === 1 ? 'condition' : 'conditions'}` : ''}`,
      title: 'Biological samples (Condition + Replicate) of the design',
      testid: 'sample-count',
    },
    {
      value: figures.medianAbsPpm === null ? '–' : `${figures.medianAbsPpm.toFixed(1)} ppm`,
      note: 'median |precursor error|',
      title: 'Median absolute precursor mass error of those PSMs',
      testid: 'precursor-error',
    },
  ])
</script>

<div class="grid grid-cols-5 gap-2.5">
  {#each stats as s (s.testid)}
    <div class="rounded-lg border bg-background px-3 py-2.5" title={s.title}>
      <div class="text-xl font-semibold tracking-tight tabular-nums" data-testid={s.testid}>{s.value}</div>
      <div class="truncate text-xs text-muted-foreground">{s.note}</div>
    </div>
  {/each}
</div>
