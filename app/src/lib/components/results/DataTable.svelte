<script lang="ts" module>
  import type { Snippet } from 'svelte'

  /** A column of a DataTable: what it shows and how; `cell` gets the row (a protein, peptide or PSM index). */
  export type Column = {
    id: string
    header: string
    /** The group header above the column (per-sample columns: their condition). */
    group?: string
    /** Pixels, or 'auto' for the column that takes the rest of the width. */
    width: number | 'auto'
    align: 'left' | 'right'
    cell: (row: number) => string | Snippet<[number]>
    /** The key `onSort` gets; none: the column does not sort. */
    sortKey?: string
    /** The header's tooltip. */
    title?: string
    /** The cell's tooltip (e.g. the full text of a truncated cell). */
    cellTitle?: (row: number) => string | undefined
    /** The cell is a placeholder (a zero count, a missing value): shown muted. */
    muted?: (row: number) => boolean
    /** Extra classes of the cells. */
    class?: string
  }

  export type Sort = { key: string; dir: 'asc' | 'desc' }
</script>

<script lang="ts">
  import { tick } from 'svelte'
  import { formatCount } from '$lib/results/display'
  import { keyTarget, scrollToShow, visibleRange } from '$lib/results/virtual'
  import { cn } from '$lib/utils'
  import ArrowDown from '@lucide/svelte/icons/arrow-down'
  import ArrowUp from '@lucide/svelte/icons/arrow-up'

  let {
    rows,
    columns,
    sort,
    onSort,
    onRowClick,
    selected,
    label,
    rowHeight = 33,
    empty = 'No rows match the filters.',
  }: {
    rows: Uint32Array
    columns: Column[]
    sort: Sort
    onSort: (key: string) => void
    onRowClick: (row: number) => void
    /** The selected row (a row value, not a position). */
    selected?: number | null
    /** The table's accessible name. */
    label: string
    rowHeight?: number
    empty?: string
  } = $props()

  const overscan = 3

  let box = $state<HTMLDivElement | null>(null)
  let scrollTop = $state(0)
  let height = $state(600)
  let headerHeight = $state(33)
  /** The position (not the row value) of the row that takes the focus: one tab stop for the table. */
  let focusIndex = $state(0)

  const range = $derived(visibleRange(scrollTop, height, rowHeight, rows.length, overscan))
  const slice = $derived(rows.subarray(range.start, range.end))

  const hasGroups = $derived(columns.some((c) => c.group !== undefined))
  const headerRows = $derived(hasGroups ? 2 : 1)

  /** The header row of the groups: a cell per run of columns of one group; ungrouped columns span both rows. */
  const groupCells = $derived.by(() => {
    const cells: { group?: string; columns: Column[] }[] = []
    for (const c of columns) {
      const last = cells.at(-1)
      if (c.group !== undefined && last && last.group === c.group) last.columns.push(c)
      else cells.push({ group: c.group, columns: [c] })
    }
    return cells
  })

  /** A thin line where a group starts or ends. */
  const separated = $derived(
    columns.map((c, i) => i > 0 && (c.group ?? null) !== (columns[i - 1].group ?? null)),
  )

  // the classes of each column's cells, made once (not per cell and frame)
  const cellClass = $derived(
    columns.map((c, i) =>
      cn(
        'overflow-hidden border-b px-2.5 text-ellipsis whitespace-nowrap',
        c.align === 'right' && 'text-right',
        separated[i] && 'border-l',
        c.class,
      ),
    ),
  )

  const minWidth = $derived(columns.reduce((w, c) => w + (c.width === 'auto' ? 220 : c.width), 0))

  // new rows (filtered or sorted): back to the top, and the focus to the first row
  let lastRows: Uint32Array | null = null
  $effect.pre(() => {
    if (rows === lastRows) return
    lastRows = rows
    focusIndex = 0
    scrollTop = 0
    if (box) box.scrollTop = 0
  })

  function onscroll() {
    if (box) scrollTop = box.scrollTop
  }

  async function focusRow(index: number) {
    focusIndex = index
    if (!box) return
    const top = scrollToShow(index, box.scrollTop, box.clientHeight, rowHeight, headerHeight)
    if (top !== box.scrollTop) {
      box.scrollTop = top
      scrollTop = top
    }
    await tick()
    box.querySelector<HTMLElement>(`tr[data-index="${index}"]`)?.focus({ preventScroll: true })
  }

  function onkeydown(event: KeyboardEvent) {
    const tr = (event.target as HTMLElement).closest<HTMLElement>('tr[data-index]')
    if (!tr) return
    const index = Number(tr.dataset.index)
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onRowClick(rows[index])
      return
    }
    const page = Math.max(1, Math.floor((height - headerHeight) / rowHeight) - 1)
    const target = keyTarget(event.key, index, rows.length, page)
    if (target === null) return
    event.preventDefault()
    void focusRow(target)
  }

  function ariaSort(c: Column): 'ascending' | 'descending' | 'none' | undefined {
    if (!c.sortKey) return undefined
    if (c.sortKey !== sort.key) return 'none'
    return sort.dir === 'asc' ? 'ascending' : 'descending'
  }
