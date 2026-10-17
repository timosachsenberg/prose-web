<script lang="ts">
  import { fdrChoices, formatPercent, formatQ, parsePercent, percentNumber } from '$lib/format/fdr'
  import { cn } from '$lib/utils'

  let {
    value = $bindable(0.01),
    max,
    id,
    'aria-label': ariaLabel,
    class: className,
  }: {
    /** the cutoff as a q-value (0.01 is 1 %) */
    value?: number
    /** the largest cutoff allowed (a q-value): longer values are rejected and their chips disabled */
    max?: number
    id?: string
    'aria-label'?: string
    class?: string
  } = $props()

  // what the user is typing, until the field loses focus or a chip is picked
  let draft = $state<string | null>(null)
  let input = $state<HTMLInputElement | null>(null)

  const text = $derived(draft ?? percentNumber(value))
  const typed = $derived(draft === null ? value : parsePercent(draft))
  const tooLarge = (q: number) => max !== undefined && q > max * (1 + 1e-9)
  const invalid = $derived(typed === null || tooLarge(typed))
  const hint = $derived(
    typed === null ? '> 0 – 100 %' : tooLarge(typed) ? `at most ${formatPercent(max!)}` : formatQ(typed),
  )

  function edit(event: Event & { currentTarget: HTMLInputElement }) {
    draft = event.currentTarget.value
    const q = parsePercent(draft)
    if (q !== null && !tooLarge(q)) value = q
  }

  function choose(q: number) {
    draft = null
    value = q
  }
</script>

<div class={cn('grid gap-2', className)}>
  <!-- a click anywhere in the field focuses the input; the keyboard goes to the input itself -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="flex h-9 w-full min-w-0 cursor-text items-center gap-1 rounded-md border border-input bg-transparent px-2.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30"
    aria-invalid={invalid}
    onclick={() => input?.focus()}>
    <input
      bind:this={input}
      {id}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      class="min-w-[1ch] bg-transparent text-[13px] outline-none"
      style:width="{Math.max(text.length, 1) + 0.5}ch"
      inputmode="decimal"
      autocomplete="off"
      spellcheck="false"
      value={text}
      oninput={edit}
      onblur={() => (draft = null)} />
    <span class="text-[13px]">%</span>
    <span class={cn('ml-auto pl-2 text-[13px] whitespace-nowrap tabular-nums', invalid ? 'text-destructive' : 'text-muted-foreground')}
      >{hint}</span>
  </div>
  <div class="flex gap-1.5">
    {#each fdrChoices as q (q)}
      {@const active = value === q}
      <button
        type="button"
        class={cn(
          'h-6 rounded-full border px-2.5 text-xs whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50',
          active ? 'border-foreground text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        aria-pressed={active}
        disabled={tooLarge(q)}
        onclick={() => choose(q)}>{formatPercent(q)}</button
      >
    {/each}
  </div>
</div>
