<script lang="ts" module>
  /** An ion of the lower half: PeptDeep's predicted intensity, or the theoretical spectrum (one height). */
  export type BottomIon = { mz: number; height: number; type: string; ion: string; faint: boolean }

  /** The lower half: ions, or what is said instead (predicting, prediction unavailable). */
  export type Bottom =
    | { kind: 'ions'; label: string; ions: BottomIon[]; relative: boolean }
    | { kind: 'status'; label: string; message: string; failed: boolean }
</script>

<script lang="ts">
  // The annotated spectrum, mirrored (mockup 3): the observed peaks above the axis, scaled to the
  // base peak, matched ones in the colour of their series with their ions as direct labels (b blue, y
  // orange, other series dark grey; unmatched peaks light grey); below the axis PeptDeep's prediction
  // or the theoretical spectrum. Drawn by hand: each series is one path, so thousands of peaks stay a
  // handful of nodes; labels are placed most intense first and left out where they would collide.
  // Hovering tells a peak's m/z, intensity and ions; the ion table is the chart's table view.
  import { ionLabel, COLORS, type PeakGroup } from '$lib/psm/psm'
  import { mzDomain, nearest, niceTicks, placeLabels, px, scale, stickPath, textWidth } from '$lib/psm/plot'

  let {
    mz,
    intensity,
    groups,
    bottom,
    similarity = null,
    title,
    description,
    annotating = false,
    onTheoretical,
  }: {
    mz: Float32Array
    intensity: Float32Array
    /** The matched peaks with their ions (`groupByPeak`). */
    groups: PeakGroup[]
    bottom: Bottom
    /** "cosine 0.931 · spectral angle 0.762", from the PSM's features. */
    similarity?: string | null
    title: string
    description: string
    /** The annotation is on its way: the peaks show unannotated meanwhile. */
    annotating?: boolean
    /** Offered when the prediction failed: switch to the theoretical spectrum. */
    onTheoretical?: () => void
  } = $props()

  const uid = $props.id()
  const H = 300
  const M = { left: 46, right: 14, top: 22, bottom: 24 }
  const plotTop = M.top
  const plotBottom = H - M.bottom
  const mid = (plotTop + plotBottom) / 2
  const font = "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
  const ink = '#3f3f46'
  const muted = '#71717a'

  let width = $state(800)
  let svg = $state<SVGSVGElement | null>(null)

  /** The SVG (for "Export spectrum (SVG)"). */
  export function svgElement(): SVGSVGElement | null {
    return svg
  }

  const bottomIons = $derived(bottom.kind === 'ions' ? bottom.ions : [])
  const domain = $derived(mzDomain([mz, bottomIons.map((b) => b.mz)]))
  const x = $derived(scale(domain, [M.left, Math.max(M.left + 10, width - M.right)]))
  const maxI = $derived.by(() => {
    let max = 0
    for (let i = 0; i < intensity.length; i++) if (intensity[i] > max) max = intensity[i]
    return max > 0 ? max : 1
  })
  /** Upper half: relative intensity 0–1 to y (room for the base peak's label above it). */
  const upper = (r: number) => mid - r * (mid - plotTop - 16)
  /** Lower half: 0–1 to y. */
  const lower = (r: number) => mid + r * (plotBottom - mid - 4)

  const groupOf = $derived(new Map(groups.map((g) => [g.peak, g])))

  /** The sticks: one path for the unmatched peaks, one per colour for the matched ones. */
  const sticks = $derived.by(() => {
    const xs: number[] = []
    const tops: number[] = []
    for (let i = 0; i < mz.length; i++) {
      if (groupOf.has(i)) continue
      xs.push(x(mz[i]))
      tops.push(upper(intensity[i] / maxI))
    }
    const byColor = new Map<string, { xs: number[]; tops: number[] }>()
    for (const g of groups) {
      const color = colorOf(g.type)
      const s = byColor.get(color) ?? { xs: [], tops: [] }
      s.xs.push(x(g.mz))
      s.tops.push(upper(g.intensity / maxI))
      byColor.set(color, s)
    }
    return {
      unmatched: stickPath(xs, tops, mid),
      matched: [...byColor].map(([color, s]) => ({ color, d: stickPath(s.xs, s.tops, mid) })),
    }
  })

  function colorOf(type: string): string {
    return type === 'b' ? COLORS.b : type === 'y' ? COLORS.y : COLORS.other
  }

  /** The lower half's sticks: one path per colour, faint ones (theoretical ions without a match) apart. */
  const bottomSticks = $derived.by(() => {
    const paths = new Map<string, { color: string; faint: boolean; xs: number[]; tops: number[] }>()
    for (const b of bottomIons) {
      const color = colorOf(b.type)
      const key = `${color}/${b.faint}`
      const p = paths.get(key) ?? { color, faint: b.faint, xs: [], tops: [] }
      p.xs.push(x(b.mz))
      p.tops.push(lower(b.height))
      paths.set(key, p)
    }
    return [...paths.values()].map((p) => ({ color: p.color, faint: p.faint, d: stickPath(p.xs, p.tops, mid) }))
  })

  /** The labels of the matched peaks, the most intense first; those without room are left out. */
  const labels = $derived.by(() => {
    const order = [...groups].sort((p, q) => q.intensity - p.intensity)
    const ys = placeLabels(
      order.map((g) => ({ x: x(g.mz), y: upper(g.intensity / maxI) - 4, width: textWidth(g.label, 11) + 6 })),
      { lineHeight: 12, tries: 4, top: plotTop + 10 },
    )
    const out: { x: number; y: number; text: string; ions: string; key: number }[] = []
    order.forEach((g, i) => {
      const y = ys[i]
      if (y !== null) out.push({ x: x(g.mz), y, text: g.label, ions: [...new Set(g.matches.map((m) => m.type))].join(' '), key: g.peak })
    })
    return out
  })

  const xTicks = $derived(niceTicks(domain[0], domain[1], Math.max(2, Math.floor((width - M.left - M.right) / 90))))

  /** The legend at the top right: the series that show, in a fixed order. */
  const legend = $derived.by(() => {
    const items: { color: string; text: string }[] = [
      { color: COLORS.b, text: 'b ions' },
      { color: COLORS.y, text: 'y ions' },
    ]
    if (groups.some((g) => g.type !== 'b' && g.type !== 'y') || bottomIons.some((b) => b.type !== 'b' && b.type !== 'y')) {
      items.push({ color: COLORS.other, text: 'other ions' })
    }
    if (groups.length < mz.length) items.push({ color: COLORS.unmatched, text: 'unmatched' })
    let right = width - M.right
    const placed = items.map((item) => ({ ...item, w: textWidth(item.text, 11) + 22 }))
    for (let i = placed.length - 1; i >= 0; i--) {
      right -= placed[i].w
      ;(placed[i] as { x?: number }).x = right
    }
    return placed as ((typeof placed)[number] & { x: number })[]
  })

  // hover: the peak (or predicted ion) under the pointer, the most intense within 6 px
  let tip = $state<{ x: number; y: number; lines: string[] } | null>(null)

  function strongestNear(values: ArrayLike<number>, heights: ArrayLike<number>, at: number): number {
    let i = nearest(values, at)
    if (i < 0) return -1
    let best = -1
    for (let j = i; j >= 0 && Math.abs(x(values[j]) - x(at)) <= 6; j--) if (best < 0 || heights[j] > heights[best]) best = j
    for (let j = i + 1; j < values.length && Math.abs(x(values[j]) - x(at)) <= 6; j++) if (best < 0 || heights[j] > heights[best]) best = j
    return best
  }

  function onpointermove(event: PointerEvent) {
    if (!svg) return
    const box = svg.getBoundingClientRect()
    const px0 = event.clientX - box.left
    const py = event.clientY - box.top
    if (px0 < M.left - 4 || px0 > width - M.right + 4 || py < plotTop - 4 || py > plotBottom) return void (tip = null)
    const at = domain[0] + ((px0 - M.left) / (width - M.left - M.right)) * (domain[1] - domain[0])
    if (py <= mid) {
      const i = strongestNear(mz, intensity, at)
      if (i < 0) return void (tip = null)
      const g = groupOf.get(i)
      const lines = [`m/z ${mz[i].toFixed(4)} · ${((intensity[i] / maxI) * 100).toFixed(1)} %`]
      if (g) for (const m of g.matches) lines.push(`${ionLabel(m.ion)} · ${m.errorPpm >= 0 ? '+' : ''}${m.errorPpm.toFixed(2)} ppm`)
      else lines.push('unmatched')
      tip = { x: x(mz[i]), y: py, lines }
    } else if (bottom.kind === 'ions' && bottomIons.length > 0) {
      const mzs = bottomIons.map((b) => b.mz)
      const i = strongestNear(mzs, bottomIons.map((b) => b.height), at)
      if (i < 0) return void (tip = null)
      const b = bottomIons[i]
      const what = bottom.relative ? ` · ${(b.height * 100).toFixed(1)} %` : b.faint ? ' · not matched' : ' · matched'
      tip = { x: x(b.mz), y: py, lines: [`${ionLabel(b.ion)} · m/z ${b.mz.toFixed(4)}${what}`] }
    } else {
      tip = null
    }
  }
