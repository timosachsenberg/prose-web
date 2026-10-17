<script lang="ts">
  // A range of two whole numbers ("2 – 5") in one field, e.g. the precursor charges.
  import * as InputGroup from '$lib/components/ui/input-group'
  import NumberField from './NumberField.svelte'

  let {
    labelId,
    from,
    to,
    fromLabel,
    toLabel,
    min,
    onFrom,
    onTo,
  }: {
    /** The id of the visible label of the field. */
    labelId: string
    from: number | undefined
    to: number | undefined
    fromLabel: string
    toLabel: string
    min?: number
    onFrom: (value: number) => void
    onTo: (value: number) => void
  } = $props()
</script>

<InputGroup.Root class="h-8 bg-background shadow-none" aria-labelledby={labelId}>
  <NumberField value={from} kind="int" {min} inGroup fit ariaLabel={fromLabel} onChange={onFrom} class="flex-none pr-0" />
  <span class="px-1.5" aria-hidden="true">–</span>
  <NumberField value={to} kind="int" {min} inGroup ariaLabel={toLabel} onChange={onTo} class="w-0 min-w-0 flex-1 pl-0" />
</InputGroup.Root>
