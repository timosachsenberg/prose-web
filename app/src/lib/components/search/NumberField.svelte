<script lang="ts">
  // A number of the search settings. What the user types stays until the field loses focus; only
  // valid numbers (whole for `int`, within min and max) reach `onChange`.
  import { Input } from '$lib/components/ui/input'
  import * as InputGroup from '$lib/components/ui/input-group'
  import { cn } from '$lib/utils'

  let {
    id,
    value,
    kind = 'double',
    min,
    max,
    onChange,
    ariaLabel,
    inGroup = false,
    fit = false,
    class: className,
  }: {
    id?: string
    value: number | undefined
    kind?: 'int' | 'double'
    min?: number
    max?: number
    onChange: (value: number) => void
    ariaLabel?: string
    /** Inside an InputGroup (with an addon), without a border of its own. */
    inGroup?: boolean
    /** As wide as its text (the first number of a range). */
    fit?: boolean
    class?: string
  } = $props()

  let draft = $state<string | null>(null)
  const text = $derived(draft ?? (value === undefined || !Number.isFinite(value) ? '' : String(value)))

  function parse(t: string): number | null {
    const s = t.trim().replace(',', '.')
    if (s === '') return null
    const n = Number(s)
    if (!Number.isFinite(n) || (kind === 'int' && !Number.isInteger(n))) return null
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) return null
    return n
  }

  const invalid = $derived(draft !== null && parse(draft) === null)
  const range = $derived(
    [min !== undefined ? `at least ${min}` : '', max !== undefined ? `at most ${max}` : ''].filter(Boolean).join(', '),
  )
  const title = $derived(invalid ? `${kind === 'int' ? 'A whole number' : 'A number'}${range ? `, ${range}` : ''}` : undefined)

  function edit(event: Event & { currentTarget: HTMLInputElement }) {
    draft = event.currentTarget.value
    const n = parse(draft)
    if (n !== null) onChange(n)
  }
</script>

{#if inGroup}
  <InputGroup.Input
    {id}
    style={fit ? `width: calc(${Math.max(text.length, 1)}ch + 0.75rem)` : undefined}
    value={text}
    inputmode={kind === 'int' ? 'numeric' : 'decimal'}
    autocomplete="off"
    aria-label={ariaLabel}
    aria-invalid={invalid}
    {title}
    oninput={edit}
    onblur={() => (draft = null)}
    class={cn('h-full px-2.5 text-[13px]', className)} />
{:else}
  <Input
    {id}
    value={text}
    inputmode={kind === 'int' ? 'numeric' : 'decimal'}
    autocomplete="off"
    aria-label={ariaLabel}
    aria-invalid={invalid}
    {title}
    oninput={edit}
    onblur={() => (draft = null)}
    class={cn('h-8 bg-background text-[13px] shadow-none md:text-[13px]', className)} />
{/if}
