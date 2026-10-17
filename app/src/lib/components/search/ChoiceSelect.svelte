<script lang="ts">
  // A single-choice select of the search form (shadcn Select), labelled through `id`.
  import * as Select from '$lib/components/ui/select'
  import { cn } from '$lib/utils'

  let {
    id,
    value,
    options,
    onChange,
    disabled = false,
    class: className,
    ariaLabel,
  }: {
    id?: string
    value: string
    options: { value: string; label: string }[]
    onChange: (value: string) => void
    disabled?: boolean
    class?: string
    ariaLabel?: string
  } = $props()

  const label = $derived(options.find((o) => o.value === value)?.label ?? value)
</script>

<Select.Root type="single" {value} {disabled} onValueChange={(v) => v !== undefined && onChange(v)}>
  <Select.Trigger {id} size="sm" aria-label={ariaLabel} class={cn('w-full min-w-0 bg-background shadow-none', className)}>
    <span class="truncate">{label}</span>
  </Select.Trigger>
  <Select.Content class="max-h-80">
    {#each options as o (o.value)}
      <Select.Item value={o.value} label={o.label} />
    {/each}
  </Select.Content>
</Select.Root>
