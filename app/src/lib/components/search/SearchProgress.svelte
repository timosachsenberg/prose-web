<script lang="ts">
  // The progress of the running search: its step (with the file), a bar that is indeterminate while the
  // fraction does not move, the percentage and the elapsed time. `compact`: for the top bar.
  import { Progress } from '$lib/components/ui/progress'
  import { searchProgress as p } from '$lib/search/session.svelte'
  import { cn } from '$lib/utils'

  let { compact = false, class: className }: { compact?: boolean; class?: string } = $props()
</script>

{#if compact}
  <span class={cn('flex items-center gap-2', className)}>
    <Progress class="w-16" value={p.indeterminate ? null : p.percent} aria-label="Search progress" />
    <span class="text-xs whitespace-nowrap tabular-nums">Searching{p.indeterminate ? '…' : ` ${p.percent} %`}</span>
  </span>
{:else}
  <div class={cn('flex min-w-0 items-center gap-3', className)} data-testid="search-progress">
    <div class="min-w-0 flex-1">
      <p class="truncate text-xs" aria-live="polite">{p.label}</p>
      <Progress class="mt-1.5 max-w-xl" value={p.indeterminate ? null : p.percent} aria-label="Search progress" />
    </div>
    <span class="shrink-0 text-xs text-muted-foreground tabular-nums">
      {p.indeterminate ? '' : `${p.percent} % · `}{p.elapsed}
    </span>
  </div>
{/if}
