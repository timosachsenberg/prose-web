<script lang="ts">
  // The PSMs of each file as horizontal bars (a bar chart of one series, so one colour): the file's
  // name at the left, the value at the bar's end. The bars are at most 16 px thick with the data end
  // rounded, drawn from one baseline. Hovering a row names the file in full. The numbers are also in the
  // table under the chart (`ChartCard`).
  import { hBarPath, fitText } from '$lib/format/chart'
  import { formatCount } from '$lib/results/display'
  import { px, textWidth } from '$lib/psm/plot'
  import ChartTooltip from './ChartTooltip.svelte'

  let {
    title,
    description,
    items,
    color,
    unit = 'PSMs',
  }: {
    title: string
    description: string
    items: { file: string; count: number }[]
    color: string
    unit?: string
  } = $props()

  const uid = $props.id()
  const font = "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
  const ink = '#3f3f46'
  const rowHeight = 28
  const barHeight = 16
  const maxName = 230

  let width = $state(520)
  const longest = $derived(Math.max(0, ...items.map((i) => textWidth(i.file, 12))))
  const labelWidth = $derived(Math.min(maxName, Math.ceil(longest)))
  const max = $derived(Math.max(1, ...items.map((i) => i.count)))
  const valueWidth = $derived(textWidth(formatCount(max), 12) + 10)
  const x0 = $derived(labelWidth + 12)
  const span = $derived(Math.max(20, width - x0 - valueWidth - 6))
  const height = $derived(items.length * rowHeight + 8)

  let hover = $state<{ row: number; y: number } | null>(null)
  function onpointermove(event: PointerEvent) {
    const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
    const row = Math.floor((event.clientY - box.top - 4) / rowHeight)
    hover = row >= 0 && row < items.length ? { row, y: 4 + row * rowHeight + rowHeight / 2 } : null
  }
</script>

<div class="relative" bind:clientWidth={width}>
  <svg
    data-testid="file-chart"
    role="img"
    aria-labelledby="{uid}-title"
    aria-describedby="{uid}-desc"
    {width}
    {height}
    viewBox="0 0 {width} {height}"
    font-family={font}
    class="block"
    {onpointermove}
    onpointerleave={() => (hover = null)}>
    <title id="{uid}-title">{title}</title>
    <desc id="{uid}-desc">{description}</desc>
    {#if hover}<rect x="0" y={4 + hover.row * rowHeight} {width} height={rowHeight} fill="#f4f4f5" />{/if}
    <line x1={x0} x2={x0} y1="4" y2={height - 4} stroke="#d4d4d8" stroke-width="1" />
    {#each items as item, i (i)}
      {@const top = 4 + i * rowHeight + (rowHeight - barHeight) / 2}
      {@const length = (item.count / max) * span}
      <text x={labelWidth} y={px(top + barHeight / 2 + 4)} text-anchor="end" font-size="12" fill={ink} data-testid="file-name">{fitText(item.file, maxName, 12)}</text>
      {#if item.count > 0}<path d={hBarPath(x0, top, Math.max(2, length), barHeight, 4)} fill={color} data-testid="file-bar" />{:else}<path d="" data-testid="file-bar" />{/if}
      <text x={px(x0 + Math.max(2, length) + 6)} y={px(top + barHeight / 2 + 4)} font-size="12" fill={ink} data-testid="file-value">{formatCount(item.count)}</text>
    {/each}
  </svg>
  {#if hover}<ChartTooltip x={x0 + 20} y={hover.y} lines={[items[hover.row].file, `${formatCount(items[hover.row].count)} ${unit}`]} {width} />{/if}
</div>
