<script lang="ts">
  // The protein database: the FASTA file, decoys (ProSE's `decoys`) and the cRAP contaminants.
  import * as Card from '$lib/components/ui/card'
  import { Label } from '$lib/components/ui/label'
  import { CRAP_PROTEINS, searchForm as form } from '$lib/search/form.svelte'
  import ChoiceSelect from './ChoiceSelect.svelte'

  let input = $state<HTMLInputElement | null>(null)

  const decoyLabels: Record<string, string> = {
    auto: 'Use the database’s, else generate',
    generate: 'Generate',
    ignore: 'None (no FDR)',
  }
  const decoyOptions = $derived(
    (form.entry('decoys')?.validStrings ?? ['auto', 'generate', 'ignore']).map((v) => ({
      value: v,
      label: decoyLabels[v] ?? v,
    })),
  )

  const proteins = $derived(form.database?.proteins ?? null)
</script>

<Card.Root size="sm" class="gap-3 rounded-lg shadow-none">
  <Card.Header class="flex items-center">
    <Card.Title class="text-[14px] font-semibold">Protein database</Card.Title>
  </Card.Header>
  <Card.Content class="grid gap-x-4 gap-y-3.5 md:grid-cols-[2fr_1fr_1fr]">
    <div class="grid min-w-0 gap-1">
      <Label for="fasta-file" class="text-xs">FASTA</Label>
      <button
        id="fasta-file"
        type="button"
        aria-describedby="fasta-chosen"
        class="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left transition-[color,box-shadow] outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        onclick={() => input?.click()}>
        {#if form.database}
          <span id="fasta-chosen" class="min-w-0 truncate font-mono text-[12.5px]">{form.database.file.name}</span>
          <span class="ml-auto shrink-0 text-xs text-muted-foreground" data-testid="fasta-proteins">
            {proteins === null ? 'counting…' : `${proteins.toLocaleString('en-US')} proteins`}
          </span>
        {:else}
          <span id="fasta-chosen" class="text-muted-foreground">Choose a FASTA file…</span>
        {/if}
      </button>
      <input
        bind:this={input}
        type="file"
        accept=".fasta,.fas,.fa,.faa"
        hidden
        onchange={(e) => {
          const file = e.currentTarget.files?.[0]
          if (file) form.setDatabase(file)
          e.currentTarget.value = ''
        }} />
    </div>
    <div class="grid min-w-0 gap-1">
      <Label for="decoys" class="text-xs">Decoys</Label>
      <ChoiceSelect
        id="decoys"
        value={String(form.value('decoys') ?? 'auto')}
        options={decoyOptions}
        onChange={(v) => form.setParam('decoys', v)} />
    </div>
    <div class="grid min-w-0 gap-1">
      <Label for="contaminants" class="text-xs">Contaminants</Label>
      <ChoiceSelect
        id="contaminants"
        value={form.contaminants ? 'crap' : 'none'}
        options={[
          { value: 'crap', label: `Add cRAP (${CRAP_PROTEINS})` },
          { value: 'none', label: 'None' },
        ]}
        onChange={(v) => (form.contaminants = v === 'crap')} />
    </div>
  </Card.Content>
</Card.Root>
