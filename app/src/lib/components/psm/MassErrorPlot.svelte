<script lang="ts">
  // The fragment mass errors (mockup 3): one dot per matched ion, m/z against the error in ppm, in
  // the colour of its series, its area by the intensity of its peak; the band is the search's fragment
  // tolerance (for a tolerance in Da it narrows with m/z). The mean and the spread are written below.
  import type { PeakMatch } from '$lib/engine/openms-types'
  import { COLORS, errorStats, ionColor, ionLabel, signedText, type Tolerance } from '$lib/psm/psm'
  import { bandPath, niceTicks, px, scale } from '$lib/psm/plot'

  let {
    matches,
    mz,
    intensity,
    tolerance,
    domain,
  }: {
    /** The matches shown (one dot each). */
    matches: PeakMatch[]
    mz: Float32Array
    intensity: Float32Array
    tolerance: Tolerance
    /** The m/z range, as the spectrum's. */
    domain: [number, number]
  } = $props()

  const uid = $props.id()
  const H = 220
  const M = { left: 40, right: 12, top: 12, bottom: 26 }
  const font = "'Inter Variable', ui-sans-serif, system-ui, sans-serif"
  const muted = '#71717a'
  let width = $state(360)

  const toleranceText = $derived(`tolerance ±${tolerance.value} ${tolerance.unit}`)

  /** The ppm range: the band and the errors, with some room. */
  const yMax = $derived.by(() => {
    const worst = Math.max(0, ...matches.map((m) => Math.abs(m.errorPpm)))
    if (tolerance.unit === 'ppm') return Math.max(tolerance.value, worst) * 1.2
    const atHigh = (tolerance.value / Math.max(domain[1], 1)) * 1e6
    return Math.max(worst * 1.25, atHigh * 1.2, 1)
  })
  const x = $derived(scale(domain, [M.left, Math.max(M.left + 10, width - M.right)]))
  const y = $derived(scale([yMax, -yMax], [M.top, H - M.bottom]))
  const xTicks = $derived(niceTicks(domain[0], domain[1], Math.max(2, Math.floor((width - M.left - M.right) / 80))))
  const yTicks = $derived(tolerance.unit === 'ppm' ? [-tolerance.value, -tolerance.value / 2, 0, tolerance.value / 2, tolerance.value] : niceTicks(-yMax, yMax, 4))
  const band = $derived(bandPath(tolerance, domain, x, y, 48, [-yMax, yMax]))

  const maxI = $derived.by(() => {
    let max = 0
    for (let i = 0; i < intensity.length; i++) if (intensity[i] > max) max = intensity[i]
    return max > 0 ? max : 1
  })
  /** Dot radius: its area grows with the peak's intensity. */
  const radius = (i: number) => 2.5 + 4.5 * Math.sqrt(Math.max(0, intensity[i] ?? 0) / maxI)

  // the large dots first, so that small ones stay visible on top
  const dots = $derived(
    [...matches]
      .sort((p, q) => (intensity[q.peak] ?? 0) - (intensity[p.peak] ?? 0))
      .map((m) => ({ m, cx: x(mz[m.peak]), cy: y(m.errorPpm), r: radius(m.peak) })),
  )
  const stats = $derived(errorStats(matches))
  const statsText = $derived(
    matches.length === 0
      ? 'no matched ions'
      : `mean ${signedText(stats.mean, 1)} ppm${Number.isFinite(stats.sd) ? ` · SD ${stats.sd.toFixed(1)} ppm` : ''} · dot size = intensity`,
  )
  const fmt = (v: number) => String(Number(v.toFixed(2)))
</script>

<div bind:clientWidth={width}>
  <svg
    role="img"
    aria-labelledby="{uid}-title"
    aria-describedby="{uid}-desc"
    width={width}
    height={H}
    viewBox="0 0 {width} {H}"
    font-family={font}
    class="block">
    <title id="{uid}-title">Fragment mass error</title>
    <desc id="{uid}-desc"
      >{matches.length} matched ions: error in ppm against m/z, within the {toleranceText}; {statsText}. Each dot's title names its
      ion.</desc>

    <path d={band} fill="#f4f4f5" data-testid="tolerance-band" />
    {#each yTicks as t (t)}
      <line x1={M.left} x2={width - M.right} y1={px(y(t))} y2={px(y(t))} stroke={t === 0 ? '#a1a1aa' : '#e4e4e7'} stroke-width="1" />
      <text x={M.left - 6} y={px(y(t) + 3.5)} text-anchor="end" font-size="10" fill={muted}>{fmt(t)}</text>
    {/each}
    <text x="4" y={M.top - 2} font-size="10" fill={muted}>ppm</text>
    {#each xTicks as t (t)}
      {#if x(t) < width - M.right - 26}<text x={px(x(t))} y={H - 9} text-anchor="middle" font-size="10" fill={muted}>{t}</text>{/if}
    {/each}
    <text x={width - M.right} y={H - 9} text-anchor="end" font-size="10" fill={muted}>m/z</text>
    <text x={width - M.right - 4} y={px(y(Math.min(yMax, tolerance.unit === 'ppm' ? tolerance.value : yMax)) + 12)} text-anchor="end" font-size="10" fill={muted}
      >{toleranceText}</text>

    {#each dots as d, i (i)}
      <circle
        cx={px(d.cx)}
        cy={px(d.cy)}
        r={px(d.r)}
        fill={ionColor(d.m.type)}
        stroke="#ffffff"
        stroke-width="1.5"
        data-testid="error-dot"
        data-type={d.m.type}
        data-error-ppm={d.m.errorPpm}
        data-mz={mz[d.m.peak]}
        ><title>{ionLabel(d.m.ion)} · m/z {mz[d.m.peak].toFixed(4)} · {signedText(d.m.errorPpm, 2)} ppm</title></circle>
    {/each}
  </svg>
  <p class="mt-1 text-xs text-foreground tabular-nums" data-testid="error-stats">{statsText}</p>
  <p class="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground" aria-hidden="true" title="Hover a dot for its ion">
    <span><i class="key" style:background={COLORS.b}></i>b</span>
    <span><i class="key" style:background={COLORS.y}></i>y</span>
    <span><i class="key" style:background={COLORS.other}></i>other series</span>
  </p>
</div>

<style>
  .key {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 4px;
    vertical-align: 0;
  }
</style>
