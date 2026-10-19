<script lang="ts">
  // The hover readout of the hand-drawn charts: the first line leads (the value), the rest explains.
  // Positioned at (`x`, `y`) in the chart's box; it flips to the left of the point near the right edge.
  let { x, y, lines, width }: { x: number; y: number; lines: string[]; width: number } = $props()
  const flip = $derived(x > width - 200)
</script>

<div
  class="pointer-events-none absolute z-10 rounded-md border bg-background px-2 py-1 text-xs whitespace-nowrap shadow-sm tabular-nums"
  style:left="{flip ? x - 10 : x + 10}px"
  style:top="{y}px"
  style:transform={flip ? 'translate(-100%, -50%)' : 'translateY(-50%)'}
  data-testid="chart-tooltip">
  {#each lines as line, i (i)}<div class={i === 0 ? 'text-foreground' : 'text-muted-foreground'}>{line}</div>{/each}
</div>
