<script lang="ts">
  // The protein's sequence as text: blocks of 10 residues, 40 per row, the residues that peptides with
  // PSMs cover shaded and the modified residues dotted (#1baf7a, with the modification on hover).
  // Each row is made of a few runs of residues (covered or not, modified), not one node per residue,
  // and is only laid out when it is near the screen.
  import { formatCount } from '$lib/results/display'
  import { siteTitle, type ProteinDetail } from '$lib/results/protein'

  let { detail, sequence }: { detail: ProteinDetail; sequence: string } = $props()

  const perBlock = 10
  const perRow = 40
  const rows = $derived(Array.from({ length: Math.ceil(sequence.length / perRow) }, (_, i) => i * perRow))
  const sites = $derived(new Map(detail.sites.map((s) => [s.position, s])))

  type Run = { text: string; covered: boolean; title?: string }

  /** The residues of a block as runs: a stretch of equal coverage, and every modified residue by itself. */
  function runs(from: number, to: number): Run[] {
    const out: Run[] = []
    for (let i = from; i < to; i++) {
      const covered = detail.covered[i] === 1
      const site = sites.get(i)
      const last = out[out.length - 1]
      if (site) out.push({ text: sequence[i], covered, title: siteTitle(site) })
      else if (last && !last.title && last.covered === covered) last.text += sequence[i]
      else out.push({ text: sequence[i], covered })
    }
    return out
  }

  function blocks(row: number): { from: number; to: number }[] {
    const end = Math.min(row + perRow, sequence.length)
    const out: { from: number; to: number }[] = []
    for (let from = row; from < end; from += perBlock) out.push({ from, to: Math.min(from + perBlock, end) })
    return out
  }
</script>

<div class="map" data-testid="coverage-map" role="group" aria-label="Coverage map, {formatCount(sequence.length)} residues">
  {#each rows as row (row)}
    <div class="row" data-row>
      <span class="pos" data-testid="row-position" aria-hidden="true">{row + 1}</span>
      <span class="blocks">{#each blocks(row) as b (b.from)}<span class="block" data-block>{#each runs(b.from, b.to) as r, i (i)}{#if r.title}<span class="aa mod" data-covered={r.covered ? '' : undefined} data-modified title={r.title}>{r.text}</span>{:else if r.covered}<span class="aa cov" data-covered>{r.text}</span>{:else}{r.text}{/if}{/each}</span>{/each}</span>
    </div>
  {/each}
</div>

<style>
  .map {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
    font-size: 12px;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 8px;
    line-height: 20px;
    /* a row far from the screen is not laid out (the sequence can be tens of thousands of residues) */
    content-visibility: auto;
    contain-intrinsic-size: auto 28px;
  }
  .pos {
    width: 34px;
    flex: none;
    text-align: right;
    color: var(--color-muted-foreground);
    font-size: 11px;
  }
  .blocks {
    display: flex;
    gap: 8px;
  }
  .block {
    white-space: nowrap;
    letter-spacing: 0.16em;
  }
  /* inline, so that every row has the same height whether or not it has covered residues */
  .aa {
    position: relative;
    padding: 2px 0;
  }
  .cov {
    background: #dbeafe;
    color: #1e3a8a;
  }
  /* the modified residue: the modified-residue colours, and a dot above it */
  .mod {
    background: #d7f5ea;
    color: #065f46;
    box-shadow: inset 0 -1.5px 0 #1baf7a;
  }
  .mod::after {
    content: '';
    position: absolute;
    left: 50%;
    top: -2px;
    width: 5px;
    height: 5px;
    margin-left: -3px;
    border-radius: 50%;
    background: #1baf7a;
  }
</style>
