<script lang="ts">
  // Fixed or variable modifications: badges (the residues of one modification together, "Phospho (STY)")
  // and a searchable list of ProSE's modification names to add from. Typing "Phospho (STY)" offers the
  // three single-residue modifications at once.
  import PlusIcon from '@lucide/svelte/icons/plus'
  import XIcon from '@lucide/svelte/icons/x'
  import * as Command from '$lib/components/ui/command'
  import * as Popover from '$lib/components/ui/popover'
  import { expandModification, groupModifications } from '$lib/settings/modifications'

  let {
    labelId,
    kind,
    value,
    options,
    onChange,
  }: {
    labelId: string
    /** "fixed" or "variable", for the labels of the buttons. */
    kind: string
    value: string[]
    /** ProSE's modification names (`validStrings`); undefined until OpenMS is loaded. */
    options: string[] | undefined
    onChange: (value: string[]) => void
  } = $props()

  const LIMIT = 60

  let open = $state(false)
  let query = $state('')

  const groups = $derived(groupModifications(value))
  const known = $derived(options ? new Map(options.map((o) => [o.toLowerCase(), o])) : null)

  /** The typed name expanded to ProSE's names, if they all exist (or anything without the list). */
  const expansion = $derived.by(() => {
    if (query.trim() === '') return null
    // the residues in capitals: "phospho (sty)" is "phospho (STY)"
    const specs = expandModification(query.replace(/\(([A-Za-z]+)\)\s*$/, (_, r: string) => `(${r.toUpperCase()})`))
    if (!known) return specs
    const found = specs.map((s) => known.get(s.toLowerCase()))
    if (found.some((s) => s === undefined) || specs.length < 2) return null
    return found as string[]
  })

  const matches = $derived.by(() => {
    if (!options) return []
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    const q = query.trim().toLowerCase()
    const hits = options.filter((o) => {
      const l = o.toLowerCase()
      return !value.includes(o) && tokens.every((t) => l.includes(t))
    })
    if (q !== '') hits.sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)))
    return hits
  })

  function add(specs: string[]) {
    onChange([...value, ...specs.filter((s) => !value.includes(s))])
    query = ''
    open = false
  }

  function remove(specs: string[]) {
    onChange(value.filter((s) => !specs.includes(s)))
  }
</script>

<div
  role="group"
  aria-labelledby={labelId}
  class="flex min-h-8 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-1.5 py-1">
  {#each groups as g (g.label)}
    <span class="inline-flex h-5 items-center gap-0.5 rounded-[5px] border bg-muted pr-0.5 pl-1.5 text-[11.5px] font-medium">
      {g.label}
      <button
        type="button"
        class="rounded-sm p-px text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label="Remove {kind} modification {g.label}"
        onclick={() => remove(g.specs)}><XIcon class="size-3" /></button>
    </span>
  {/each}
  <Popover.Root bind:open onOpenChange={(o) => !o && (query = '')}>
    <Popover.Trigger
      class="inline-flex h-5 items-center gap-0.5 rounded-[5px] px-1 text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      aria-label="Add a {kind} modification">
      <PlusIcon class="size-3" />{groups.length === 0 ? 'Add' : ''}
    </Popover.Trigger>
    <Popover.Content class="w-80 p-0" align="start">
      <Command.Root shouldFilter={false}>
        <Command.Input bind:value={query} placeholder="Oxidation (M), Phospho (STY), TMT6plex…" aria-label="Find a modification" />
        <Command.List>
          {#if expansion}
            <Command.Group heading="Several residues">
              <Command.Item value={'expand:' + expansion.join('|')} onSelect={() => add(expansion)}>
                Add {expansion.join(', ')}
              </Command.Item>
            </Command.Group>
          {/if}
          {#if matches.length === 0 && !expansion}
            <Command.Empty>{options ? 'No modification of that name.' : 'Loading OpenMS…'}</Command.Empty>
          {/if}
          {#if matches.length > 0}
            <Command.Group heading={query.trim() === '' ? 'Unimod names' : undefined}>
              {#each matches.slice(0, LIMIT) as m (m)}
                <Command.Item value={m} onSelect={() => add([m])}>{m}</Command.Item>
              {/each}
            </Command.Group>
            {#if matches.length > LIMIT}
              <p class="px-2 py-1.5 text-xs text-muted-foreground">{matches.length - LIMIT} more: type to narrow down.</p>
            {/if}
          {/if}
        </Command.List>
      </Command.Root>
    </Popover.Content>
  </Popover.Root>
</div>
