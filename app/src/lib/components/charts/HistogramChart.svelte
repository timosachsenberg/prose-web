<script lang="ts" module>
  /** One series of a histogram: its counts per bin and the colour of its bars. */
  export type HistogramSeries = {
    name: string
    color: string
    counts: number[]
    /** `data-testid` of its bars. */
    testid: string
  }
</script>

<script lang="ts">
  // A histogram drawn by hand (SVG): bars of 2 px apart with the data end rounded, one or two series
  // side by side in each bin, a hairline grid, round ticks, the x axis named, an optional reference at
  // zero and an optional marker (the median) with its direct label. With two series or more, each is
  // named in the plot above its tallest bar, so colour is not the only cue. Hovering a bin reads its
  // range and counts; the numbers are also in the table under the chart (`ChartCard`). The title and
  // description name what it shows for screen readers.
  import { barPath, tickLabel } from '$lib/format/chart'
  import { formatCount } from '$lib/results/display'
  import { niceTicks, px, scale, tickStep, textWidth } from '$lib/psm/plot'
  import ChartTooltip from './ChartTooltip.svelte'

  let {
    title,
    description,
    edges,
    series,
    xLabel,
    yLabel = 'PSMs',
    zeroLine = false,
    marker = null,
    unit = '',
    height = 230,
  }: {
    title: string
    description: string
    /** n + 1 edges of n bins, ascending. */
    edges: number[]
    series: HistogramSeries[]
    xLabel: string
    yLabel?: string
    /** A reference line at x = 0 (errors around zero). */
    zeroLine?: boolean
    /** A vertical marker with its label, e.g. the median. */
    marker?: { x: number; label: string } | null
    /** Appended to the range in the tooltip ("ppm"). */
    unit?: string
    height?: number
  } = $props()

  const uid = $props.id()
  const M = { left: 46, right: 14, top: 22, bottom: 40 }
  const ink = '#3f3f46'
  const muted = '#71717a'
  const grid = '#f1f1f3'
  const font = "'Inter Variable', ui-sans-serif, system-ui, sans-serif"

  let width = $state(520)
  const plotBottom = $derived(height - M.bottom)

  const nBins = $derived(edges.length - 1)
  const x = $derived(scale([edges[0], edges[nBins]], [M.left, Math.max(M.left + 40, width - M.right)]))
  const yMax = $derived.by(() => {
    const top = Math.max(1, ...series.flatMap((s) => s.counts))
    const step = tickStep(top, 4)
    return Math.ceil(top / step - 1e-9) * step
  })
  const y = $derived(scale([0, yMax], [plotBottom, M.top]))
  const yTicks = $derived(niceTicks(0, yMax, 4))
  const xTicks = $derived(niceTicks(edges[0], edges[nBins], Math.max(2, Math.floor((width - M.left - M.right) / 70))))

  /** Where the bars of bin `b` start and how wide each is: a bin of one series fills the bin (2 px apart), of two shares it. */
  function slotOf(b: number): { start: number; each: number } {
    const k = series.length
    const left = x(edges[b])
    const slot = Math.max(1, x(edges[b + 1]) - left - 2)
    const each = Math.min(24, (slot - (k - 1)) / k)
    const used = each * k + (k - 1)
    return { start: left + 1 + (slot - used) / 2, each }
  }

  /** The bars: per bin and series a rounded column. */
  const bars = $derived.by(() => {
    const out: { path: string; series: HistogramSeries; bin: number }[] = []
    for (let b = 0; b < nBins; b++) {
      const { start, each } = slotOf(b)
      series.forEach((s, i) => {
        const count = s.counts[b] ?? 0
        if (count <= 0) return
        const top = Math.min(y(count), plotBottom - 2) // a bar of one PSM still shows
        out.push({ path: barPath(start + i * (each + 1), top, each, plotBottom - top, 4), series: s, bin: b })
      })
    }
    return out
  })

  // The names of the series, in the plot above each one's tallest bar (a later label that would touch an
  // earlier one is lifted above it)
  const LABEL_SIZE = 11
  const labels = $derived.by(() => {
    const out: { name: string; x: number; y: number }[] = []
    if (series.length < 2) return out
    series.forEach((s, i) => {
      let bin = -1
      let tallest = 0
      s.counts.forEach((c, b) => {
        if (c > tallest) (tallest = c), (bin = b)
      })
      if (bin < 0) return
      const { start, each } = slotOf(bin)
      const w = textWidth(s.name, LABEL_SIZE)
      const lx = Math.min(Math.max(start + i * (each + 1) + each / 2 - w / 2, M.left), Math.max(M.left, width - M.right - w))
      let ly = Math.min(y(tallest), plotBottom - 2) - 5
      for (const other of out) {
        const ow = textWidth(other.name, LABEL_SIZE)
        if (lx < other.x + ow + 2 && other.x < lx + w + 2 && Math.abs(ly - other.y) < LABEL_SIZE + 2) ly = other.y - (LABEL_SIZE + 2)
      }
      out.push({ name: s.name, x: lx, y: Math.max(LABEL_SIZE, ly) })
    })
    return out
  })

  // hover: the bin under the pointer
  let hover = $state<{ bin: number; x: number; y: number } | null>(null)
  const range = (b: number) => `${tickLabel(edges[b])} to ${tickLabel(edges[b + 1])}${unit ? ` ${unit}` : ''}`
  function onpointermove(event: PointerEvent) {
    const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
    const px0 = event.clientX - box.left
    const py = event.clientY - box.top
    if (px0 < M.left || px0 > width - M.right || py < M.top - 6 || py > plotBottom) return void (hover = null)
    const value = edges[0] + ((px0 - M.left) / (width - M.left - M.right)) * (edges[nBins] - edges[0])
    let b = 0
    while (b < nBins - 1 && edges[b + 1] <= value) b++
    hover = { bin: b, x: (x(edges[b]) + x(edges[b + 1])) / 2, y: py }
  }
  const tipLines = $derived(
    hover ? [range(hover.bin), ...series.map((s) => `${s.name} · ${formatCount(s.counts[hover!.bin] ?? 0)} PSMs`)] : [],
  )

  // The marker's label sits beside the line (to its right, else to its left); a long label that fits on
  // neither side stands at the top of the plot, within its edges
  const markerAt = $derived(marker ? x(marker.x) : 0)
  const markerLabel = $derived.by(() => {
    if (!marker) return { x: 0, anchor: 'start' as const, y: M.top + 1 }
    const w = textWidth(marker.label, 11)
    if (markerAt + 4 + w <= width - M.right) return { x: markerAt + 4, anchor: 'start' as const, y: M.top + 1 }
    if (markerAt - 4 - w >= M.left) return { x: markerAt - 4, anchor: 'end' as const, y: M.top + 1 }
    return { x: Math.min(Math.max(markerAt - w / 2, M.left), Math.max(M.left, width - M.right - w)), anchor: 'start' as const, y: M.top - 8 }
  })
