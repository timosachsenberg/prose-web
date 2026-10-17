<script lang="ts">
  // One of ProSE's parameters in the "All parameters" dialog, its control chosen by its type: a switch,
  // a select of the allowed values, a number, text, a list (one per line, or checkboxes of the allowed
  // values, or the modification picker), or the FDR field for the FDR cutoffs.
  import FdrInput from '$lib/components/FdrInput.svelte'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import { Input } from '$lib/components/ui/input'
  import { Switch } from '$lib/components/ui/switch'
  import { Textarea } from '$lib/components/ui/textarea'
  import type { ParamEntry } from '$lib/engine/protocol'
  import ChoiceSelect from './ChoiceSelect.svelte'
  import ModificationsField from './ModificationsField.svelte'
  import NumberField from './NumberField.svelte'

  let {
    entry,
    id,
    labelId,
    value,
    onChange,
  }: {
    entry: ParamEntry
    id: string
    labelId: string
    value: unknown
    onChange: (value: unknown) => void
  } = $props()

  const FDR = ['FDR:PSM', 'FDR:protein']
  const list = $derived(Array.isArray(value) ? (value as unknown[]) : [])
  const lines = $derived(list.map(String).join('\n'))

  function fromLines(text: string) {
    const items = text.split('\n').map((s) => s.trim()).filter(Boolean)
    if (entry.type === 'string[]') onChange(items)
    else {
      const numbers = items.map((s) => Number(s.replace(',', '.')))
      if (numbers.every(Number.isFinite)) onChange(numbers)
    }
  }

  function toggle(option: string, on: boolean) {
    const current = list.map(String)
    onChange(on ? [...current, option] : current.filter((s) => s !== option))
  }
</script>

{#if FDR.includes(entry.name)}
  <!-- a q-value cutoff: always as a percentage with the q-value beside it -->
  <FdrInput
    {id}
    class="[&>div:first-child]:h-8 [&>div:first-child]:bg-background [&>div:first-child]:shadow-none"
    bind:value={() => Number(value), (v) => onChange(v)} />
{:else if entry.type === 'bool'}
  <Switch {id} aria-labelledby={labelId} checked={value === true} onCheckedChange={(c) => onChange(c)} />
{:else if entry.type === 'string' && entry.validStrings}
  <ChoiceSelect
    {id}
    value={String(value)}
    options={entry.validStrings.map((v) => ({ value: v, label: v }))}
    onChange={(v) => onChange(v)} />
{:else if entry.type === 'int' || entry.type === 'double'}
  <NumberField
    {id}
    kind={entry.type}
    min={entry.min}
    max={entry.max}
    value={Number(value)}
    onChange={(v) => onChange(v)} />
{:else if entry.type === 'string[]' && entry.validStrings && entry.validStrings.length > 40}
  <ModificationsField
    {labelId}
    kind={entry.name.split(':').pop() ?? ''}
    value={list.map(String)}
    options={entry.validStrings}
    onChange={(v) => onChange(v)} />
{:else if entry.type === 'string[]' && entry.validStrings}
  <div class="flex flex-wrap gap-x-4 gap-y-1.5" role="group" aria-labelledby={labelId}>
    {#each entry.validStrings as option (option)}
      <label class="inline-flex items-center gap-1.5 text-xs">
        <Checkbox checked={list.includes(option)} onCheckedChange={(c) => toggle(option, c === true)} />
        <span class="font-mono">{option}</span>
      </label>
    {/each}
  </div>
{:else if entry.type.endsWith('[]')}
  <Textarea
    {id}
    rows={Math.min(4, Math.max(2, list.length))}
    class="min-h-0 bg-background font-mono text-xs shadow-none"
    placeholder="one per line"
    value={lines}
    onchange={(e) => fromLines(e.currentTarget.value)} />
{:else}
  <Input
    {id}
    class="h-8 bg-background text-[13px] shadow-none md:text-[13px]"
    autocomplete="off"
    spellcheck="false"
    value={value === null || value === undefined ? '' : String(value)}
    oninput={(e) => onChange(e.currentTarget.value)} />
{/if}
