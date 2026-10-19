<script lang="ts">
  // The header's Export menu of the open result.
  import { buttonVariants } from '$lib/components/ui/button'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import { exportCsv, exportDesign, exportIdXML, idXMLAvailable } from '$lib/results/exports'
  import type { ResultsView } from '$lib/results/view.svelte'
  import { cn } from '$lib/utils'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'

  let { view }: { view: ResultsView } = $props()

  // a disabled item keeps the pointer, so that its title says why
  const explained = 'data-disabled:pointer-events-auto data-disabled:cursor-not-allowed'

  let open = $state(false)
  // the engine's state is no rune: read it each time the menu opens
  let canIdXML = $state(false)
  let busy = $state(false)
  let error = $state<string | null>(null)

  function openChange(next: boolean) {
    open = next
    if (next) canIdXML = idXMLAvailable(view.result)
  }

  async function guard(action: () => unknown) {
    error = null
    try {
      await action()
    } catch (e) {
      error = String((e as Error)?.message ?? e)
    }
  }

  async function idXML() {
    busy = true
    error = null
    try {
      await exportIdXML(view.result)
    } catch (e) {
      error = `idXML: ${String((e as Error)?.message ?? e)}`
    } finally {
      busy = false
    }
  }
</script>

{#if error}
  <span class="max-w-72 truncate text-xs text-destructive" role="alert" title={error}>{error}</span>
{/if}
<DropdownMenu.Root {open} onOpenChange={openChange}>
  <DropdownMenu.Trigger class={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 gap-1 px-2.5 text-xs')} disabled={busy}>
    {busy || view.exporting ? 'Exporting…' : 'Export'}<ChevronDown class="size-3.5" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content class="w-auto min-w-52" align="end">
    <DropdownMenu.Item disabled={view.level === null || view.exporting} onSelect={() => guard(() => exportCsv(view))}
      >CSV (current view)</DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => guard(() => exportDesign(view.result))}>Design (design.tsv)</DropdownMenu.Item>
    <!-- TODO(C11): the project file comes with History -->
    <DropdownMenu.Item disabled title="Available with History (coming next)" class={explained}>Project (.prose)</DropdownMenu.Item>
    <DropdownMenu.Separator />
    {#if canIdXML}
      <DropdownMenu.Item onSelect={idXML}>idXML (merged)</DropdownMenu.Item>
    {:else}
      <DropdownMenu.Item disabled title="Run the search again to export idXML" class={explained}>idXML (merged)</DropdownMenu.Item>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
