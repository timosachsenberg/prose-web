<script lang="ts">
  // The one filter row of a level: text, the q-value cutoff (tightening the search's only), and on
  // proteins the minimum peptides and "found in"; contaminants and decoys as chips; "n of total".
  import FdrInput from '$lib/components/FdrInput.svelte'
  import ChoiceSelect from '$lib/components/search/ChoiceSelect.svelte'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import * as Popover from '$lib/components/ui/popover'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import { formatPercent, formatQ } from '$lib/format/fdr'
  import { formatCount, parseAccession } from '$lib/results/display'
  import type { LevelState, ResultsView } from '$lib/results/view.svelte'
  import { cn } from '$lib/utils'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import SearchIcon from '@lucide/svelte/icons/search'
  import XIcon from '@lucide/svelte/icons/x'

  let { view, level, proteinFdrApplied }: { view: ResultsView; level: LevelState; proteinFdrApplied: boolean } = $props()

  const names = {
    proteins: { filter: 'Filter proteins', placeholder: 'Accession, gene, name, peptide…', q: 'Protein FDR' },
    peptides: { filter: 'Filter peptides', placeholder: 'Sequence, modification, accession…', q: 'Best PSM q-value' },
    psms: { filter: 'Filter PSMs', placeholder: 'Sequence, modification, accession…', q: 'PSM FDR' },
  } as const
  const name = $derived(names[level.level])
  const cutoff = $derived(level.level === 'proteins' ? view.result.proteinFdr : view.result.psmFdr)
  const qId = $derived(`q-filter-${level.level}`)

  /** The peptide (ProForma) that the PSM table is restricted to ("All n in the PSM table"). */
  const peptide = $derived.by(() => {
    const k = level.filters.peptideFilter
    return k === undefined || level.level !== 'psms' ? null : (view.model.tables.peptides.proforma[k] ?? null)
  })

  /** The protein the table is restricted to ("Open in PSM table"), as its accession shows in the tables. */
  const protein = $derived.by(() => {
    const p = level.filters.proteinFilter
    if (p === undefined || level.level === 'proteins') return null
    const accession = view.model.tables.proteins.accession[p]
    return accession === undefined ? null : { id: parseAccession(accession).id, accession }
  })

  // typing filters after a short pause, so that 150,000 PSMs are not filtered on every key
  // the bar is made anew for each level (Results keys it), so the first value is the one
  // svelte-ignore state_referenced_locally
  let draft = $state(level.filters.text)
  let timer: ReturnType<typeof setTimeout> | undefined
  function type(event: Event & { currentTarget: HTMLInputElement }) {
    draft = event.currentTarget.value
    clearTimeout(timer)
    timer = setTimeout(() => (level.filters.text = draft), 150)
  }
  function clearText() {
    clearTimeout(timer)
    draft = ''
    level.filters.text = ''
  }

  const peptideChoices = [
    { value: '0', label: 'Any number of peptides' },
    { value: '2', label: '≥ 2 peptides' },
    { value: '3', label: '≥ 3 peptides' },
    { value: '5', label: '≥ 5 peptides' },
  ]
  /** The most biological samples of a condition: "found in ≥ n" offers 2 … that. */
  const maxReplicates = $derived(Math.max(0, ...view.model.conditionColumns.map((c) => c.samples.length)))
  const foundChoices = $derived([
    { value: '0', label: 'Found in any sample' },
    ...Array.from({ length: Math.max(0, maxReplicates - 1) }, (_, i) => ({
      value: String(i + 2),
      label: `Found in ≥ ${i + 2} replicates of a condition`,
    })),
  ])

  const chip =
    'inline-flex h-7 items-center gap-1.5 rounded-full border bg-background pr-2 pl-3 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
  const selectLike =
    'inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13px] whitespace-nowrap hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'
</script>

