<script lang="ts">
  import { Badge } from '$lib/components/ui/badge'
  import { engineState } from '$lib/engine/app-engine.svelte'
  import { formatHash, type Route, type View } from '$lib/route'
  import { history } from '$lib/persist/history.svelte'
  import { exportName } from '$lib/results/exports'
  import { resultsViewFor } from '$lib/results/view.svelte'
  import { openResult, searchProgress } from '$lib/search/session.svelte'
  import ExportMenu from './results/ExportMenu.svelte'
  import { cn } from '$lib/utils'
  import SearchProgress from './search/SearchProgress.svelte'
  import { applyUpdate, watchServiceWorker, watchUpdate } from '$lib/sw-client'

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

  // on Results: the open result, and its Export menu
  const result = $derived(
    route.view === 'results' && openResult.current !== null && openResult.current.id === route.id ? openResult.current : null,
  )
  const resultView = $derived(result ? resultsViewFor(result) : null)
  const resultChip = $derived.by(() => {
    if (!result) return ''
    const files = result.design.rows.length
    const finished = new Date(result.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    const s = Math.round(result.outcome.seconds)
    const took = s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`
    return `${exportName(result)} · ${files} ${files === 1 ? 'file' : 'files'} · finished ${finished} · ${took}`
  })

  // what became of the save of the open result (a search of this session; stored ones have no status)
  const saved = $derived.by(() => {
    const save = history.save
    if (!result || !save || save.id !== result.id) return null
    if (save.state === 'saving') return { state: save.state, text: 'Saving to History…', title: 'The search is being written to this browser\'s storage' }
    if (save.state === 'saved') return { state: save.state, text: 'Saved to History', title: 'Open History' }
    return { state: save.state, text: 'Not saved to History', title: save.message }
  })

  // a service worker serves the page: the app works offline (lib/sw-client.ts)
  let offline = $state(false)
  $effect(() => watchServiceWorker((controlled) => (offline = controlled)))
  // a new version is installed and waits: offered as "Reload", never in the middle of a search
  let updateReady = $state(false)
  let updating = $state(false)
  $effect(() => watchUpdate(() => (updateReady = true)))

  // "OpenMS 3.7 · 16 threads · works offline"; the full version in the title
  const status = $derived.by(() => {
    const info = engineState.info
    if (engineState.status === 'failed') {
      return { text: 'OpenMS could not be loaded', dot: 'bg-destructive', title: engineState.error ?? '' }
    }
    if (engineState.status === 'loading' || !info) return { text: 'Loading OpenMS…', dot: 'bg-zinc-300', title: '' }
    const version = /^\d+\.\d+/.exec(info.version)?.[0] ?? info.version
    const threads = `${info.threads} ${info.threads === 1 ? 'thread' : 'threads'}`
    if (!info.isolated) {
      return {
        text: `OpenMS ${version} · ${threads} · not cross-origin isolated`,
        dot: 'bg-amber-500',
        title:
          `OpenMS ${info.version}. The page is not cross-origin isolated, so OpenMS runs on one thread and searches take ` +
          'longer. Reload the page; if this stays, the browser blocks the service worker that isolates the page ' +
          '(e.g. in a private window) – or use the desktop app.',
      }
    }
    const works = offline ? ' · works offline' : ''
    return { text: `OpenMS ${version} · ${threads}${works}`, dot: 'bg-green-700', title: `OpenMS ${info.version}` }
  })
</script>

<!-- One row of 52 px: the result's chip shrinks (and truncates) before anything wraps. On windows of
     900 px or less (max-[901px]: width < 901px) the chip and the save state take a second row. -->
<header
  class="flex min-h-[52px] items-center gap-x-6 gap-y-1.5 border-b bg-background px-5 py-2.5 *:shrink-0 max-[901px]:flex-wrap max-[901px]:gap-x-4">
  <div class="text-[15px] font-semibold tracking-tight whitespace-nowrap">
    ProSE<small class="ml-1.5 text-xs font-normal text-muted-foreground max-[901px]:hidden">OpenMS search engine</small>
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
  {#if result}
    <div
      class="flex min-w-0 flex-1 basis-0 items-center gap-6 shrink! max-[901px]:order-last max-[901px]:basis-full max-[901px]:gap-4">
      <Badge
        variant="outline"
        class="block h-6 max-w-[28rem] min-w-0 shrink truncate bg-background px-2.5 leading-[22px] font-normal text-muted-foreground"
        title={resultChip}
        data-testid="result-chip">{resultChip}</Badge>
      {#if saved}
        <a
          href={formatHash({ view: 'history' })}
          class="shrink-0 text-xs whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          data-testid="history-state"
          data-state={saved.state}
          title={saved.title}>{saved.text}</a>
      {/if}
    </div>
  {/if}
  <!-- the right-hand side -->
  <div class="ml-auto flex items-center gap-x-6 max-[901px]:gap-x-4">
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
    {#if resultView}
      <ExportMenu view={resultView} />
    {/if}
    {#if updateReady}
      <span class="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground" data-testid="update-notice" role="status">
        A new version is ready ·
        <button
          type="button"
          class="font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:text-muted-foreground disabled:no-underline"
          disabled={searchProgress.running || updating}
          title={searchProgress.running ? 'After the search: reloading now would end it' : 'Reload ProSE in its new version'}
          onclick={() => {
            updating = true
            void applyUpdate()
          }}>Reload</button>
      </span>
    {/if}
    <Badge
      variant="outline"
      class="h-6 gap-1.5 bg-background px-2.5 font-normal text-muted-foreground"
      data-testid="engine-status"
      title={status.title}
      role="status">
      <span class={cn('size-[7px] rounded-full', status.dot)}></span>{status.text}
    </Badge>
  </div>
</header>
