<script lang="ts">
  // The peptide with its fragment ladder (mockup 3): the residues in large monospace, a modified one
  // marked (the colour #1baf7a and a short label below it, as in the tables), and at each cleavage a
  // mark above it where an N-terminal ion explains it (b blue, a or c dark grey) and below it where a
  // C-terminal ion does (y orange, x or z dark grey). Long peptides get smaller to fit the width.
  import { modTitle, type PeptideView } from '$lib/format/peptide'
  import { COLORS } from '$lib/psm/psm'

  let {
    peptide,
    cuts,
    shift = null,
    available = 0,
  }: {
    peptide: PeptideView
    /** Per cleavage: the series explaining it from either end, or null (see `ladderCuts`). */
    cuts: { n: (string | null)[]; c: (string | null)[] }
    /** An open search's unlocalized mass shift ("+15.9949"), shown before the sequence. */
    shift?: string | null
    /** The width of the row (pixels): a long peptide gets smaller to fit it, down to half size, then wraps. */
    available?: number
  } = $props()

  const n = $derived(peptide.residues.length)
  // a residue is 32 px and a cleavage 10 px at full size; long peptides shrink to the width
  const full = $derived(n * 42 + (shift ? 110 : 0) + (peptide.nTerm ? 22 : 0) + (peptide.cTerm ? 22 : 0))
  const s = $derived(available > 0 ? Math.max(0.5, Math.min(1, (available - 4) / full)) : 1)

  const color = (type: string | null, best: string) => (type === best ? (best === 'b' ? COLORS.b : COLORS.y) : COLORS.other)

  const explained = $derived.by(() => {
    const cutsN = cuts.n.filter((t) => t !== null).length
    const cutsC = cuts.c.filter((t) => t !== null).length
    return `${cutsN} of ${n - 1} cleavages explained by N-terminal ions, ${cutsC} by C-terminal ions`
  })
</script>

<div class="max-w-full min-w-0">
  <div
    class="ladder"
    style:--s={s}
    data-testid="fragment-ladder"
    role="img"
    aria-label="{peptide.proforma}: {explained}">
    {#if shift}<span class="shift" title="Unassigned mass shift (Da), not localized">[{shift}]?</span>{/if}
    {#if peptide.nTerm}<span class="term" title={modTitle(peptide.nTerm)}>{peptide.nTerm.label}</span>{/if}
    {#each peptide.residues as r, i (i)}
      <span class="aa" class:mod={r.mod !== undefined} title={r.mod ? modTitle(r.mod) : undefined}>
        <span class="letter" data-testid="ladder-residue">{r.residue}</span>
        {#if r.mod}<span class="label" data-testid="ladder-mod">{r.mod.label}</span>{/if}
      </span>
      {#if i < n - 1}
        <span class="cut">
          {#if cuts.n[i]}<i class="n" data-cut={cuts.n[i]} style:--c={color(cuts.n[i], 'b')}></i>{/if}
          {#if cuts.c[i]}<i class="c" data-cut={cuts.c[i]} style:--c={color(cuts.c[i], 'y')}></i>{/if}
        </span>
      {/if}
    {/each}
    {#if peptide.cTerm}<span class="term" title={modTitle(peptide.cTerm)}>{peptide.cTerm.label}</span>{/if}
  </div>
</div>

<style>
  .ladder {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
    font-size: calc(22px * var(--s));
    white-space: nowrap;
  }
  .aa {
    position: relative;
    width: calc(32px * var(--s));
    height: calc(52px * var(--s));
    line-height: calc(46px * var(--s));
    text-align: center;
    flex: none;
  }
  .aa.mod .letter {
    background: #d7f5ea;
    color: #065f46;
    border-radius: 4px;
    padding: 0 3px;
    box-shadow: inset 0 -2px 0 #1baf7a;
  }
  .label {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(-3px * var(--s));
    font-family: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
    font-size: 10px;
    line-height: 10px;
    font-weight: 600;
    color: #065f46;
  }
  .term {
    align-self: flex-start;
    margin-top: calc(6px * var(--s));
    font-family: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
    font-size: 11px;
    font-weight: 600;
    color: #065f46;
  }
  .shift {
    margin-right: 8px;
    font-size: 13px;
    color: var(--color-muted-foreground);
  }
  .cut {
    position: relative;
    width: calc(10px * var(--s));
    height: calc(46px * var(--s));
    flex: none;
  }
  /* above: a bracket opening to the N-terminal side; below: one opening to the C-terminal side */
  .cut i {
    position: absolute;
    left: calc(4px * var(--s));
    width: 2px;
    height: calc(20px * var(--s));
    background: var(--c);
  }
  .cut i::after {
    content: '';
    position: absolute;
    width: calc(8px * var(--s));
    height: 2px;
    background: var(--c);
  }
  .cut .n {
    top: 2px;
  }
  .cut .n::after {
    left: calc(-6px * var(--s));
    top: 0;
  }
  .cut .c {
    bottom: 2px;
  }
  .cut .c::after {
    left: 0;
    bottom: 0;
  }
</style>