<div class="flex flex-wrap items-center gap-2" data-testid="filter-bar">
  <label class="relative flex h-8 max-w-80 min-w-[18.5rem] grow basis-[18.5rem] items-center">
    <span class="sr-only">{name.filter}</span>
    <SearchIcon class="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
    <input
      type="search"
      class="h-8 w-full rounded-md border bg-background pr-7 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      placeholder={name.placeholder}
      aria-label={name.filter}
      autocomplete="off"
      spellcheck="false"
      value={draft}
      oninput={type}
      onkeydown={(e) => e.key === 'Escape' && draft && (e.preventDefault(), clearText())} />
  </label>

  {#if level.level === 'proteins' && !proteinFdrApplied}
    <!-- aria-disabled, not disabled: it stays focusable, so that the tooltip says why -->
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button {...props} type="button" class={cn(selectLike, 'cursor-not-allowed text-muted-foreground opacity-60')} aria-disabled="true"
            >Protein FDR: not available</button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content class="max-w-xs" role="tooltip"
        >This search applied no protein FDR (the proteins have no q-values), so proteins cannot be filtered by it.</Tooltip.Content>
    </Tooltip.Root>
  {:else}
    <Popover.Root>
      <Popover.Trigger class={selectLike}>
        {name.q} ≤ {formatPercent(level.filters.maxQ)}
        <span class="text-muted-foreground">({formatQ(level.filters.maxQ)})</span>
        <ChevronDown class="size-3.5 text-muted-foreground" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Content class="w-72" align="start">
        <div class="grid gap-2">
          <label for={qId} class="text-xs font-medium">{name.q}</label>
          <FdrInput id={qId} bind:value={level.filters.maxQ} max={cutoff} />
          <p class="text-xs text-muted-foreground">
            The search's cutoff is {formatPercent(cutoff)} ({formatQ(cutoff)}). Tighten it here; a looser one needs a new
            search.
          </p>
        </div>
      </Popover.Content>
    </Popover.Root>
  {/if}

  {#if level.level === 'proteins'}
    <ChoiceSelect
      class="w-auto"
      ariaLabel="Minimum peptides"
      value={String(level.filters.minPeptides)}
      options={peptideChoices}
      onChange={(v) => (level.filters.minPeptides = Number(v))} />
    {#if maxReplicates >= 2}
      <ChoiceSelect
        class="w-auto"
        ariaLabel="Found in replicates of a condition"
        value={String(level.filters.minReplicatesInCondition)}
        options={foundChoices}
        onChange={(v) => (level.filters.minReplicatesInCondition = Number(v))} />
    {/if}
  {/if}

  {#if protein}
    <button type="button" class={chip} title={protein.accession} onclick={() => (level.filters.proteinFilter = undefined)}>
      Protein: {protein.id}<XIcon class="size-3" aria-hidden="true" /><span class="sr-only">(remove the filter)</span>
    </button>
  {/if}
  {#if peptide}
    <button type="button" class={chip} title={peptide} onclick={() => (level.filters.peptideFilter = undefined)}>
      <span class="max-w-[16rem] truncate">Peptide: {peptide}</span><XIcon class="size-3 shrink-0" aria-hidden="true" /><span class="sr-only">(remove the filter)</span>
    </button>
  {/if}
  {#if level.filters.hideContaminants}
    <button type="button" class={chip} onclick={() => (level.filters.hideContaminants = false)}>
      Contaminants hidden<XIcon class="size-3" aria-hidden="true" /><span class="sr-only">(show them)</span>
    </button>
  {/if}
  {#if level.filters.showDecoys}
    <button type="button" class={chip} onclick={() => (level.filters.showDecoys = false)}>
      Decoys shown<XIcon class="size-3" aria-hidden="true" /><span class="sr-only">(hide them)</span>
    </button>
  {/if}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none aria-expanded:bg-muted">
      + Filter
    </DropdownMenu.Trigger>
    <DropdownMenu.Content class="w-auto min-w-48">
      <DropdownMenu.CheckboxItem bind:checked={level.filters.hideContaminants}>Hide contaminants</DropdownMenu.CheckboxItem>
      <DropdownMenu.CheckboxItem bind:checked={level.filters.showDecoys}>Show decoys</DropdownMenu.CheckboxItem>
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  <span class="ml-auto text-xs text-muted-foreground tabular-nums" data-testid="row-count" aria-live="polite"
    >{formatCount(level.rows.length)} of {formatCount(level.total)}</span>
</div>
