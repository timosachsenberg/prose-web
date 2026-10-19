<script lang="ts">
  // The ion table (mockup 3): per residue the theoretical m/z of the N-terminal ions of its number
  // (left of the residue) and of the C-terminal ions counted from the other end (right of it), for the
  // series and charges shown; matched ions marked by a tint of their series' colour, bold, and for
  // screen readers in words. A real table: it is the spectrum's table view too.
  import { modTitle, type PeptideView } from '$lib/format/peptide'
  import type { IonTable } from '$lib/psm/psm'

  let { table, peptide, label }: { table: IonTable; peptide: PeptideView; label: string } = $props()

  const n = $derived(peptide.residues.length)

  function cellClass(type: string, matched: boolean): string {
    if (!matched) return 'text-muted-foreground'
    return type === 'b' ? 'matched mb' : type === 'y' ? 'matched my' : 'matched mo'
  }
</script>

<div class="overflow-x-auto">
  <table class="ions w-full border-separate border-spacing-0 text-xs tabular-nums" data-testid="ion-table">
    <caption class="sr-only">Fragment ions of {label}: theoretical m/z, the matched ones marked</caption>
    <thead>
      <tr>
        <th scope="col" class="text-muted-foreground">#</th>
        {#each table.n as col (col.header)}<th scope="col" aria-label={col.header}>{col.type}<sup>{col.charge === 1 ? '+' : `${col.charge}+`}</sup></th>{/each}
        <th scope="col" class="text-center">AA</th>
        {#each table.c as col (col.header)}<th scope="col" aria-label={col.header}>{col.type}<sup>{col.charge === 1 ? '+' : `${col.charge}+`}</sup></th>{/each}
        <th scope="col" class="text-muted-foreground">#</th>
      </tr>
    </thead>
    <tbody>
      {#each table.rows as row (row.index)}
        {@const r = peptide.residues[row.index]}
        <tr>
          <td class="text-muted-foreground">{row.index + 1}</td>
          {#each row.n as cell, j (j)}
            <td
              data-type={table.n[j].type}
              data-ion={cell?.ion}
              data-matched={cell ? String(cell.matched) : undefined}
              class={cell ? cellClass(table.n[j].type, cell.matched) : ''}
              >{#if cell}{cell.mz.toFixed(4)}{#if cell.matched}<span class="sr-only"> matched</span>{/if}{/if}</td>
          {/each}
          <th scope="row" class="aa" title={r.mod ? modTitle(r.mod) : undefined}
            >{#if r.mod}<span class="m">{r.residue}<sup>{r.mod.label}</sup></span>{:else}{r.residue}{/if}</th>
          {#each row.c as cell, j (j)}
            <td
              data-type={table.c[j].type}
              data-ion={cell?.ion}
              data-matched={cell ? String(cell.matched) : undefined}
              class={cell ? cellClass(table.c[j].type, cell.matched) : ''}
              >{#if cell}{cell.mz.toFixed(4)}{#if cell.matched}<span class="sr-only"> matched</span>{/if}{/if}</td>
          {/each}
          <td class="text-muted-foreground">{n - row.index}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .ions th,
  .ions td {
    padding: 3px 7px;
    text-align: right;
    white-space: nowrap;
    border-bottom: 1px solid var(--color-border);
  }
  .ions thead th {
    font-weight: 500;
    color: var(--color-muted-foreground);
  }
  .ions thead sup {
    font-size: 9px;
    margin-left: 1px;
  }
  .ions .aa {
    text-align: center;
    font-weight: 600;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
  }
  .matched {
    font-weight: 600;
  }
  /* matched: a tint of the series' colour, the text darker for contrast (b, y, other series) */
  .mb {
    color: #1e40af;
    background: #eff6ff;
  }
  .my {
    color: #9a3412;
    background: #fff7ed;
  }
  .mo {
    color: #27272a;
    background: #f4f4f5;
  }
  .m {
    background: #d7f5ea;
    color: #065f46;
    border-radius: 3px;
    padding: 0 1px;
    box-shadow: inset 0 -1.5px 0 #1baf7a;
  }
  .m sup {
    font-family: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
    font-size: 9px;
    font-weight: 600;
    line-height: 0;
    margin-left: 1px;
  }
</style>
