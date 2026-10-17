<script lang="ts">
  // The Spectra card: the mzML files and, from two files on, the experimental design (File ·
  // Condition · Replicate · Fraction; Advanced: Tech. replicate, Fraction group, Sample). Assumed values
  // are greyed; notices go below the table, the summary above it.
  import XIcon from '@lucide/svelte/icons/x'
  import { tick } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Label } from '$lib/components/ui/label'
  import { Switch } from '$lib/components/ui/switch'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import { parseDesignTsv, writeDesignTsv } from '$lib/design/design-tsv'
  import type { Notice as DesignNotice } from '$lib/design/model'
  import { applyDesign } from '$lib/design/paste'
  import { parseSdrf } from '$lib/design/sdrf'
  import { download } from '$lib/download'
  import { formatBytes } from '$lib/search/files'
  import { searchForm as form } from '$lib/search/form.svelte'
  import DesignCell from './DesignCell.svelte'
  import Notice from './Notice.svelte'
  import PasteDialog from './PasteDialog.svelte'

  let addInput = $state<HTMLInputElement | null>(null)
  let designInput = $state<HTMLInputElement | null>(null)
  let pasteOpen = $state(false)
  let saveError = $state<string | null>(null)

  const design = $derived(form.design)
  const multi = $derived(form.files.length >= 2)
  const duplicate = $derived(design.notices.find((n) => n.kind === 'duplicateFile') ?? null)

  function addFrom(input: HTMLInputElement) {
    if (input.files) form.addFiles([...input.files])
    input.value = ''
  }

  /** A design.tsv or SDRF for the files of the table (matched by name). */
  async function loadDesign(input: HTMLInputElement) {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const text = await file.text()
    const header = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0].toLowerCase()
    const sdrf = header.includes('comment[data file]') || header.includes('source name')
    const parsed = sdrf ? parseSdrf(text) : parseDesignTsv(text)
    const applied = applyDesign(
      parsed.inputs,
      form.files.map((r) => r.file.name),
    )
    form.applyUpdates(applied.rows)
    const messages = [...parsed.notices.map((n) => n.message), ...applied.notices]
    form.notices.push(...messages.map((m) => `${file.name}: ${m}`))
  }

  function saveDesign() {
    saveError = null
    try {
      download('design.tsv', writeDesignTsv(design), 'text/tab-separated-values')
    } catch (e) {
      saveError = String((e as Error)?.message ?? e)
    }
  }

  /** "Change" of a technical-replicate notice: the replicate of the last file concerned, in the Advanced view. */
  async function change(notice: DesignNotice) {
    form.advanced = true
    const row = form.files.findIndex((r) => r.id === notice.rows[notice.rows.length - 1])
    await tick()
    const input = document.querySelector<HTMLInputElement>(`input[data-column="replicate"][data-row="${row}"]`)
    input?.focus()
    input?.select()
  }

  const headerButton = 'h-7 px-2.5 text-xs'
</script>

