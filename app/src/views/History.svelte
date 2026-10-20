<script lang="ts">
  // History: the searches kept in this browser (settings, design, results and the spectra of the PSMs,
  // not the mzML files). Open, rename and delete; "Open project…" reads a .prose file. It stays usable
  // while a search runs, and reads the list again when it is shown (another tab may have changed it).
  import SaveNotice from '$lib/components/history/SaveNotice.svelte'
  import * as Alert from '$lib/components/ui/alert'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import { Input } from '$lib/components/ui/input'
  import * as Table from '$lib/components/ui/table'
  import { formatBytes } from '$lib/format/bytes'
  import { formatCount } from '$lib/results/display'
  import { history, openFromHistory, openProjectFile, refreshHistory, removeFromHistory, rename } from '$lib/persist/history.svelte'
  import type { HistoryEntry } from '$lib/persist/record'
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert'
  import { onMount } from 'svelte'

  onMount(() => void refreshHistory())

  let fileInput = $state<HTMLInputElement | null>(null)
  /** What went wrong with the last action: open (a stored search or a project file), rename or delete. */
  let problem = $state<{ title: string; text: string } | null>(null)
  /** The search being read from storage, or 'project'. */
  let busy = $state<string | null>(null)
  /** The share of the project file read so far, while it is read. */
  let progress = $state(0)
  /** The row being renamed and the name typed so far. */
  let renaming = $state<string | null>(null)
  let draft = $state('')
  let renameInput = $state<HTMLInputElement | null>(null)
  $effect(() => {
    renameInput?.focus()
    renameInput?.select()
  })
  /** The search a Delete asks about. */
  let deleting = $state<HistoryEntry | null>(null)
  let deleteOpen = $state(false)

  const total = $derived(history.entries.reduce((n, e) => n + e.bytes, 0))
  const free = $derived(history.quota ? Math.max(0, history.quota.quota - history.quota.usage) : null)

  const message = (e: unknown) => String((e as Error)?.message ?? e)

  const date = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  /** "run_1.mzML", "run_1.mzML, run_2.mzML", "run_1.mzML and 4 more". */
  function filesText(files: string[]): string {
    return files.length <= 2 ? files.join(', ') : `${files[0]} and ${files.length - 1} more`
  }

  async function open(entry: HistoryEntry) {
    problem = null
    busy = entry.id
    try {
      await openFromHistory(entry.id)
    } catch (e) {
      problem = { title: 'Could not open', text: `${entry.name} could not be opened: ${message(e)}` }
    } finally {
      busy = null
    }
  }

  async function openFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // the same file can be chosen again
    if (!file) return
    problem = null
    busy = 'project'
    progress = 0
    try {
      await openProjectFile(file, (fraction) => (progress = fraction))
    } catch (e) {
      problem = { title: 'Could not open', text: `${file.name} could not be opened: ${message(e)}` }
    } finally {
      busy = null
    }
  }

  function startRename(entry: HistoryEntry) {
    renaming = entry.id
    draft = entry.name
  }

  async function commitRename(entry: HistoryEntry) {
    if (renaming !== entry.id) return
    renaming = null
    if (draft.trim() === '' || draft.trim() === entry.name) return
    try {
      await rename(entry.id, draft)
    } catch (e) {
      problem = { title: 'Could not rename', text: `${entry.name} could not be renamed: ${message(e)}` }
    }
  }

  function askDelete(entry: HistoryEntry) {
    deleting = entry
    deleteOpen = true
  }

  async function confirmDelete() {
    const entry = deleting
    deleteOpen = false
    if (!entry) return
    try {
      await removeFromHistory(entry.id)
    } catch (e) {
      problem = { title: 'Could not delete', text: `${entry.name} could not be deleted: ${message(e)}` }
    }
  }

  const head = 'h-auto border-b px-3 py-2 font-medium text-muted-foreground'
  const cell = 'border-b px-3 py-2'
</script>