</script>

{#snippet headerCell(c: Column, i: number, rowspan: number)}
  {@const order = ariaSort(c)}
  <th
    scope="col"
    {rowspan}
    aria-sort={order}
    title={c.title}
    class={cn(
      'h-[33px] border-b px-2.5 align-bottom text-xs font-medium whitespace-nowrap text-muted-foreground',
      c.align === 'right' ? 'text-right' : 'text-left',
      separated[i] && 'border-l',
    )}>
    {#if c.sortKey}
      <button
        type="button"
        class={cn(
          'inline-flex max-w-full items-center gap-1 rounded-sm py-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          order !== 'none' && 'text-foreground',
        )}
        onclick={() => onSort(c.sortKey!)}>
        <span class="truncate">{c.header}</span>
        {#if order === 'descending'}
          <ArrowDown class="size-3 shrink-0" aria-hidden="true" />
        {:else if order === 'ascending'}
          <ArrowUp class="size-3 shrink-0" aria-hidden="true" />
        {/if}
      </button>
    {:else}
      <span class="truncate">{c.header}</span>
    {/if}
  </th>
{/snippet}

<div
  bind:this={box}
  bind:clientHeight={height}
  {onscroll}
  class="relative min-h-0 flex-1 overflow-auto rounded-lg border bg-background"
  data-testid="table-scroll">
  <table
    role="grid"
    aria-readonly="true"
    aria-label={label}
    aria-rowcount={rows.length + headerRows}
    aria-colcount={columns.length}
    class="w-full table-fixed border-separate border-spacing-0 tabular-nums"
    style:min-width="{minWidth}px">
    <colgroup>
      {#each columns as c (c.id)}
        <col style:width={c.width === 'auto' ? undefined : `${c.width}px`} />
      {/each}
    </colgroup>
    <thead class="sticky top-0 z-10 bg-background" bind:offsetHeight={headerHeight}>
      {#if hasGroups}
        <tr aria-rowindex={1}>
          {#each groupCells as cell, g (g)}
            {#if cell.group === undefined}
              {@const i = columns.indexOf(cell.columns[0])}
              {@render headerCell(cell.columns[0], i, 2)}
            {:else}
              {@const i = columns.indexOf(cell.columns[0])}
              <th
                scope="colgroup"
                colspan={cell.columns.length}
                class={cn(
                  'border-b px-1 pt-1.5 pb-1 text-center text-xs font-semibold whitespace-nowrap text-foreground',
                  separated[i] && 'border-l',
                )}>{cell.group}</th
              >
            {/if}
          {/each}
        </tr>
        <tr aria-rowindex={2}>
          {#each columns as c, i (c.id)}
            {#if c.group !== undefined}{@render headerCell(c, i, 1)}{/if}
          {/each}
        </tr>
      {:else}
        <tr aria-rowindex={1}>
          {#each columns as c, i (c.id)}{@render headerCell(c, i, 1)}{/each}
        </tr>
      {/if}
    </thead>
    <tbody>
      {#if range.start > 0}
        <tr aria-hidden="true" style:height="{range.start * rowHeight}px"><td colspan={columns.length}></td></tr>
      {/if}
      {#each slice as row, j}
        {@const index = range.start + j}
        <tr
          data-index={index}
          aria-rowindex={headerRows + index + 1}
          aria-selected={row === selected}
          tabindex={index === focusIndex ? 0 : -1}
          class="row"
          class:selected={row === selected}
          style:height="{rowHeight}px"
          onclick={() => {
            focusIndex = index
            onRowClick(row)
          }}
          onfocus={() => (focusIndex = index)}
          {onkeydown}>
          {#each columns as c, i (c.id)}
            {@const value = c.cell(row)}
            <td data-column={c.id} title={c.cellTitle?.(row)} class={cellClass[i]} class:muted={c.muted?.(row)}>
              {#if typeof value === 'string'}{value}{:else}{@render value(row)}{/if}
            </td>
          {/each}
        </tr>
      {/each}
      {#if range.end < rows.length}
        <tr aria-hidden="true" style:height="{(rows.length - range.end) * rowHeight}px"><td colspan={columns.length}></td></tr>
      {/if}
    </tbody>
  </table>
  {#if rows.length === 0}
    <p class="px-4 py-10 text-center text-muted-foreground">{empty}</p>
  {/if}
</div>

<style>
  .row {
    cursor: default;
    outline: none;
  }
  .row:hover {
    background: color-mix(in oklab, var(--color-muted) 50%, transparent);
  }
  .row:focus-visible {
    background: color-mix(in oklab, var(--color-muted) 60%, transparent);
    box-shadow: inset 2px 0 0 var(--color-ring);
  }
  .row.selected,
  .row.selected:hover {
    background: var(--color-muted);
  }
  .muted {
    color: #d4d4d8;
  }
</style>
