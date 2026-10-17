<script lang="ts">
  // An editable cell of the design table: always drawn as an input. Empty, it shows the assumed value
  // grey and italic (the placeholder); an entry that is not valid stays, marked, until it is corrected.
  // Enter and the arrow keys move up and down the column, as in a spreadsheet.
  import { untrack } from 'svelte'
  import { positiveInt } from '$lib/design/model'
  import { cn } from '$lib/utils'

  let {
    value,
    kind,
    placeholder = '',
    label,
    column,
    row,
    list,
    onChange,
  }: {
    value: string | number | undefined
    kind: 'text' | 'int'
    /** The assumed value, shown grey and italic while the cell is empty. */
    placeholder?: string
    label: string
    /** For moving between rows: the column name and the row index. */
    column: string
    row: number
    list?: string
    onChange: (value: string | number | undefined) => void
  } = $props()

  // What the user typed, while it differs from what the model holds: during typing, and after it for an
  // entry that is not valid (the model then holds "not entered"). It belongs to the value it was typed
  // for: a change from elsewhere (paste, load) drops it.
  let draft = $state<{ text: string; value: string | number | undefined } | null>(null)
  $effect.pre(() => {
    const current = value
    untrack(() => {
      if (draft !== null && draft.value !== current) draft = null
    })
  })
  const shown = $derived(draft !== null ? draft.text : value === undefined ? '' : String(value))
  const invalid = $derived(kind === 'int' && shown.trim() !== '' && positiveInt(Number(shown.trim())) === undefined)

  function edit(event: Event & { currentTarget: HTMLInputElement }) {
    const text = event.currentTarget.value
    const t = text.trim()
    const next = t === '' ? undefined : kind === 'text' ? text : positiveInt(Number(t))
    draft = { text, value: next }
    onChange(next)
  }

  function move(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    const step = event.key === 'Enter' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    const table = event.currentTarget.closest('table')
    const next = table?.querySelector<HTMLInputElement>(`input[data-column="${column}"][data-row="${row + step}"]`)
    if (next) {
      event.preventDefault()
      next.focus()
      next.select()
    }
  }
</script>

<input
  type="text"
  inputmode={kind === 'int' ? 'numeric' : undefined}
  autocomplete="off"
  spellcheck="false"
  aria-label={label}
  aria-invalid={invalid}
  title={invalid ? 'A whole number of at least 1, or empty' : undefined}
  data-column={column}
  data-row={row}
  {list}
  {placeholder}
  value={shown}
  oninput={edit}
  onkeydown={move}
  onblur={() => {
    if (!invalid) draft = null
  }}
  class={cn(
    'h-7 w-full rounded-[5px] border border-input bg-background px-2 text-[13px] transition-colors outline-none placeholder:text-muted-foreground placeholder:italic hover:border-ring/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
    invalid && 'border-destructive bg-destructive/5 focus-visible:border-destructive focus-visible:ring-destructive/20',
  )} />