<section data-testid="view-history" class="flex flex-col gap-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="mb-1 text-xl font-semibold tracking-tight">History</h1>
      <p class="text-muted-foreground">
        Finished searches are kept in this browser with their results and the spectra of their PSMs, not the mzML files.
      </p>
    </div>
    <div>
      <input
        bind:this={fileInput}
        type="file"
        accept=".prose"
        class="sr-only"
        tabindex="-1"
        aria-label="Project file"
        data-testid="project-input"
        onchange={openFile} />
      <Button variant="outline" size="sm" disabled={busy !== null} onclick={() => fileInput?.click()}>
        {busy === 'project' ? `Opening project… ${Math.round(progress * 100)} %` : 'Open project…'}
      </Button>
    </div>
  </div>

  <SaveNotice />

  {#if problem}
    <Alert.Root variant="destructive" class="border-destructive/30" data-testid="history-problem">
      <CircleAlertIcon />
      <Alert.Title class="font-semibold">{problem.title}</Alert.Title>
      <Alert.Description class="text-[12.5px] break-words">
        <p class="text-foreground">{problem.text}</p>
        <div class="mt-2">
          <Button variant="outline" size="sm" class="text-foreground" onclick={() => (problem = null)}>Dismiss</Button>
        </div>
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if history.unavailable}
    <p class="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground" data-testid="history-unavailable">
      {history.unavailable} Searches are not kept, but a project file (Export › Project) still saves and opens one.
    </p>
  {:else if !history.ready}
    <p class="text-xs text-muted-foreground">Reading History…</p>
  {:else if history.entries.length === 0}
    <div class="rounded-lg border border-dashed bg-background px-6 py-10 text-center" data-testid="history-empty">
      <p class="text-sm font-medium">No saved searches yet</p>
      <p class="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        Every finished search is kept here, in this browser, so that you can open it again after a reload, spectra
        included. A project file saved from the Export menu can be opened above.
      </p>
    </div>
  {:else}
    <div class="rounded-lg border bg-background">
      <Table.Root class="text-xs" aria-label="Saved searches" data-testid="history-table">
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head scope="col" class="{head} text-left">Name</Table.Head>
            <Table.Head scope="col" class="{head} text-left">Finished</Table.Head>
            <Table.Head scope="col" class="{head} text-left">Files</Table.Head>
            <Table.Head scope="col" class="{head} text-right" title="Target PSMs within the search's PSM FDR">PSMs</Table.Head>
            <Table.Head scope="col" class="{head} text-right" title="What the search takes in this browser's storage">Size</Table.Head>
            <Table.Head scope="col" class="{head} text-right"><span class="sr-only">Actions</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each history.entries as entry (entry.id)}
            <Table.Row data-testid="history-row" data-id={entry.id}>
              <Table.Cell class="{cell} max-w-[22rem] text-left font-medium">
                {#if renaming === entry.id}
                  <Input
                    class="h-7 text-[13px] md:text-[13px]"
                    aria-label="Name of {entry.name}"
                    bind:ref={renameInput}
                    bind:value={draft}
                    autocomplete="off"
                    onkeydown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void commitRename(entry)
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        renaming = null
                      }
                    }}
                    onblur={() => commitRename(entry)} />
                {:else}
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="block min-w-0 truncate" title={entry.name} data-column="name">{entry.name}</span>
                    {#if entry.variant === 'wasm64'}
                      <Badge
                        variant="outline"
                        class="h-[18px] shrink-0 px-1.5 text-[11px] font-normal text-muted-foreground"
                        title="Searched with the 64-bit engine (64-bit WebAssembly, up to 16 GB): its memory was estimated above 3 GB."
                        data-testid="history-engine">64-bit</Badge>
                    {/if}
                  </span>
                {/if}
              </Table.Cell>
              <Table.Cell class="{cell} whitespace-nowrap text-left" data-column="date">
                <time datetime={entry.createdAt}>{date(entry.createdAt)}</time>
              </Table.Cell>
              <Table.Cell class="{cell} max-w-[20rem] text-left" data-column="files">
                <span class="block truncate" title={entry.files.join('\n')}>{filesText(entry.files)}</span>
              </Table.Cell>
              <Table.Cell class="{cell} text-right tabular-nums" data-column="psms">{formatCount(entry.psms)}</Table.Cell>
              <Table.Cell class="{cell} text-right whitespace-nowrap tabular-nums" data-column="size">{formatBytes(entry.bytes)}</Table.Cell>
              <Table.Cell class="{cell} text-right whitespace-nowrap">
                <div class="flex justify-end gap-1.5">
                  <Button size="xs" disabled={busy !== null} aria-label="Open {entry.name}" onclick={() => open(entry)}>
                    {busy === entry.id ? 'Opening…' : 'Open'}
                  </Button>
                  <!-- (not while it opens) -->
                  <Button variant="outline" size="xs" disabled={busy === entry.id} aria-label="Rename {entry.name}" onclick={() => startRename(entry)}
                    >Rename</Button>
                  <Button variant="outline" size="xs" disabled={busy === entry.id} aria-label="Delete {entry.name}" onclick={() => askDelete(entry)}
                    >Delete</Button>
                </div>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
    <p class="text-xs text-muted-foreground" data-testid="history-storage">
      {history.entries.length === 1 ? '1 search takes' : `${history.entries.length} searches take`}
      {formatBytes(total)} in this browser{#if free !== null}; the browser has about {formatBytes(free)} free for this site{/if}.
    </p>
  {/if}

  {#if history.persistence === 'granted'}
    <p class="text-xs text-muted-foreground" data-testid="history-persist-note">
      ProSE asked the browser to keep History when space runs low, and it agreed.
    </p>
  {:else if history.persistence === 'denied'}
    <p class="text-xs text-muted-foreground" data-testid="history-persist-note">
      ProSE asked the browser to keep History when space runs low, but it did not agree: History may be cleared then.
      Export › Project (.prose) keeps a copy as a file.
    </p>
  {/if}
</section>

<Dialog.Root bind:open={deleteOpen}>
  <Dialog.Content class="gap-4 sm:max-w-sm">
    <Dialog.Header>
      <Dialog.Title>Delete this search?</Dialog.Title>
      <Dialog.Description>
        “{deleting?.name}” and its stored spectra are removed from this browser. A project file you saved from it is not
        affected.
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" size="sm" onclick={() => (deleteOpen = false)}>Cancel</Button>
      <Button variant="destructive" size="sm" onclick={confirmDelete}>Delete</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
