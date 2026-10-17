<script lang="ts">
  import { Badge } from '$lib/components/ui/badge'
  import { engineState } from '$lib/engine/app-engine.svelte'
  import { formatHash, type Route, type View } from '$lib/route'
  import { searchProgress } from '$lib/search/session.svelte'
  import { cn } from '$lib/utils'
  import SearchProgress from './search/SearchProgress.svelte'

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

  // "OpenMS 3.7 · 16 threads"; the full version in the title
  const status = $derived.by(() => {
    const info = engineState.info
    if (engineState.status === 'failed') {
      return { text: 'OpenMS could not be loaded', dot: 'bg-destructive', title: engineState.error ?? '' }
    }
    if (engineState.status === 'loading' || !info) return { text: 'Loading OpenMS…', dot: 'bg-zinc-300', title: '' }
    const version = /^\d+\.\d+/.exec(info.version)?.[0] ?? info.version
    const threads = `${info.threads} ${info.threads === 1 ? 'thread' : 'threads'}`
    const isolation = info.isolated ? '' : ' · not cross-origin isolated'
    return { text: `OpenMS ${version} · ${threads}${isolation}`, dot: 'bg-green-700', title: `OpenMS ${info.version}` }
  })
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
  {#if searchProgress.running && route.view !== 'search'}
    <!-- a search runs on while the user is elsewhere: its progress, and the way back to it -->
    <a
      href={formatHash({ view: 'search' })}
      class="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      title="{searchProgress.label} – back to New search"
      aria-label="Search running{searchProgress.indeterminate ? '' : `, ${searchProgress.percent} %`}: back to New search"
      data-testid="topbar-search-progress">
      <SearchProgress compact />
    </a>
  {/if}
  <Badge
    variant="outline"
    class="h-6 gap-1.5 bg-background px-2.5 font-normal text-muted-foreground"
    data-testid="engine-status"
    title={status.title}
    role="status">
    <span class={cn('size-[7px] rounded-full', status.dot)}></span>{status.text}
  </Badge>
</header>
