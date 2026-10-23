<script lang="ts">
  // The Spectra card before any file is added: add or drop mzML files, try the example, or get the
  // desktop app. It replaces the old start page.
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { searchForm as form } from '$lib/search/form.svelte'
  import NoticeList from './NoticeList.svelte'

  let { dragging = false }: { dragging?: boolean } = $props()

  let addInput = $state<HTMLInputElement | null>(null)

  // the native desktop app: the page of the latest desktop-native-v* release, whose packages carry the version
  const desktopReleases = 'https://github.com/timosachsenberg/prose-web/releases/latest'
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
      The example searches one run (2,789 spectra) twice, as two replicates, against its FASTA.
    </p>
    <NoticeList items={form.notices.map((message, k) => ({ message, onDismiss: () => form.notices.splice(k, 1) }))} />
    <p class="text-xs text-muted-foreground">
      <a class="text-foreground underline-offset-2 hover:underline" href={desktopReleases}
        >Desktop app (Windows, macOS, Linux)</a
      >: native engine, no memory limit, works offline.
    </p>
  </Card.Content>
</Card.Root>
