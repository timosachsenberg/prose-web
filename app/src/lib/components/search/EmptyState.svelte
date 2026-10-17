<script lang="ts">
  // The Spectra card before any file is added: add or drop mzML files, try the example, or get the
  // desktop app. It replaces the old start page.
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { searchForm as form } from '$lib/search/form.svelte'
  import Notice from './Notice.svelte'

  let { dragging = false }: { dragging?: boolean } = $props()

  let addInput = $state<HTMLInputElement | null>(null)

  const releases = 'https://github.com/timosachsenberg/prose-web/releases/latest/download'
  const downloads = [
    { platform: 'win_x64', label: 'Windows (x64)' },
    { platform: 'mac_universal', label: 'macOS' },
    { platform: 'linux_x64', label: 'Linux (x64)' },
    { platform: 'linux_arm64', label: 'Linux (arm64)' },
  ]
</script>

<Card.Root size="sm" class="gap-3 rounded-lg shadow-none">
  <Card.Header class="flex items-center gap-2.5">
    <Card.Title class="text-[14px] font-semibold">Spectra</Card.Title>
  </Card.Header>
  <Card.Content class="flex flex-col gap-3">
    <div
      class="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border border-dashed px-5 py-6 transition-colors {dragging
        ? 'border-foreground/40 bg-muted/60'
        : 'border-border bg-muted/30'}">
      <div class="min-w-0 flex-1">
        <p class="font-medium">Drop mzML files here, or add them</p>
        <p class="text-xs text-muted-foreground">
          One file, or a whole experiment with conditions, replicates and fractions. A FASTA file dropped here becomes the
          database.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button size="sm" onclick={() => addInput?.click()}>Add files</Button>
        <Button variant="outline" size="sm" disabled={form.exampleLoading} onclick={() => form.loadExample()}>
          {form.exampleLoading ? 'Loading the example…' : 'Try the example'}
        </Button>
      </div>
    </div>
    <input
      bind:this={addInput}
      type="file"
      accept=".mzML,.mzml"
      multiple
      hidden
      onchange={(e) => {
        if (e.currentTarget.files) form.addFiles([...e.currentTarget.files])
        e.currentTarget.value = ''
      }} />
    <p class="text-xs text-muted-foreground">
      The example searches a 6.5 MB run twice, as two replicates, against its FASTA.
    </p>
    {#each form.notices as message, k (k)}
      <Notice onDismiss={() => form.notices.splice(k, 1)}>{message}</Notice>
    {/each}
    <p class="text-xs text-muted-foreground">
      Desktop app (works offline, all threads):
      {#each downloads as d, k (d.platform)}
        <a class="text-foreground underline-offset-2 hover:underline" href="{releases}/prose-desktop-{d.platform}.zip"
          >{d.label}</a
        >{k < downloads.length - 1 ? ' · ' : ''}
      {/each}
    </p>
  </Card.Content>
</Card.Root>
