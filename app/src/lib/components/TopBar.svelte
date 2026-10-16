<script lang="ts">
  import { Badge } from '$lib/components/ui/badge'
  import { formatHash, type Route, type View } from '$lib/route'
  import { cn } from '$lib/utils'

  let { route, resultId }: { route: Route; resultId: string | null } = $props()

  const items: { view: View; label: string }[] = [
    { view: 'search', label: 'New search' },
    { view: 'results', label: 'Results' },
    { view: 'history', label: 'History' },
  ]

  // "Results" returns to the result that was open last
  function hrefOf(view: View): string {
    return formatHash(view === 'results' ? { view, id: resultId } : { view })
  }
</script>

<header class="flex h-[52px] items-center gap-6 border-b bg-background px-5">
  <div class="text-[15px] font-semibold tracking-tight">
    ProSE<small class="ml-1.5 text-xs font-normal text-muted-foreground">OpenMS search engine</small>
  </div>
  <nav aria-label="Main" class="flex gap-1">
    {#each items as item (item.view)}
      {@const active = route.view === item.view}
      <a
        href={hrefOf(item.view)}
        aria-current={active ? 'page' : undefined}
        class={cn(
          'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
          active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}>{item.label}</a
      >
    {/each}
  </nav>
  <div class="flex-1"></div>
  <!-- placeholder: the engine arrives with the worker -->
  <Badge variant="outline" class="h-6 gap-1.5 px-2.5 font-normal text-muted-foreground" data-testid="engine-status">
    <span class="size-[7px] rounded-full bg-zinc-300"></span>OpenMS · not loaded
  </Badge>
</header>