<Card.Root size="sm" class="gap-3 rounded-lg shadow-none">
  <Card.Header class="flex flex-wrap items-center gap-x-2.5 gap-y-2">
    <Card.Title class="text-[14px] font-semibold">Spectra</Card.Title>
    <span class="text-muted-foreground">{form.filesLine}</span>
    <div class="flex-1"></div>
    <div class="flex flex-wrap items-center gap-2">
      {#if multi}
        <Button variant="ghost" size="sm" class={headerButton + ' text-muted-foreground'} onclick={() => (pasteOpen = true)}
          >Paste from spreadsheet</Button>
        <Button variant="outline" size="sm" class={headerButton} onclick={() => designInput?.click()}
          >Load design (SDRF, design.tsv)</Button>
        {#if duplicate}
          <!-- aria-disabled, not disabled: the button stays focusable, so that its tooltip says why -->
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="outline"
                  size="sm"
                  class={headerButton + ' cursor-not-allowed opacity-50 hover:bg-background'}
                  aria-disabled="true"
                  onclick={(e: MouseEvent) => e.preventDefault()}>Save design.tsv</Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content class="max-w-sm" role="tooltip">{duplicate.message}</Tooltip.Content>
          </Tooltip.Root>
        {:else}
          <Button variant="outline" size="sm" class={headerButton} onclick={saveDesign}>Save design.tsv</Button>
        {/if}
      {/if}
      <Button variant="outline" size="sm" class={headerButton} onclick={() => addInput?.click()}>Add files</Button>
    </div>
    <input bind:this={addInput} type="file" accept=".mzML,.mzml" multiple hidden onchange={(e) => addFrom(e.currentTarget)} />
    <input bind:this={designInput} type="file" accept=".tsv,.txt" hidden onchange={(e) => loadDesign(e.currentTarget)} />
  </Card.Header>

  <Card.Content class="flex flex-col gap-2.5">
    {#if multi}
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="inline-flex h-5 items-center rounded-[5px] border bg-muted px-1.5 text-[11.5px] font-medium [font-feature-settings:'case']"
          data-testid="design-summary">{design.summary}</span>
        <span class="text-xs text-muted-foreground">
          Empty fields: unfractionated, replicates numbered in file order. Greyed values are assumed.
        </span>
        <div class="flex-1"></div>
        <div class="flex items-center gap-2">
          <Switch id="design-advanced" size="sm" bind:checked={form.advanced} />
          <Label for="design-advanced" class="text-xs font-normal text-muted-foreground">Advanced</Label>
        </div>
      </div>
    {/if}

    <div class="relative w-full overflow-x-auto">
      <table class="w-full border-collapse tabular-nums">
        <thead>
          <tr class="border-b text-left text-xs text-muted-foreground">
            <th scope="col" class="px-2.5 py-2 font-medium">File</th>
            {#if multi}
              <th scope="col" class="w-[150px] px-2.5 py-2 font-medium">Condition</th>
              <th scope="col" class="w-[110px] px-2.5 py-2 font-medium">Replicate</th>
              <th scope="col" class="w-[110px] px-2.5 py-2 font-medium">Fraction</th>
              {#if form.advanced}
                <th scope="col" class="w-[110px] px-2.5 py-2 font-medium">Tech. replicate</th>
                <th scope="col" class="px-2.5 py-2 text-right font-medium" title="OpenMS Fraction_Group: the files of one measurement of one sample"
                  >Fraction group</th>
                <th scope="col" class="px-2.5 py-2 font-medium" title="Condition + Replicate">Sample</th>
              {/if}
            {/if}
            <th scope="col" class="px-2.5 py-2 text-right font-medium">Spectra</th>
            <th scope="col" class="px-2.5 py-2 text-right font-medium">Size</th>
            <th scope="col" class="w-8 px-1 py-2"><span class="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {#each form.files as file, i (file.id)}
            {@const resolved = design.rows[i]}
            {@const name = file.file.name}
            <tr class="border-b last:border-b-0">
              <th scope="row" class="max-w-[360px] truncate px-2.5 py-1.5 text-left font-mono text-[12.5px] font-normal" title={name}
                >{name}</th>
              {#if multi && resolved}
                <td class="px-2.5 py-1.5">
                  <DesignCell
                    kind="text"
                    column="condition"
                    row={i}
                    label="Condition of {name}"
                    placeholder="–"
                    list="design-conditions"
                    value={file.condition}
                    onChange={(v) => form.setField(file.id, 'condition', v as string | undefined)} />
                </td>
                <td class="px-2.5 py-1.5">
                  <DesignCell
                    kind="int"
                    column="replicate"
                    row={i}
                    label="Replicate of {name}"
                    placeholder={resolved.assumed.replicate ? String(resolved.replicate) : ''}
                    value={file.replicate}
                    onChange={(v) => form.setField(file.id, 'replicate', v as number | undefined)} />
                </td>
                <td class="px-2.5 py-1.5">
                  <DesignCell
                    kind="int"
                    column="fraction"
                    row={i}
                    label="Fraction of {name}"
                    placeholder="–"
                    value={file.fraction}
                    onChange={(v) => form.setField(file.id, 'fraction', v as number | undefined)} />
                </td>
                {#if form.advanced}
                  <td class="px-2.5 py-1.5">
                    <DesignCell
                      kind="int"
                      column="techReplicate"
                      row={i}
                      label="Technical replicate of {name}"
                      placeholder={String(resolved.techReplicate)}
                      value={file.techReplicate}
                      onChange={(v) => form.setField(file.id, 'techReplicate', v as number | undefined)} />
                  </td>
                  <td class="px-2.5 py-1.5 text-right">{resolved.fractionGroup}</td>
                  <td class="px-2.5 py-1.5 whitespace-nowrap">{design.samples[resolved.sample]?.label}</td>
                {/if}
              {/if}
              <td class="px-2.5 py-1.5 text-right">{file.spectra?.toLocaleString('en-US') ?? '–'}</td>
              <td class="px-2.5 py-1.5 text-right whitespace-nowrap">{formatBytes(file.file.size)}</td>
              <td class="px-1 py-1.5 text-center">
                <Button variant="ghost" size="icon-xs" class="text-muted-foreground" aria-label="Remove {name}" onclick={() => form.removeFile(file.id)}
                  ><XIcon /></Button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <datalist id="design-conditions">
      {#each design.conditions as c (c)}<option value={c}></option>{/each}
    </datalist>

    {#if !multi}
      <p class="text-xs text-muted-foreground">
        One file needs no design. Add more files to describe an experiment: conditions, replicates and fractions.
      </p>
    {/if}

    {#if multi}
      {#each design.notices as notice, k (k)}
        <Notice>
          {notice.message}
          {#if notice.kind === 'techReplicate'}
            <button type="button" class="ml-1 underline underline-offset-2 hover:no-underline" onclick={() => change(notice)}>Change</button>
          {/if}
        </Notice>
      {/each}
    {/if}
    {#each form.notices as message, k (k)}
      <Notice onDismiss={() => form.notices.splice(k, 1)}>{message}</Notice>
    {/each}
    {#if saveError}
      <Notice onDismiss={() => (saveError = null)}>{saveError}</Notice>
    {/if}
  </Card.Content>
</Card.Root>

<PasteDialog bind:open={pasteOpen} />
