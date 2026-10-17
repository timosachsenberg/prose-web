<script lang="ts">
  // An editable cell of the design table. Empty, it shows the assumed value greyed (the placeholder);
  // Enter and the arrow keys move up and down the column, as in a spreadsheet.
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
    /** The assumed value, shown greyed while the cell is empty. */
    placeholder?: string
    label: string
    /** For moving between rows: the column name and the row index. */
    column: string
    row: number
    list?: string
    onChange: (value: string | number | undefined) => void
  } = $props()

  // what the user is typing, until the cell loses focus
  let draft = $state<string | null>(null)
  const text = $derived(draft ?? (value === undefined ? '' : String(value)))
  const invalid = $derived(kind === 'int' && text.trim() !== '' && positiveInt(Number(text.trim())) === undefined)

  function edit(event: Event & { currentTarget: HTMLInputElement }) {
    draft = event.currentTarget.value
    const t = draft.trim()
    if (kind === 'text') onChange(t === '' ? undefined : draft)
    else onChange(t === '' ? undefined : positiveInt(Number(t)))
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
  value={text}
  oninput={edit}
  onkeydown={move}
  onblur={() => (draft = null)}
  class={cn(
    'h-7 w-full rounded-[5px] border px-2 text-[13px] transition-colors outline-none placeholder:text-zinc-400 placeholder:italic focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
    text === '' ? 'border-transparent bg-transparent hover:border-input' : 'border-input bg-background',
    invalid && 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20',
  )} />
