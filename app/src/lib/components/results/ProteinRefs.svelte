<script lang="ts">
  // The proteins of a peptide in a table cell: the first accession and how many more, or "below
  // protein FDR" when all of its proteins failed the protein FDR (the engine then lists none).
  import { parseAccession } from '$lib/results/display'
  import type { ResultModel } from '$lib/results/model'
  import Marker from './Marker.svelte'

  let { model, peptide }: { model: ResultModel; peptide: number } = $props()

  const proteins = $derived(model.peptide.proteins[peptide])
  const first = $derived(proteins.length > 0 ? parseAccession(model.tables.proteins.accession[proteins[0]]) : null)
</script>

{#if first === null}
  <span class="text-muted-foreground italic" title="All proteins of this peptide are above the protein FDR">below protein FDR</span>
{:else}
  <span class="font-mono text-[12.5px]">{first.id}</span>{#if proteins.length > 1}<span class="text-muted-foreground">
      +{proteins.length - 1}</span
    >{/if}{#if model.peptide.contaminant[peptide]}<Marker text="contaminant" />{/if}
{/if}
