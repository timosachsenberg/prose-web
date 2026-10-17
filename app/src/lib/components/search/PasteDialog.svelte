<script lang="ts">
  // "Paste from spreadsheet": rows copied from Excel, LibreOffice or a TSV file (tab-separated).
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import { Textarea } from '$lib/components/ui/textarea'
  import { parsePastedDesign } from '$lib/design/paste'
  import { searchForm as form } from '$lib/search/form.svelte'

  let { open = $bindable(false) }: { open?: boolean } = $props()

  let text = $state('')
  let problems = $state<string[]>([])

  function apply() {
    const { rows, notices } = parsePastedDesign(
      text,
      form.files.map((r) => r.file.name),
    )
    if (rows.length === 0) {
      problems = notices
      return
    }
    form.applyUpdates(rows)
    form.notices.push(...notices)
    text = ''
    problems = []
    open = false
  }
</script>

<Dialog.Root bind:open onOpenChange={(o) => !o && (problems = [])}>
  <Dialog.Content class="gap-4 sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>Paste from spreadsheet</Dialog.Title>
      <Dialog.Description>
        Copy the cells in your spreadsheet and paste them here (Ctrl+V). Columns: File, Condition, Replicate, Fraction,
        optionally Tech. replicate. With a header row, the columns can be in any order; without file names, paste one row
        per file in table order.
      </Dialog.Description>
    </Dialog.Header>
    <Textarea
      bind:value={text}
      aria-label="Pasted rows"
      rows={8}
      class="font-mono text-xs"
      placeholder={'File\tCondition\tReplicate\tFraction\nctrl_a_F1.mzML\tcontrol\t1\t1'} />
    {#if problems.length > 0}
      <p class="text-[12.5px] text-destructive" role="alert">{problems.join(' ')}</p>
    {/if}
    <Dialog.Footer>
      <Button variant="outline" size="sm" onclick={() => (open = false)}>Cancel</Button>
      <Button size="sm" disabled={text.trim() === ''} onclick={apply}>Apply to the table</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
