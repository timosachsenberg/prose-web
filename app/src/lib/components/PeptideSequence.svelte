<script lang="ts">
  import { modTitle, type ModInfo, type PeptideView } from '$lib/format/peptide'
  import { displaySettings } from '$lib/format/settings.svelte'
  import { cn } from '$lib/utils'

  let { view, class: className }: { view: PeptideView; class?: string } = $props()

  // Marked mode: runs of plain residues and single modified residues, so a table row is a handful
  // of nodes rather than one per residue.
  type Part = { text: string; mod?: ModInfo }
  const parts = $derived.by(() => {
    const out: Part[] = []
    for (const { residue, mod } of view.residues) {
      const last = out[out.length - 1]
      if (!mod && last && !last.mod) last.text += residue
      else out.push({ text: residue, mod })
    }
    return out
  })

  // ProForma mode: the bracketed modifications ("[Acetyl]-", "[Oxidation]", "-[Amidated]") are
  // the odd entries of the split.
  const proforma = $derived(view.proforma.split(/(-?\[[^\]]*\]-?)/))
</script>

<!-- The markup is one line per mode: any whitespace between the parts would show in the sequence. -->
{#if displaySettings.modMode === 'proforma'}
  <span class={cn('pep', className)}>{#each proforma as piece, i (i)}{#if i % 2 === 1}<span class="br">{piece}</span>{:else}{piece}{/if}{/each}</span>
{:else}
  <span class={cn('pep', className)}>{#if view.nTerm}<sup class="nt" title={modTitle(view.nTerm)}>{view.nTerm.label}</sup>{/if}{#each parts as part, i (i)}{#if part.mod}<span class="m" title={modTitle(part.mod)}>{part.text}<sup>{part.mod.label}</sup></span>{:else}{part.text}{/if}{/each}{#if view.cTerm}<sup class="ct" title={modTitle(view.cTerm)}>{view.cTerm.label}</sup>{/if}</span>
{/if}

<style>
  /* the modified residue: colour #1baf7a (the residue's underline and the coverage-map dots),
     background #d7f5ea, text #065f46 */
  .pep {
    --mod: #1baf7a;
    --mod-bg: #d7f5ea;
    --mod-fg: #065f46;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
    font-size: 12.5px;
    white-space: nowrap;
  }
  .m {
    background: var(--mod-bg);
    color: var(--mod-fg);
    border-radius: 3px;
    padding: 0 1px;
    box-shadow: inset 0 -1.5px 0 var(--mod);
  }
  sup {
    font-family: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
    font-size: 9px;
    font-weight: 600;
    line-height: 0;
    /* a copied selection is the sequence, not the labels */
    user-select: none;
  }
  .m sup {
    margin-left: 1px;
  }
  .nt {
    color: var(--mod-fg);
    margin-right: 1px;
  }
  .ct {
    color: var(--mod-fg);
    margin-left: 1px;
  }
  .br {
    color: var(--mod-fg);
    font-weight: 600;
  }
</style>