</script>

<div class="relative" bind:clientWidth={width}>
  <svg
    data-testid="histogram"
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

    <!-- the bin under the pointer -->
    {#if hover}
      <rect x={px(x(edges[hover.bin]))} y={M.top} width={px(Math.max(1, x(edges[hover.bin + 1]) - x(edges[hover.bin])))} height={plotBottom - M.top} fill="#f4f4f5" />
    {/if}

    <!-- grid and y axis -->
    {#each yTicks as t (t)}
      <line x1={M.left} x2={width - M.right} y1={px(y(t))} y2={px(y(t))} stroke={t === 0 ? '#d4d4d8' : grid} stroke-width="1" />
      <text x={M.left - 6} y={px(y(t) + 3.5)} text-anchor="end" font-size="10" fill={muted}>{tickLabel(t)}</text>
    {/each}
    <text x="4" y="12" font-size="11" fill={muted} data-testid="y-label">{yLabel}</text>

    {#if zeroLine && edges[0] < 0 && edges[nBins] > 0}
      <line x1={px(x(0))} x2={px(x(0))} y1={M.top} y2={plotBottom} stroke="#a1a1aa" stroke-width="1" data-testid="zero-line" />
    {/if}

    {#each bars as bar, i (i)}
      <path d={bar.path} fill={bar.series.color} data-testid={bar.series.testid} data-bin={bar.bin} />
    {/each}

    {#each labels as label (label.name)}
      <text
        x={px(label.x)}
        y={px(label.y)}
        font-size={LABEL_SIZE}
        font-weight="600"
        fill={ink}
        stroke="#ffffff"
        stroke-width="3"
        stroke-linejoin="round"
        paint-order="stroke"
        data-testid="series-label">{label.name}</text>
    {/each}

    {#if marker}
      <line x1={px(markerAt)} x2={px(markerAt)} y1={M.top - 4} y2={plotBottom} stroke={ink} stroke-width="1.5" data-testid="marker-line" />
      <text
        x={px(markerLabel.x)}
        y={px(markerLabel.y)}
        text-anchor={markerLabel.anchor}
        font-size="11"
        font-weight="600"
        fill={ink}
        stroke="#ffffff"
        stroke-width="3"
        stroke-linejoin="round"
        paint-order="stroke"
        data-testid="median-label">{marker.label}</text>
    {/if}

    <!-- the x axis -->
    {#each xTicks as t (t)}
      <line x1={px(x(t))} x2={px(x(t))} y1={plotBottom} y2={plotBottom + 3} stroke={muted} stroke-width="1" />
      <text x={px(x(t))} y={plotBottom + 15} text-anchor="middle" font-size="10" fill={muted}>{tickLabel(t)}</text>
    {/each}
    <text x={px((M.left + width - M.right) / 2)} y={height - 5} text-anchor="middle" font-size="11" fill={ink} data-testid="x-label">{xLabel}</text>
  </svg>
  {#if hover}<ChartTooltip x={hover.x} y={Math.min(hover.y, plotBottom - 10)} lines={tipLines} {width} />{/if}
</div>
