<script lang="ts" module>
  export type LegendItem = { label: string; color: string; value?: string }
  export type ChartTable = {
    /** The table's accessible name. */
    name: string
    columns: { id: string; header: string; align?: 'left' | 'right' }[]
    rows: string[][]
  }
</script>

<script lang="ts">
  // A chart with what it needs to be read: a title, a subtitle that says which PSMs it shows, a legend
  // (for two series or more; the swatch is the mark's colour, the text is ink), the chart itself and a
  // table view of the numbers behind it, folded away under the chart.
  import type { Snippet } from 'svelte'

  let {
    testid,
    title,
    subtitle,
    notes = [],
    legend = [],
    table,
    class: className = '',
    children,
  }: {
    testid: string
    title: string
    subtitle: string
    /** More lines under the subtitle, e.g. what was left out. */
    notes?: string[]
    legend?: LegendItem[]
    table?: ChartTable
    class?: string
    children: Snippet
  } = $props()
</script>

<section class="min-w-0 rounded-lg border bg-background px-4 pt-3 pb-3 {className}" data-testid={testid}>
  <h3 class="text-[13px] font-semibold">{title}</h3>
  <p class="mt-0.5 text-xs text-muted-foreground" data-testid="qc-subtitle">{subtitle}</p>
  {#each notes as note (note)}<p class="text-xs text-muted-foreground" data-testid="qc-note">{note}</p>{/each}
  {#if legend.length > 0}
    <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="legend" aria-label="Legend">
      {#each legend as item (item.label)}
        <li class="flex items-center gap-1.5"><span class="inline-block size-2.5 rounded-[3px]" style:background={item.color} aria-hidden="true"></span>{item.label}{item.value ? ` · ${item.value}` : ''}</li>
      {/each}
    </ul>
  {/if}
  <div class="mt-1">{@render children()}</div>
  {#if table}
    <details class="mt-1 text-xs">
      <summary class="w-fit cursor-pointer rounded-sm py-1 text-muted-foreground select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">Table</summary>
      <div class="max-h-64 overflow-auto rounded-md border">
        <table class="w-full border-separate border-spacing-0 tabular-nums" aria-label={table.name}>
          <thead class="sticky top-0 bg-background">
            <tr>
              {#each table.columns as c (c.id)}
                <th scope="col" class="border-b px-2.5 py-1.5 font-medium text-muted-foreground {c.align === 'left' ? 'text-left' : 'text-right'}">{c.header}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each table.rows as row, i (i)}
              <tr>
                {#each row as cell, j (j)}
                  <td data-column={table.columns[j].id} class="border-b px-2.5 py-1 {table.columns[j].align === 'left' ? 'text-left' : 'text-right'}">{cell}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
  {/if}
</section>