</script>

<div class="relative" bind:clientWidth={width}>
  <svg
    bind:this={svg}
    data-testid="spectrum"
    role="img"
    aria-labelledby="{uid}-title"
    aria-describedby="{uid}-desc"
    width={width}
    height={H}
    viewBox="0 0 {width} {H}"
    font-family={font}
    class="block"
    {onpointermove}
    onpointerleave={() => (tip = null)}>
    <title id="{uid}-title">{title}</title>
    <desc id="{uid}-desc">{description}</desc>

    <!-- grid: hairlines at the m/z ticks -->
    {#each xTicks as t (t)}
      <line x1={px(x(t))} x2={px(x(t))} y1={plotTop} y2={plotBottom} stroke="#f4f4f5" stroke-width="1" />
    {/each}

    <!-- the observed peaks: unmatched light grey, matched in their series' colour -->
    <path d={sticks.unmatched} stroke={COLORS.unmatched} stroke-width="1" fill="none" data-testid="unmatched-peaks" />
    {#each sticks.matched as s (s.color)}
      <path d={s.d} stroke={s.color} stroke-width="1.75" stroke-linecap="round" fill="none" />
    {/each}

    <!-- the lower half -->
    {#each bottomSticks as s (`${s.color}/${s.faint}`)}
      <path
        d={s.d}
        stroke={s.color}
        stroke-width={s.faint ? 1 : bottom.kind === 'ions' && !bottom.relative ? 1.25 : 1.75}
        stroke-opacity={s.faint ? 0.4 : 1}
        stroke-linecap="round"
        fill="none"
        data-testid="bottom-peaks" />
    {/each}
    {#if bottom.kind === 'status'}
      <text
        x={px((M.left + width - M.right) / 2)}
        y={px(mid + (plotBottom - mid) / 2 - (bottom.failed && onTheoretical ? 12 : 0))}
        text-anchor="middle"
        font-size="12"
        fill={muted}
        data-testid="bottom-status">{bottom.message}</text>
    {/if}

    <!-- the axis -->
    <line x1={M.left} x2={width - M.right} y1={mid} y2={mid} stroke={muted} stroke-width="1" />
    {#each xTicks as t (t)}
      {#if x(t) < width - M.right - 30}<text x={px(x(t))} y={H - 7} text-anchor="middle" font-size="11" fill={muted}>{t}</text>{/if}
    {/each}
    <text x={width - M.right} y={H - 7} text-anchor="end" font-size="11" fill={muted}>m/z</text>

    <!-- relative intensity: of the base peak above, of the strongest predicted ion below -->
    <g font-size="10" fill={muted} text-anchor="end">
      {#each [1, 0.5] as r (r)}
        <text x={M.left - 6} y={px(upper(r) + 3.5)}>{r * 100} %</text>
        <line x1={M.left - 3} x2={M.left} y1={px(upper(r))} y2={px(upper(r))} stroke={muted} stroke-width="1" />
        {#if bottom.kind === 'ions' && bottom.relative}
          <text x={M.left - 6} y={px(lower(r) + 3.5)}>{r * 100} %</text>
          <line x1={M.left - 3} x2={M.left} y1={px(lower(r))} y2={px(lower(r))} stroke={muted} stroke-width="1" />
        {/if}
      {/each}
    </g>

    <!-- direct labels of the matched peaks -->
    {#each labels as l (l.key)}
      <text
        x={px(l.x)}
        y={px(l.y)}
        text-anchor="middle"
        font-size="11"
        font-weight="600"
        fill={ink}
        stroke="#ffffff"
        stroke-width="3"
        stroke-linejoin="round"
        paint-order="stroke"
        data-testid="peak-label"
        data-ions={l.ions}>{l.text}</text>
    {/each}

    <!-- what the halves are, the similarity of the search, the legend -->
    <text x={M.left} y="13" font-size="11" fill={muted}>Observed{annotating ? ' · annotating…' : ''}</text>
    <text
      x={M.left + 4}
      y={plotBottom - 5}
      font-size="11"
      fill={muted}
      stroke="#ffffff"
      stroke-width="3"
      paint-order="stroke"
      data-testid="bottom-label">{bottom.label}</text>
    {#if similarity}
      <text
        x={width - M.right - 4}
        y={plotBottom - 5}
        text-anchor="end"
        font-size="11"
        fill={muted}
        stroke="#ffffff"
        stroke-width="3"
        paint-order="stroke"
        data-testid="similarity">{similarity}</text>
    {/if}
    {#each legend as item (item.text)}
      <rect x={px(item.x)} y="4" width="10" height="10" rx="2" fill={item.color} />
      <text x={px(item.x + 15)} y="13" font-size="11" fill={ink}>{item.text}</text>
    {/each}
  </svg>

  {#if bottom.kind === 'status' && bottom.failed && onTheoretical}
    <button
      type="button"
      class="absolute left-1/2 -translate-x-1/2 rounded-md border bg-background px-2.5 py-1 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      style:top="{mid + (plotBottom - mid) / 2}px"
      onclick={onTheoretical}>Show the theoretical spectrum</button>
  {/if}

  {#if tip}
    <div
      class="pointer-events-none absolute z-10 rounded-md border bg-background px-2 py-1 text-xs whitespace-nowrap shadow-sm tabular-nums"
      style:left="{tip.x > width - 200 ? tip.x - 10 : tip.x + 10}px"
      style:top="{tip.y}px"
      style:transform={tip.x > width - 200 ? 'translate(-100%, -50%)' : 'translateY(-50%)'}
      data-testid="peak-tooltip">
      {#each tip.lines as line, i (i)}<div class={i === 0 ? 'text-foreground' : 'text-muted-foreground'}>{line}</div>{/each}
    </div>
  {/if}
</div>
