<script lang="ts">
  // The header's Export menu of the open result.
  import { buttonVariants } from '$lib/components/ui/button'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import { saveProjectFile } from '$lib/persist/history.svelte'
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
  let canSpectrum = $state(false)
  let busy = $state(false)
  /** The share of the project file written so far (0–1), while it is written. */
  let progress = $state<number | null>(null)
  let error = $state<string | null>(null)

  function openChange(next: boolean) {
    open = next
    if (next) {
      canIdXML = idXMLAvailable(view.result)
      canSpectrum = view.psm !== null && view.spectrumExporter !== null
    }
  }

  async function guard(action: () => unknown) {
    error = null
    try {
      await action()
    } catch (e) {
      error = String((e as Error)?.message ?? e)
    }
  }

  /** The project file is large for a large search: it is written in slices, with its progress on the button. */
  async function project() {
    busy = true
    progress = 0
    error = null
    try {
      await saveProjectFile(view.result, (fraction) => (progress = fraction))
    } catch (e) {
      error = `Project: ${String((e as Error)?.message ?? e)}`
    } finally {
      busy = false
      progress = null
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
    {#if busy && progress !== null && progress > 0}Saving project {Math.round(progress * 100)} %{:else if busy || view.exporting}Exporting…{:else}Export{/if}<ChevronDown class="size-3.5" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content class="w-auto min-w-52" align="end">
    <DropdownMenu.Item disabled={view.level === null || view.exporting} onSelect={() => guard(() => exportCsv(view))}
      >CSV (current view)</DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => guard(() => exportDesign(view.result))}>Design (design.tsv)</DropdownMenu.Item>
    <DropdownMenu.Item
      disabled={!canSpectrum}
      title={canSpectrum ? undefined : 'Open a PSM whose spectrum is stored'}
      class={explained}
      onSelect={() => guard(() => view.spectrumExporter?.())}>Spectrum (SVG)</DropdownMenu.Item>
    <DropdownMenu.Item disabled={view.exporting} onSelect={project}>Project (.prose)</DropdownMenu.Item>
    <DropdownMenu.Separator />
    {#if canIdXML}
      <DropdownMenu.Item onSelect={idXML}>idXML (merged)</DropdownMenu.Item>
    {:else}
      <DropdownMenu.Item disabled title="Run the search again to export idXML" class={explained}>idXML (merged)</DropdownMenu.Item>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
