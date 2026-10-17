<script lang="ts">
  // A mass tolerance with its unit (ppm or Da), switched by the button at its end.
  import * as InputGroup from '$lib/components/ui/input-group'
  import NumberField from './NumberField.svelte'

  let {
    id,
    label,
    value,
    unit,
    onValue,
    onUnit,
  }: {
    id: string
    label: string
    value: number | undefined
    unit: string
    onValue: (value: number) => void
    onUnit: (unit: string) => void
  } = $props()

  const other = $derived(unit === 'ppm' ? 'Da' : 'ppm')
</script>

<InputGroup.Root class="h-8 bg-background shadow-none">
  <NumberField {id} {value} min={0} inGroup onChange={onValue} />
  <InputGroup.Addon align="inline-end" class="py-0">
    <InputGroup.Button
      size="xs"
      class="text-xs font-normal text-muted-foreground"
      aria-label="{label} unit: {unit}. Switch to {other}"
      title="Switch to {other}"
      onclick={() => onUnit(other)}>{unit}</InputGroup.Button>
  </InputGroup.Addon>
</InputGroup.Root>
