<script lang="ts">
  // The sticky footer of New search: a one-line plan with the memory estimate, "Save as preset" and
  // "Start search" (Ctrl+Enter); during the search its step, a progress bar (indeterminate while the
  // fraction does not move: reading the files, Percolator, a chunked search) and Cancel. Errors of the
  // engine are shown above it.
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert'
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
  import * as Alert from '$lib/components/ui/alert'
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Progress } from '$lib/components/ui/progress'
  import { engineState } from '$lib/engine/app-engine.svelte'
  import { navigate } from '$lib/route.svelte'
  import { formatBytes } from '$lib/search/files'
  import { CRAP_PROTEINS, searchForm as form } from '$lib/search/form.svelte'
  import { cancelSearch, clearRunMessage, runSearch, searchRun } from '$lib/search/session.svelte'
  import { estimateMemory, formatMemory, INPUT_BUDGET, type Specificity } from '$lib/settings/memory'
  import { requestParameters } from '$lib/settings/parameters'
  import { cn } from '$lib/utils'

  /** No move of the fraction for this long: the bar turns indeterminate (Percolator sends no progress). */
  const STALL_MS = 2000

  const running = $derived(searchRun.status === 'running')
  // PeptDeep features need Percolator and ONNX Runtime (the app's package has it; unknown while OpenMS loads)
  const peptdeep = $derived(form.rescore && form.peptdeep && (engineState.info?.onnx ?? true))

  const estimate = $derived.by(() => {
    if (form.files.length === 0) return null
    const sizes = form.files.map((r) => r.file.size)
    const enzyme = String(form.value('enzyme'))
    const specificity =
      enzyme === 'unspecific cleavage' ? 'none' : ((form.value('peptide:enzyme_specificity') ?? 'full') as Specificity)
    return estimateMemory({
      largestMzmlBytes: Math.max(...sizes),
      inputBytes: sizes.reduce((a, b) => a + b, 0) + (form.database?.file.size ?? 0),
      proteins: (form.database?.proteins ?? 0) + (form.contaminants ? CRAP_PROTEINS : 0),
      specificity,
      variableMods: (form.value<string[]>('modifications:variable') ?? []).length,
      peptdeep,
      storage: 'memory',
      chunkSize: Number(form.value('database:chunk_size') ?? 0),
    })
  })

  const plan = $derived.by(() => {
    const n = form.files.length
    if (n === 0) return 'No spectra yet'
    const samples = form.design.samples.length
    const parts = [`${n} ${n === 1 ? 'file' : 'files'}${n > 1 ? ` in ${samples} ${samples === 1 ? 'sample' : 'samples'}` : ''}`]
    if (form.database) {
      const proteins = form.database.proteins
      const decoys = form.value('decoys') === 'ignore' ? '' : ' + decoys'
      const crap = form.contaminants ? ` + ${CRAP_PROTEINS} cRAP` : ''
      parts.push(proteins === null ? 'counting proteins…' : `${proteins.toLocaleString('en-US')} proteins${crap}${decoys}`)
      if (estimate) parts.push(`estimated memory ${formatMemory(estimate.bytes)} of 4 GB`)
    } else {
      parts.push('no database yet')
    }
    return parts.join(' · ')
  })

  /** What the estimate advises, by its cause: the database's index or the input files. */
  const advice = $derived.by(() => {
    if (!estimate || !form.database || estimate.level === 'ok') return null
    const over = estimate.level === 'over'
    let text: string
    if (estimate.inputsOverBudget) {
      const total = form.files.reduce((a, r) => a + r.file.size, 0) + form.database.file.size
      text =
        `The files total ${formatBytes(total)}; the browser engine holds about ${formatMemory(INPUT_BUDGET)} of ` +
        'input at once: search fewer files at a time.'
    } else if (estimate.cause === 'inputs') {
      const limit = over ? 'More than the 4 GB a browser search can use' : 'Close to the 4 GB limit'
      text = `${limit}, mostly for the files: search fewer files at once.`
    } else {
      text = over
        ? 'More than the 4 GB a browser search can use: set database:chunk_size (e.g. 2000) under All parameters, ' +
          'or use fewer variable modifications or a narrower specificity.'
        : 'Close to the 4 GB limit: consider database:chunk_size (e.g. 2000) under All parameters.'
    }
    return { text, over }
  })

  /** Why the search cannot start yet. */
  const problem = $derived.by(() => {
    if (form.files.length === 0) return 'Add mzML files to start.'
    if (!form.database) return 'Choose a FASTA database to start.'
    const psm = Number(form.value('FDR:PSM'))
    const protein = Number(form.value('FDR:protein'))
    if (!(psm > 0)) return 'Set a PSM FDR above 0 %.'
    if (!(protein > 0)) return 'Set a protein FDR above 0 %.'
    return null
  })

  const canStart = $derived(problem === null && !running)

  // an error of the engine is shown above the footer, scrolled into view
  let errorBox = $state<HTMLElement | null>(null)
  $effect(() => {
    errorBox?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })

  // the clock of the progress display
  let now = $state(performance.now())
  $effect(() => {
    if (!running) return
    now = performance.now()
    const timer = setInterval(() => (now = performance.now()), 250)
    return () => clearInterval(timer)
  })
  const indeterminate = $derived(running && (searchRun.fraction === 0 || now - searchRun.movedAt > STALL_MS))
  const elapsed = $derived.by(() => {
    const s = Math.max(0, Math.floor((now - searchRun.startedAt) / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  })
  // the step, with its file when the search has several ("File 2 of 6 · Post-processing PSMs…")
  const stepLabel = $derived.by(() => {
    const label = searchRun.label.replace(/\.\.\.$/, '…')
    const { file, fileCount: n } = searchRun
    if (n > 1 && file >= 0 && file < n && !label.includes(`of ${n})`)) return `File ${file + 1} of ${n} · ${label}`
    return label
  })

  async function start() {
    if (!canStart || !form.database) return
    clearRunMessage()
    const values = $state.snapshot(form.values) as Record<string, unknown>
    const parameters = requestParameters(values, form.defaults)
    const request = {
      files: form.files.map((r) => ({ id: r.id, file: r.file })),
      database: form.database.file,
      contaminants: form.contaminants,
      parameters,
      rescore: form.rescore,
      peptdeep,
    }
    const id = await runSearch(request, {
      design: $state.snapshot(form.design),
      psmFdr: Number(values['FDR:PSM']),
      proteinFdr: Number(values['FDR:protein']),
      settings: { parameters, rescore: form.rescore, peptdeep, contaminants: form.contaminants, presetId: form.presetId },
    })
    if (id !== null) navigate({ view: 'results', id })
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
    if (document.querySelector('[role="dialog"]')) return // Ctrl+Enter inside a dialog is the dialog's
    event.preventDefault()
    void start()
  }

  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

  // "Save as preset"
  let presetOpen = $state(false)
  let presetName = $state('')
  const builtinName = $derived(form.presets.some((p) => p.builtin && p.name === presetName.trim()))
  function openPresetDialog() {
    presetName = form.preset && !form.preset.builtin ? form.preset.name : ''
    presetOpen = true
  }
  function savePreset() {
    if (presetName.trim() === '' || builtinName) return
    form.saveAsPreset(presetName)
    presetOpen = false
  }
</script>

<svelte:window onkeydown={onKey} />

{#if searchRun.status === 'failed' && searchRun.error}
  <Alert.Root bind:ref={errorBox} variant="destructive" class="scroll-mb-20 border-destructive/30">
    <CircleAlertIcon />
    <Alert.Title class="font-semibold">The search stopped</Alert.Title>
    <Alert.Description class="text-[12.5px] whitespace-pre-line text-foreground">
      <p>{searchRun.error}</p>
      <div class="mt-2 flex gap-2">
        {#if searchRun.reload}
          <Button size="sm" onclick={() => location.reload()}>Reload the page</Button>
        {/if}
        <Button variant="outline" size="sm" onclick={clearRunMessage}>Dismiss</Button>
      </div>
    </Alert.Description>
  </Alert.Root>
{/if}

<div class="fixed inset-x-0 bottom-0 z-40 h-[60px] border-t bg-background/95 backdrop-blur-sm">
  <div class="mx-auto flex h-full max-w-[1120px] items-center gap-3 px-5">
    {#if running}
      <div class="flex min-w-0 flex-1 items-center gap-3" data-testid="search-progress">
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs" aria-live="polite">{stepLabel}</p>
          <Progress
            class="mt-1.5 max-w-xl"
            value={indeterminate ? null : Math.round(searchRun.fraction * 100)}
            aria-label="Search progress" />
        </div>
        <span class="shrink-0 text-xs text-muted-foreground tabular-nums">
          {indeterminate ? '' : `${Math.round(searchRun.fraction * 100)} % · `}{elapsed}
        </span>
      </div>
      <Button variant="outline" onclick={cancelSearch}>Cancel</Button>
    {:else}
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs text-muted-foreground" data-testid="search-plan">{plan}</p>
        {#if problem && form.files.length > 0}
          <p class="truncate text-xs text-foreground" id="start-problem">{problem}</p>
        {:else if advice}
          <p
            class={cn('flex items-center gap-1 text-xs', advice.over ? 'text-destructive' : 'text-amber-700')}
            title={advice.text}>
            <TriangleAlertIcon class="size-3 shrink-0" aria-hidden="true" /><span class="truncate">{advice.text}</span>
          </p>
        {:else if searchRun.status === 'cancelled'}
          <p class="text-xs text-muted-foreground">The search was cancelled.</p>
        {:else if searchRun.status === 'failed'}
          <p class="text-xs text-destructive">The search stopped: see the message above.</p>
        {/if}
      </div>
      <Button variant="outline" onclick={openPresetDialog}>Save as preset</Button>
      <Button disabled={!canStart} aria-describedby={problem ? 'start-problem' : undefined} onclick={start}>
        Start search
        <kbd class="ml-1 rounded-[4px] border border-zinc-700 bg-zinc-800 px-1 font-sans text-[11px] text-zinc-400"
          >{mac ? '⌘' : 'Ctrl'} ↵</kbd>
      </Button>
    {/if}
  </div>
</div>

<Dialog.Root bind:open={presetOpen}>
  <Dialog.Content class="gap-4 sm:max-w-sm">
    <Dialog.Header>
      <Dialog.Title>Save as preset</Dialog.Title>
      <Dialog.Description>
        Keeps the settings that differ from ProSE's defaults in this browser. Percolator and PeptDeep are not part of a
        preset.
      </Dialog.Description>
    </Dialog.Header>
    <form
      class="grid gap-1.5"
      onsubmit={(e) => {
        e.preventDefault()
        savePreset()
      }}>
      <Label for="preset-name" class="text-xs">Name</Label>
      <Input id="preset-name" class="h-8 text-[13px] md:text-[13px]" bind:value={presetName} autocomplete="off" />
      {#if builtinName}
        <p class="text-xs text-destructive">A built-in preset has this name.</p>
      {/if}
    </form>
    <Dialog.Footer>
      <Button variant="outline" size="sm" onclick={() => (presetOpen = false)}>Cancel</Button>
      <Button size="sm" disabled={presetName.trim() === '' || builtinName} onclick={savePreset}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
