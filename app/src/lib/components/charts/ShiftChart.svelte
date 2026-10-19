<script lang="ts">
  // The mass shifts of an open search: one thin bar per delta-mass peak the engine found (PSMs against
  // Δ mass in Da), the peaks of known modifications in the colour of modified residues and labelled with
  // their names, the others grey and labelled with their masses. The most frequent peaks carry labels, as
  // many as fit; the table next to the chart lists them all. The unmodified PSMs (|Δ| ≤ 0.05 Da) are
  // not bars: one of them would dwarf the rest, so a note at zero gives their number.
  import { barPath, tickLabel } from '$lib/format/chart'
  import { COLORS } from '$lib/psm/psm'
  import { nearest, niceTicks, placeLabels, px, scale, tickStep, textWidth } from '$lib/psm/plot'
  import { formatCount } from '$lib/results/display'
  import type { ShiftBar } from '$lib/results/delta-mass'
  import { signedNumber } from '$lib/format/number'
  import ChartTooltip from './ChartTooltip.svelte'

  let {
    title,
    description,
    bars,
    unmodified,
    height = 260,
  }: {
    title: string
    description: string
    /** By ascending mass. */
    bars: ShiftBar[]
    /** PSMs with |Δ| ≤ 0.05 Da (not drawn). */
    unmodified: number
    height?: number
  } = $props()

  const uid = $props.id()
  const M = { left: 46, right: 14, top: 46, bottom: 40 }
  const ink = '#3f3f46'
  const muted = '#71717a'
  const grid = '#f1f1f3'
  const unknownColor = '#71717a'
  const font = "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
  const barWidth = 4
  const labelFont = 11
  const maxLabels = 12

  let width = $state(900)
  const plotBottom = $derived(height - M.bottom)

  const domain = $derived.by((): [number, number] => {
    const lo = Math.min(0, ...bars.map((b) => b.x))
    const hi = Math.max(0, ...bars.map((b) => b.x))
    const pad = Math.max(10, (hi - lo) * 0.04)
    return [lo - pad, hi + pad]
  })
  const x = $derived(scale(domain, [M.left, Math.max(M.left + 40, width - M.right)]))
  const yMax = $derived.by(() => {
    const top = Math.max(1, ...bars.map((b) => b.count))
    const step = tickStep(top, 4)
    return Math.ceil(top / step - 1e-9) * step
  })
  const y = $derived(scale([0, yMax], [plotBottom, M.top]))
  const yTicks = $derived(niceTicks(0, yMax, 4))
  const xTicks = $derived(niceTicks(domain[0], domain[1], Math.max(2, Math.floor((width - M.left - M.right) / 80))))
  const xs = $derived(bars.map((b) => b.x))

  const colorOf = (b: ShiftBar) => (b.known ? COLORS.mod : unknownColor)

  /** The bars: each at least 2 px high, so that a peak of one PSM still shows. */
  const drawn = $derived(
    bars.map((b) => {
      const top = Math.min(y(b.count), plotBottom - 2)
      return { bar: b, path: barPath(x(b.x) - barWidth / 2, top, barWidth, plotBottom - top, 2), top }
    }),
  )

  /** Labels for the most frequent peaks, placed where they fit (a peak without room has its tooltip and its table row). */
  const labels = $derived.by(() => {
    const order = drawn.map((d, i) => ({ d, i })).sort((p, q) => q.d.bar.count - p.d.bar.count).slice(0, maxLabels)
    const ys = placeLabels(
      order.map(({ d }) => ({ x: x(d.bar.x), y: d.top - 4, width: textWidth(d.bar.label, labelFont) + 8 })),
      { lineHeight: 13, tries: 4, top: M.top - 6 },
    )
    return order.flatMap(({ d }, k) => (ys[k] === null ? [] : [{ x: x(d.bar.x), y: ys[k]!, text: d.bar.label, bar: d.bar }]))
  })

  let hover = $state<{ i: number; x: number; y: number } | null>(null)
  function onpointermove(event: PointerEvent) {
    const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
    const px0 = event.clientX - box.left
    const py = event.clientY - box.top
    if (px0 < M.left - 6 || px0 > width - M.right + 6 || py < M.top - 12 || py > plotBottom + 4) return void (hover = null)
    const value = domain[0] + ((px0 - M.left) / (width - M.left - M.right)) * (domain[1] - domain[0])
    const i = nearest(xs, value)
    hover = i >= 0 && Math.abs(x(xs[i]) - px0) <= 10 ? { i, x: x(xs[i]), y: Math.min(py, plotBottom - 10) } : null
  }
  const tipLines = $derived.by(() => {
    if (!hover) return []
    const b = bars[hover.i]
    return [
      `${signedNumber(b.x, 4)} Da · ${formatCount(b.count)} PSMs`,
      `${b.percentage.toFixed(1)} % of the shifted PSMs`,
      b.modification ?? 'no known modification',
    ]
  })

  const zeroNote = $derived(`unmodified (|Δ| ≤ 0.05 Da): ${formatCount(unmodified)} PSMs, not drawn`)
  const zeroEnd = $derived(x(0) + textWidth(zeroNote, labelFont) + 8 > width - M.right)
</script>

<div class="relative" bind:clientWidth={width}>
  <svg
    data-testid="delta-mass-chart"
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

    {#each yTicks as t (t)}
      <line x1={M.left} x2={width - M.right} y1={px(y(t))} y2={px(y(t))} stroke={t === 0 ? '#d4d4d8' : grid} stroke-width="1" />
      <text x={M.left - 6} y={px(y(t) + 3.5)} text-anchor="end" font-size="10" fill={muted}>{tickLabel(t)}</text>
    {/each}
    <text x="4" y="12" font-size="11" fill={muted}>PSMs</text>

    <!-- zero: where the unmodified PSMs are -->
    <line x1={px(x(0))} x2={px(x(0))} y1="20" y2={plotBottom} stroke="#a1a1aa" stroke-width="1" data-testid="zero-line" />
    <text
      x={px(x(0) + (zeroEnd ? -5 : 5))}
      y="16"
      text-anchor={zeroEnd ? 'end' : 'start'}
      font-size={labelFont}
      fill={muted}
      data-testid="zero-note">{zeroNote}</text>

    {#each drawn as d, i (i)}
      <path
        d={d.path}
        fill={colorOf(d.bar)}
        data-testid="shift-bar"
        data-mass={d.bar.x}
        data-known={d.bar.known ? '' : undefined}
        opacity={hover && hover.i !== i ? 0.55 : 1} />
    {/each}

    {#each labels as l (l.bar.x)}
      <text
        x={px(l.x)}
        y={px(l.y)}
        text-anchor="middle"
        font-size={labelFont}
        font-weight="600"
        fill={ink}
        stroke="#ffffff"
        stroke-width="3"
        stroke-linejoin="round"
        paint-order="stroke"
        data-testid="shift-label">{l.text}</text>
    {/each}

    {#each xTicks as t (t)}
      <line x1={px(x(t))} x2={px(x(t))} y1={plotBottom} y2={plotBottom + 3} stroke={muted} stroke-width="1" />
      <text x={px(x(t))} y={plotBottom + 15} text-anchor="middle" font-size="10" fill={muted}>{tickLabel(t)}</text>
    {/each}
    <text x={px((M.left + width - M.right) / 2)} y={height - 5} text-anchor="middle" font-size="11" fill={ink} data-testid="x-label">Δ mass (Da)</text>
  </svg>
  {#if hover}<ChartTooltip x={hover.x} y={hover.y} lines={tipLines} {width} />{/if}
</div>
