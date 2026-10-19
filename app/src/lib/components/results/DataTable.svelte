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
    /** The cell is a placeholder ("–" for a zero count or a missing value): shown faint. */
    placeholder?: (row: number) => boolean
    /** The cell is data that matters less (e.g. a mass shift that counts as none): shown muted. */
    secondary?: (row: number) => boolean
    /** The sort button's accessible name when the header alone is not enough (sample "1" → "control 1"). */
    ariaLabel?: string
    /** Extra classes of the cells. */
    class?: string
  }

  export type Sort = { key: string; dir: 'asc' | 'desc' }
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import { clampInto, keyTarget, rowsInView, scrollToShow, visibleRange } from '$lib/results/virtual'
  import { cn } from '$lib/utils'
  import ArrowDown from '@lucide/svelte/icons/arrow-down'
  import ArrowUp from '@lucide/svelte/icons/arrow-up'

  // Keyboard model: the scroll box is the grid and the table's one tab stop; the active row is named
  // by aria-activedescendant. The active row is always one in view: when the mouse scrolls it away,
  // or the grid's height changes, it moves to the nearest row in view, so that what Enter selects is
  // what the user sees and aria-activedescendant never names a row that is not rendered. ArrowDown
  // from a sort button in the header goes to the grid, onto the active row.

  let {
    rows,
    columns,
    sort,
    onSort,
    onRowClick,
    selected,
    label,
    rowHeight = 33,
    autoMinWidth = 220,
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
    /** The least width of the 'auto' column (pixels): the table scrolls sideways below it. */
    autoMinWidth?: number
    empty?: string
  } = $props()

  const overscan = 3
  const uid = $props.id()
  const rowId = (index: number) => `${uid}-row-${index}`

  let box = $state<HTMLDivElement | null>(null)
  let scrollTop = $state(0)
  let height = $state(600)
  let headerHeight = $state(33)
  /** The position (not the row value) of the active row. */
  let active = $state(0)

  const range = $derived(visibleRange(scrollTop, Math.max(0, height - headerHeight), rowHeight, rows.length, overscan))
  const slice = $derived(rows.subarray(range.start, range.end))
  const inView = $derived(rowsInView(scrollTop, height, rowHeight, headerHeight, rows.length))

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

  const minWidth = $derived(columns.reduce((w, c) => w + (c.width === 'auto' ? autoMinWidth : c.width), 0))

  // new rows (filtered or sorted): back to the top, the first row active
  let lastRows: Uint32Array | null = null
  $effect.pre(() => {
    if (rows === lastRows) return
    lastRows = rows
    active = 0
    scrollTop = 0
    if (box) box.scrollTop = 0
  })

  function onscroll() {
    if (!box) return
    scrollTop = box.scrollTop
    const view = rowsInView(scrollTop, box.clientHeight, rowHeight, headerHeight, rows.length)
    if (view) active = clampInto(active, view)
  }

  // the grid got shorter (or taller): the active row follows the rows in view, as it does when the
  // mouse scrolls (the scroll position itself may not change, so there is no scroll event)
  $effect(() => {
    const view = inView
    if (view) untrack(() => (active = clampInto(active, view)))
  })

  /**
   * Makes the row `row` (a row value, not a position) the active one, scrolls it into view and gives the
   * grid the keyboard focus. A row that is not in the table leaves the active row and only focuses.
   */
  export function focusRow(row: number | null) {
    const index = row === null ? -1 : rows.indexOf(row)
    if (index >= 0) activate(index)
    box?.focus({ preventScroll: true })
  }

  function onfocus() {
    if (inView) active = clampInto(active, inView)
  }

  /** Makes row `index` active and scrolls it into view. */
  function activate(index: number) {
    active = index
    if (!box) return
    const top = scrollToShow(index, box.scrollTop, box.clientHeight, rowHeight, headerHeight)
    if (top !== box.scrollTop) {
      box.scrollTop = top
      scrollTop = top
    }
  }

  function onkeydown(event: KeyboardEvent) {
    // the keys of the sort buttons in the header are theirs, but ArrowDown leaves the header for the grid
    if (event.key === 'ArrowDown' && event.target !== box && (event.target as Element).closest('thead')) {
      event.preventDefault()
      box?.focus({ preventScroll: true }) // onfocus puts the active row in view
      return
    }
    if (event.target !== box || rows.length === 0) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate(active)
      onRowClick(rows[active])
      return
    }
    const page = Math.max(1, Math.floor((height - headerHeight) / rowHeight) - 1)
    const target = keyTarget(event.key, active, rows.length, page)
    if (target === null) return
    event.preventDefault()
    activate(target)
  }

  function click(index: number, row: number) {
    active = index
    onRowClick(row)
    box?.focus({ preventScroll: true })
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
    role="columnheader"
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
        aria-label={c.ariaLabel}
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
  {onkeydown}
  {onfocus}
  role="grid"
  tabindex="0"
  aria-label={label}
  aria-readonly="true"
  aria-rowcount={rows.length + headerRows}
  aria-colcount={columns.length}
  aria-activedescendant={rows.length > 0 ? rowId(active) : undefined}
  class="grid-box relative min-h-0 flex-1 overflow-auto rounded-lg border bg-background outline-none focus-visible:border-ring"
  data-testid="table-scroll">
  <!-- the box is the grid, the table only lays it out: its parts carry their grid roles explicitly
       (the svelte-ignore comments below), since a presentational table's parts lose their own -->
  <table
    role="presentation"
    class="w-full table-fixed border-separate border-spacing-0 tabular-nums"
    style:min-width="{minWidth}px">
    <colgroup>
      {#each columns as c (c.id)}
        <col style:width={c.width === 'auto' ? undefined : `${c.width}px`} />
      {/each}
    </colgroup>
    <!-- svelte-ignore a11y_no_redundant_roles -->
    <thead role="rowgroup" class="sticky top-0 z-10 bg-background" bind:offsetHeight={headerHeight}>
      {#if hasGroups}
        <!-- svelte-ignore a11y_no_redundant_roles -->
        <tr role="row" aria-rowindex={1}>
          {#each groupCells as cell, g (g)}
            {#if cell.group === undefined}
              {@const i = columns.indexOf(cell.columns[0])}
              {@render headerCell(cell.columns[0], i, 2)}
            {:else}
              {@const i = columns.indexOf(cell.columns[0])}
              <th
                role="columnheader"
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
        <!-- svelte-ignore a11y_no_redundant_roles -->
        <tr role="row" aria-rowindex={2}>
          {#each columns as c, i (c.id)}
            {#if c.group !== undefined}{@render headerCell(c, i, 1)}{/if}
          {/each}
        </tr>
      {:else}
        <!-- svelte-ignore a11y_no_redundant_roles -->
        <tr role="row" aria-rowindex={1}>
          {#each columns as c, i (c.id)}{@render headerCell(c, i, 1)}{/each}
        </tr>
      {/if}
    </thead>
    <!-- svelte-ignore a11y_no_redundant_roles -->
    <tbody role="rowgroup">
      {#if range.start > 0}
        <tr aria-hidden="true" style:height="{range.start * rowHeight}px"><td colspan={columns.length}></td></tr>
      {/if}
      <!-- keyed: a row element always shows the same row (the active descendant's id moves with it) -->
      {#each slice as row, j (row)}
        {@const index = range.start + j}
        <!-- svelte-ignore a11y_no_redundant_roles -->
        <tr
          role="row"
          id={rowId(index)}
          data-index={index}
          aria-rowindex={headerRows + index + 1}
          aria-selected={row === selected}
          class="row"
          class:selected={row === selected}
          class:active={index === active}
          style:height="{rowHeight}px"
          onclick={() => click(index, row)}>
          {#each columns as c, i (c.id)}
            {@const value = c.cell(row)}
            <td
              role="gridcell"
              data-column={c.id}
              title={c.cellTitle?.(row)}
              class={cellClass[i]}
              class:placeholder={c.placeholder?.(row)}
              class:secondary={c.secondary?.(row)}>
              {#if typeof value === 'string'}{value}{:else}{@render value(row)}{/if}
            </td>
          {/each}
        </tr>
      {/each}
      {#if range.end < rows.length}
        <tr aria-hidden="true" style:height="{(rows.length - range.end) * rowHeight}px"
          ><td colspan={columns.length}></td></tr>
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
  }
  .row:hover {
    background: color-mix(in oklab, var(--color-muted) 50%, transparent);
  }
  .row.selected,
  .row.selected:hover {
    background: var(--color-muted);
  }
  /* the active row, while the grid has the keyboard focus */
  .grid-box:focus-visible .row.active {
    background: color-mix(in oklab, var(--color-muted) 70%, transparent);
    box-shadow: inset 3px 0 0 var(--color-ring);
  }
  /* a placeholder ("–" for zero or missing) is faint; data that matters less is muted, but readable */
  .placeholder {
    color: #d4d4d8;
  }
  .secondary {
    color: var(--color-muted-foreground);
  }
</style>
