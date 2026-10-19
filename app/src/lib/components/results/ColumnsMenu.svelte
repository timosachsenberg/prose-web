<script lang="ts">
  // The column settings of a level: the optional columns, technical replicates, and how peptides
  // show their modifications (marked residues or ProForma; a setting that persists).
  import { buttonVariants } from '$lib/components/ui/button'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import { displaySettings, type ModMode } from '$lib/format/settings.svelte'
  import { samplesColumn } from '$lib/results/table-columns'
  import type { LevelState, ResultsView } from '$lib/results/view.svelte'
  import { cn } from '$lib/utils'

  let { view, level }: { view: ResultsView; level: LevelState } = $props()

  const optional = $derived(level.specs.filter((s) => s.optional !== undefined))
  const hasSamples = $derived(level.specs.some((s) => s.id.startsWith('sample:')))
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 px-2.5 text-xs')}>Columns</DropdownMenu.Trigger>
  <DropdownMenu.Content class="w-auto min-w-60" align="end">
    <DropdownMenu.Group>
      <DropdownMenu.Label class="text-xs text-muted-foreground">Columns</DropdownMenu.Label>
      {#if hasSamples}
        <DropdownMenu.CheckboxItem
          checked={!level.hidden.includes(samplesColumn)}
          onCheckedChange={(on) => level.toggleColumn(samplesColumn, on)}>Counts per sample</DropdownMenu.CheckboxItem>
      {/if}
      {#each optional as s (s.id)}
        <DropdownMenu.CheckboxItem checked={!level.hidden.includes(s.id)} onCheckedChange={(on) => level.toggleColumn(s.id, on)}
          >{s.header}</DropdownMenu.CheckboxItem>
      {/each}
    </DropdownMenu.Group>
    {#if hasSamples && view.hasTechReplicates}
      <DropdownMenu.Separator />
      <DropdownMenu.CheckboxItem checked={view.showTechReplicates} onCheckedChange={(on) => view.setShowTechReplicates(on)}
        >Show technical replicates separately</DropdownMenu.CheckboxItem>
    {/if}
    <DropdownMenu.Separator />
    <DropdownMenu.Group>
      <DropdownMenu.Label class="text-xs text-muted-foreground">Modifications</DropdownMenu.Label>
      <DropdownMenu.RadioGroup
        value={displaySettings.modMode}
        onValueChange={(v) => (displaySettings.modMode = v as ModMode)}>
        <DropdownMenu.RadioItem value="marked">Marked residues</DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="proforma">ProForma</DropdownMenu.RadioItem>
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Group>
  </DropdownMenu.Content>
</DropdownMenu.Root>
