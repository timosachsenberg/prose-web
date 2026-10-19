<script lang="ts" module>
  import type { PeakAnnotationResult, PredictedIon } from '$lib/engine/openms-types'

  // annotations and predictions already made, so that Prev/Next and the toggles do not ask the engine
  // again (a few hundred PSMs' worth; the oldest go first)
  const annotations = new Map<string, PeakAnnotationResult>()
  const predictions = new Map<string, PredictedIon[]>()
  function remember<T>(cache: Map<string, T>, key: string, value: T, max: number) {
    cache.delete(key)
    cache.set(key, value)
    if (cache.size > max) cache.delete(cache.keys().next().value!)
  }
</script>

<script lang="ts">
  // The PSM view (mockup 3), beside the PSM table: breadcrumb, Prev/Next and "Export spectrum (SVG)";
  // the peptide with its fragment ladder; the spectrum annotated by the engine (viewer worker), mirrored
  // against PeptDeep's prediction or the theoretical spectrum, with ion, charge and loss toggles; the
  // ion table, the fragment mass errors and the PSM's features. A PSM whose peaks the search did not
  // keep shows its ladder, theoretical ions and features. An open search's unlocalized mass shift is
  // shown, and the annotation is of the peptide without it.
  import { signedNumber } from '$lib/format/number'
  import { Button, buttonVariants } from '$lib/components/ui/button'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import Marker from '$lib/components/results/Marker.svelte'
  import { download } from '$lib/download'
  import { engineClient, engineState } from '$lib/engine/app-engine.svelte'
  import { massShift, peptideView, psmProforma, type PeptideView } from '$lib/format/peptide'
  import {
    annotationOptions,
    fragmentCharges,
    fragmentTolerance,
    groupByPeak,
    instrumentOf,
    ionTable,
    ladderCuts,
    lossOptions,
    matchedByReference,
    matchSummary,
    modificationList,
    nceFor,
    precursorOptions,
    predictionRange,
    resolveOptions,
    similarityText,
    spectrumPeaks,
    svgFileName,
    visibleMatches,
    visibleTheoretical,
    withPrecursor,
    ION_TYPES,
    type IonType,
    type PsmOptions,
  } from '$lib/psm/psm'
  import { mzDomain } from '$lib/psm/plot'
  import { exportSpectrumSvg } from '$lib/psm/svg-export'
  import { baseName } from '$lib/results/model'
  import { formatQValue, parseAccession, parseDescription, scanNumber } from '$lib/results/display'
  import type { ResultsView } from '$lib/results/view.svelte'
  import { defaultsOf } from '$lib/settings/parameters'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import XIcon from '@lucide/svelte/icons/x'
  import { cn } from '$lib/utils'
  import { tick } from 'svelte'
  import FragmentLadder from './FragmentLadder.svelte'
  import IonTable from './IonTable.svelte'
  import MassErrorPlot from './MassErrorPlot.svelte'
  import PsmFeatures from './PsmFeatures.svelte'
  import SpectrumMirror, { type Bottom } from './SpectrumMirror.svelte'

  let {
    view,
    onClose,
    onBreadcrumb,
  }: {
    view: ResultsView
    /** Back to where the PSM came from (Esc, ✕). */
    onClose: () => void
    /** A breadcrumb: the Proteins or Peptides tab, the protein's panel, the PSM table of the peptide. */
    onBreadcrumb: (to: { tab: 'proteins' | 'peptides' } | { protein: number } | { peptide: number }) => void
  } = $props()

  const uid = $props.id()
  const m = $derived(view.model)
  const ps = $derived(m.tables.psms)
  const pt = $derived(m.tables.peptides)
  const row = $derived(view.psm?.row ?? 0)
  const k = $derived(ps.peptide[row])
  const charge = $derived(ps.charge[row])
  const sequence = $derived(pt.sequence[k])
  const fixedMods = $derived(view.result.settings.fixedMods)
  const peptide: PeptideView = $derived(peptideView(pt, k, fixedMods))
  const shift = $derived(massShift(ps.deltaMass[row]))
  /** The shift as a number on the page (a real minus); `shift` is the ProForma text. */
  const shiftText = $derived(shift === null ? null : signedNumber(ps.deltaMass[row], 4))
  const scan = $derived(scanNumber(ps.nativeId[row]))
  const spectrumName = $derived(scan === null ? `spectrum ${ps.nativeId[row]}` : `scan ${scan}`)

  // the search's settings: the parameters it changed, else the module's defaults
  const parameters = $derived(view.result.settings.parameters)
  const defaults = $derived(engineState.info ? defaultsOf(engineState.info.parameters) : undefined)
  const tolerance = $derived(fragmentTolerance(parameters, defaults))
  const instrument = $derived(instrumentOf(parameters, defaults))
  // until OpenMS is loaded it is not known whether it has ONNX Runtime: a prediction then says so
  const onnx = $derived(engineState.info?.onnx ?? true)

  const peaks = $derived(spectrumPeaks(view.result.outcome.spectra, row))
  const mods = $derived.by(() => {
    const out: { name: string; residue: string }[] = []
    for (let i = pt.modOffsets[k]; i < pt.modOffsets[k + 1]; i++) out.push({ name: pt.modName[i], residue: sequence[pt.modPosition[i]] ?? '' })
    return out
  })
  const losses = $derived(lossOptions(mods))
  const options: PsmOptions = $derived(resolveOptions(view.psmOptions, { charge, losses, onnx }))
  const engineOptions = $derived(annotationOptions(options, tolerance))
  const nce = $derived(nceFor(view.result.outcome.summary.files[ps.file[row]], peaks?.collisionEnergy ?? NaN, parameters))

  // the annotation (also without peaks: its theoretical ions make the ion table)
  const annotationKey = $derived(`${view.result.id}|${row}|${JSON.stringify(engineOptions)}`)
  let annotation = $state.raw<{ key: string; row: number; result: PeakAnnotationResult | null; error: string | null } | null>(null)
  /** The last annotation that arrived for this PSM (result id and row): shown while the next one (other toggles) is on its way. */
  let lastShown = $state.raw<{ psm: string; result: PeakAnnotationResult } | null>(null)
  const psmKey = $derived(`${view.result.id}|${row}`)

  $effect(() => {
    const key = annotationKey
    const at = row
    const psm = psmKey
    const cached = annotations.get(key)
    if (cached) {
      annotation = { key, row: at, result: cached, error: null }
      lastShown = { psm, result: cached }
      return
    }
    annotation = { key, row: at, result: null, error: null }
    const mz = peaks?.mz ?? new Float32Array(0)
    const intensity = peaks?.intensity ?? new Float32Array(0)
    engineClient()
      .annotate(mz, intensity, pt.openms[k], charge, engineOptions)
      .then(
        (result) => {
          remember(annotations, key, result, 400)
          if (annotation?.key !== key) return
          annotation = { key, row: at, result, error: null }
          lastShown = { psm, result }
        },
        (e: unknown) => {
          if (annotation?.key === key) annotation = { key, row: at, result: null, error: String((e as Error)?.message ?? e) }
        },
      )
  })

  // the precursor peaks, asked for apart: the engine makes them at `maxCharge` only, which is the
  // precursor's charge here (and not the fragments' 1 or 2)
  const precursorKey = $derived(options.precursor ? `${psmKey}|precursor|${tolerance.value}${tolerance.unit}` : null)
  let precursorAnnotation = $state.raw<{ key: string; result: PeakAnnotationResult | null; error: string | null } | null>(null)
  $effect(() => {
    const key = precursorKey
    if (key === null) return
    const cached = annotations.get(key)
    if (cached) {
      precursorAnnotation = { key, result: cached, error: null }
      return
    }
    precursorAnnotation = { key, result: null, error: null }
    engineClient()
      .annotate(peaks?.mz ?? new Float32Array(0), peaks?.intensity ?? new Float32Array(0), pt.openms[k], charge, precursorOptions(tolerance, charge))
      .then(
        (result) => {
          remember(annotations, key, result, 400)
          if (precursorAnnotation?.key === key) precursorAnnotation = { key, result, error: null }
        },
        // the fragments are annotated without the precursor peaks, and the view says so (the call is
        // asked for again when the toggle is switched off and on)
        (e: unknown) => {
          if (precursorAnnotation?.key === key) precursorAnnotation = { key, result: null, error: String((e as Error)?.message ?? e) }
        },
      )
  })
  const precursorResult = $derived(precursorKey !== null && precursorAnnotation?.key === precursorKey ? precursorAnnotation.result : null)
  /** Why the precursor peaks are missing although they were asked for. */
  const precursorError = $derived(precursorKey !== null && precursorAnnotation?.key === precursorKey ? precursorAnnotation.error : null)

  const fragments = $derived(
    annotation?.key === annotationKey && annotation.result
      ? annotation.result
      : lastShown?.psm === psmKey
        ? lastShown.result
        : null,
  )
  const result = $derived(fragments ? withPrecursor(fragments, precursorResult) : null)
  const annotating = $derived(
    (annotation?.key === annotationKey && annotation.result === null && annotation.error === null) ||
      (precursorKey !== null && precursorResult === null && precursorError === null),
  )
  const annotationError = $derived(annotation?.key === annotationKey ? annotation.error : null)

  const shown = $derived(result ? visibleMatches(result.matches, options) : [])
  const groups = $derived(result && peaks ? groupByPeak(shown, peaks.mz, peaks.intensity) : [])
  const theoretical = $derived(result ? visibleTheoretical(result.theoretical, options) : [])
  const table = $derived(result ? ionTable(result.theoretical, shown, sequence.length, options) : null)
  const cuts = $derived(ladderCuts(shown, sequence.length))
  const summary = $derived(result && peaks ? matchSummary(shown, theoretical, peaks.intensity) : null)

  // PeptDeep's prediction for the lower half (predicted once per peptide, charge, NCE and instrument)
  const predictionKey = $derived(options.bottom === 'peptdeep' && peaks ? `${pt.openms[k]}|${charge}|${nce.nce}|${instrument}` : null)
  let prediction = $state.raw<{ key: string; ions: PredictedIon[] | null; error: string | null } | null>(null)

  $effect(() => {
    const key = predictionKey
    if (key === null) return
    const cached = predictions.get(key)
    if (cached) {
      prediction = { key, ions: cached, error: null }
      return
    }
    // outside what PeptDeep takes (e.g. a recorded collision energy of 75): said instead of asked
    const outOfRange = predictionRange(nce.nce, charge)
    if (outOfRange !== null) {
      prediction = { key, ions: null, error: outOfRange }
      return
    }
    prediction = { key, ions: null, error: null }
    engineClient()
      .predict(pt.openms[k], charge, nce.nce, instrument)
      .then(
        (ions) => {
          remember(predictions, key, ions, 400)
          if (prediction?.key === key) prediction = { key, ions, error: null }
        },
        (e: unknown) => {
          if (prediction?.key === key) prediction = { key, ions: null, error: predictionProblem(String((e as Error)?.message ?? e)) }
        },
      )
  })

  /** Why a prediction failed, in a line. */
  function predictionProblem(message: string): string {
    if (/without ONNX Runtime/i.test(message)) return 'this OpenMS module has no ONNX Runtime'
    const short = message.length > 90 ? `${message.slice(0, 89)}…` : message
    if (/fetch|could not be loaded|FileNotFound/i.test(message)) return `the PeptDeep model could not be loaded (${short})`
    return short
  }

  const bottom: Bottom = $derived.by(() => {
    if (options.bottom === 'theoretical') {
      if (!result) return { kind: 'status', label: 'Theoretical', message: 'Computing the theoretical spectrum…', failed: false }
      const matched = new Set(shown.map((s) => s.ion))
      return {
        kind: 'ions',
        label: 'Theoretical',
        relative: false,
        ions: theoretical.map((t) => ({ mz: t.mz, height: 0.55, type: t.type, ion: t.ion, faint: !matched.has(t.ion) })),
      }
    }
    const label = `PeptDeep · ${nce.label} · ${instrument} · 100 % = strongest predicted b/y`
    if (prediction?.key === predictionKey && prediction.error !== null) {
      return { kind: 'status', label: 'PeptDeep', message: `Prediction unavailable: ${prediction.error}`, failed: true }
    }
    if (prediction?.key !== predictionKey || prediction.ions === null) {
      return { kind: 'status', label, message: 'Predicting with PeptDeep…', failed: false }
    }
    const ions = prediction.ions
      .filter((p) => (options.ions as string[]).includes(p.type) && options.charges.includes(p.charge))
      .map((p) => ({ mz: p.mz, height: p.intensity, type: p.type, ion: p.ion, faint: false }))
    return { kind: 'ions', label, relative: true, ions }
  })

  /** PeptDeep's similarity that the search computed (over all ions), whenever the search has it. */
  const similarity = $derived(similarityText(ps.featureNames, ps.features, row))

  /**
   * The observed half's 100 %: against PeptDeep, the strongest matched b or y peak (as PeptDeep scales
   * its prediction); against the theoretical spectrum, or without a matched b or y, the base peak.
   */
  const reference = $derived.by(() => {
    let base = 0
    for (let i = 0; i < (peaks?.intensity.length ?? 0); i++) base = Math.max(base, peaks!.intensity[i])
    const matched = options.bottom === 'peptdeep' ? matchedByReference(groups, options) : null
    return matched !== null ? { intensity: matched, text: 'strongest matched b/y' } : { intensity: base, text: 'base peak' }
  })

  /** The annotation or the prediction is on its way: the spectrum is not exported meanwhile. */
  const pending = $derived(annotating || (bottom.kind === 'status' && !bottom.failed))

  const domain = $derived(peaks ? mzDomain([peaks.mz, bottom.kind === 'ions' ? bottom.ions.map((b) => b.mz) : []]) : ([0, 100] as [number, number]))

  // breadcrumb and header
  const proteinRow = $derived.by(() => {
    const origin = view.psm?.origin
    if (origin?.kind === 'panel') return origin.protein
    const filter = view.psms.filters.proteinFilter
    const refs = m.peptide.proteins[k]
    if (filter !== undefined && refs.includes(filter)) return filter
    return refs.length > 0 ? refs[0] : null
  })
  const proteinCrumb = $derived.by(() => {
    if (proteinRow === null) return null
    const accession = m.tables.proteins.accession[proteinRow]
    const gene = parseDescription(m.tables.proteins.description[proteinRow]).gene
    const more = m.peptide.proteins[k].length - 1
    return { text: `${gene ?? parseAccession(accession).id}${more > 0 ? ` +${more}` : ''}`, title: accession }
  })
  /** The peptide as the breadcrumb writes it: "AVM(ox)DDFAAFVEK", after its shift. */
  const peptideCrumb = $derived.by(() => {
    const label = (mod: { label: string } | undefined) => (mod ? `(${mod.label})` : '')
    const core = peptide.residues.map((r) => `${r.residue}${label(r.mod)}`).join('')
    return `${shift ? `[${shift}]?` : ''}${peptide.nTerm ? `(${peptide.nTerm.label})` : ''}${core}${peptide.cTerm ? `(${peptide.cTerm.label})` : ''}`
  })
  const proforma = $derived(psmProforma(pt.proforma[k], ps.deltaMass[row]))
  const fileName = $derived(baseName(m.tables.files[ps.file[row]] ?? ''))

  const headerLine = $derived.by(() => {
    const rt = ps.rt[row]
    const err = ps.precursorErrorPpm[row]
    return [
      m.samples[m.psmSample[row]]?.label,
      `${charge}+`,
      Number.isFinite(ps.mz[row]) ? `m/z ${ps.mz[row].toFixed(4)}` : null,
      rt >= 0 ? `RT ${(rt / 60).toFixed(1)} min` : null,
      `q ${formatQValue(ps.qValue[row])}`,
      // an open search's shift is the whole mass difference: no error is left to show
      Number.isFinite(err) && shift === null ? `${signedNumber(err, 1)} ppm` : null,
    ]
      .filter((p) => p)
      .join(' · ')
  })

  const neighbours = $derived(view.psmNeighbours)

  const spectrumTitle = $derived.by(() => {
    const listed = modificationList(pt, k, fixedMods)
    const below = options.bottom === 'peptdeep' ? `PeptDeep's prediction at ${nce.label}` : 'the theoretical spectrum'
    return `Annotated spectrum of ${sequence}${listed.length > 0 ? ` (${listed.join(', ')})` : ''}, ${charge}+, ${spectrumName}; below: ${below}`
  })
  const spectrumDescription = $derived(
    peaks
      ? `${groups.length} of ${peaks.mz.length} peaks matched: b ions blue, y ions orange, other ions dark grey, unmatched peaks light grey.` +
          (summary ? ` ${summary.matched} of ${summary.total} ions shown are matched; their peaks carry ${Math.round(summary.intensityFraction * 100)} % of the intensity.` : '') +
          ` Above, 100 % is the ${reference.text}; below, ${options.bottom === 'peptdeep' ? 'the strongest predicted b or y ion' : 'every ion has one height'}.` +
          (similarity ? ` ${similarity.replace(' (search)', '')}, as the search computed it over all ions.` : '')
      : '',
  )

  /** What the losses menu's button says: the losses on, and the precursor ("CH₄SO · precursor", "none"). */
  const moreSummary = $derived.by(() => {
    const on = losses.filter((l) => options.losses.includes(l.formula)).map((l) => (l.formula === 'other' ? 'other' : l.label))
    if (options.precursor) on.push('precursor')
    return on.length > 0 ? on.join(', ') : 'none'
  })
  const moreOn = $derived(options.losses.length > 0 || options.precursor)

  // the toggles: a choice made here becomes the user's (no longer automatic) for all PSMs
  function setIon(type: IonType, on: boolean) {
    const ions = new Set(options.ions)
    if (on) ions.add(type)
    else ions.delete(type)
    view.psmOptions.ions = ION_TYPES.filter((t) => ions.has(t))
  }
  function setCharge(c: number, on: boolean) {
    const charges = new Set(options.charges)
    if (on) charges.add(c)
    else charges.delete(c)
    view.psmOptions.charges = [...charges].sort()
  }
  function setLoss(formula: string, on: boolean) {
    const chosen = new Set(options.losses)
    if (on) chosen.add(formula)
    else chosen.delete(formula)
    view.psmOptions.losses = [...chosen]
  }

  let mirror = $state<SpectrumMirror | null>(null)
  function exportSvg() {
    const svg = mirror?.svgElement()
    if (!svg) return
    download(svgFileName(proforma, ps.nativeId[row]), exportSpectrumSvg(svg), 'image/svg+xml')
  }

  // the Export menu's "Spectrum (SVG)" does what the button does
  $effect(() => {
    view.spectrumExporter = peaks && !pending ? exportSvg : null
    return () => (view.spectrumExporter = null)
  })

  let ladderRow = $state(0)
  let heading = $state<HTMLElement | null>(null)
  let prevButton = $state<HTMLElement | null>(null)
  let nextButton = $state<HTMLElement | null>(null)
  /** Moves the keyboard focus into the view (to its heading, which names the PSM). */
  export function focus(): void {
    heading?.focus()
  }

  /** Previous or next PSM; the focus stays on the button, or goes to the other one when this one is done. */
  async function step(direction: 1 | -1) {
    const from = document.activeElement
    view.stepPsm(direction)
    await tick()
    if (from === prevButton || from === nextButton) {
      const own = direction < 0 ? prevButton : nextButton
      const other = direction < 0 ? nextButton : prevButton
      if (own && !(own as HTMLButtonElement).disabled) own.focus()
      else other?.focus()
    }
  }

  /** Keys that belong to what has the focus: typing, a grid, radio buttons, menus. */
  function ownsKeys(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    if (target.closest('input, textarea, select, [contenteditable="true"], [role="grid"], [role="tablist"], [role="menu"], [role="listbox"], [role="dialog"]')) {
      return true
    }
    return false
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key === 'Escape') {
      if (event.target instanceof Element && event.target.closest('input[type="search"], input[type="text"], textarea, [role="dialog"], [role="menu"]')) return
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (ownsKeys(event.target)) return
      event.preventDefault()
      void step(event.key === 'ArrowLeft' ? -1 : 1)
    }
  }

  const toggle =
    'inline-flex h-[26px] min-w-[30px] cursor-pointer items-center justify-center rounded-md border bg-background px-2 text-xs text-muted-foreground select-none hover:text-foreground peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50'
  const crumb = 'rounded-sm hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
</script>

<svelte:window {onkeydown} />

<section
  class="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-5 pt-3.5 pb-6"
  aria-labelledby="{uid}-heading"
  data-testid="psm-view">
  <header class="flex items-start justify-between gap-3">
    <div class="flex min-w-0 flex-wrap items-baseline gap-x-1 text-xs text-muted-foreground" data-testid="psm-breadcrumb">
      <nav aria-label="Breadcrumb" class="min-w-0">
        <ol class="flex flex-wrap items-baseline gap-x-1">
          <li><button type="button" class={crumb} onclick={() => onBreadcrumb({ tab: 'proteins' })}>Proteins</button> ›</li>
          <li>
            {#if proteinCrumb && proteinRow !== null}
              <button type="button" class="{crumb} font-medium text-foreground" title={proteinCrumb.title} onclick={() => onBreadcrumb({ protein: proteinRow! })}
                >{proteinCrumb.text}</button>
              <span class="sr-only">({proteinCrumb.title})</span>
            {:else}
              <span>below protein FDR</span>
            {/if}
            ›
          </li>
          <li><button type="button" class={crumb} onclick={() => onBreadcrumb({ tab: 'peptides' })}>Peptides</button> ›</li>
          <li>
            <button type="button" class="{crumb} max-w-[22rem] truncate align-bottom font-medium text-foreground" title="{proforma} – its PSMs in the PSM table" onclick={() => onBreadcrumb({ peptide: k })}
              >{peptideCrumb}</button>
            ›
          </li>
        </ol>
      </nav>
      <h2 bind:this={heading} id="{uid}-heading" tabindex="-1" class="rounded-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        PSM in {fileName}, {spectrumName}
      </h2>
      <!-- the focus can stay in the list beside the view: say which PSM opened -->
      <p class="sr-only" aria-live="polite">PSM {peptideCrumb}, {charge}+, {spectrumName} ({fileName})</p>
    </div>
    <div class="flex flex-none items-center gap-1.5">
      <Button
        bind:ref={prevButton}
        variant="outline"
        size="sm"
        class="h-7 px-2.5 text-xs"
        aria-label="Previous PSM"
        title={neighbours.position < 0 ? 'The filters of the list hide this PSM' : 'Previous PSM of the list (←)'}
        aria-keyshortcuts="ArrowLeft"
        disabled={neighbours.prev === null}
        onclick={() => step(-1)}>‹ Prev</Button>
      <Button
        bind:ref={nextButton}
        variant="outline"
        size="sm"
        class="h-7 px-2.5 text-xs"
        aria-label="Next PSM"
        title={neighbours.position < 0 ? 'The filters of the list hide this PSM' : 'Next PSM of the list (→)'}
        aria-keyshortcuts="ArrowRight"
        disabled={neighbours.next === null}
        onclick={() => step(1)}>Next ›</Button>
      <Button
        variant="outline"
        size="sm"
        class="h-7 px-2.5 text-xs"
        disabled={!peaks || pending}
        title={!peaks ? 'The spectrum was not stored' : pending ? 'Wait for the annotation and the prediction' : undefined}
        onclick={exportSvg}>Export spectrum (SVG)</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Close the PSM view" title="Back (Esc)" onclick={onClose}>
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  </header>

  <div class="mt-1 flex flex-wrap items-end gap-x-5" bind:clientWidth={ladderRow}>
    <FragmentLadder {peptide} {cuts} {shift} available={ladderRow} />
    <p class="pb-3 text-xs text-muted-foreground tabular-nums" data-testid="psm-header">
      {#if shift}<span class="font-mono">[{shift}]?</span>{' · '}{/if}{headerLine}{#if ps.decoy[row]}<Marker text="decoy" />{/if}
    </p>
  </div>
  {#if shift}
    <p class="-mt-1 mb-2 text-xs text-muted-foreground" data-testid="open-search-note">
      Open search: an unlocalized mass shift of {shiftText} Da. The annotation is of the peptide without it, so fragments that carry
      the shift stay unannotated.
    </p>
  {/if}

  <div class="rounded-lg border bg-background px-3.5 pt-3 pb-2">
    <div class="mb-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <div class="flex items-center gap-1" role="group" aria-labelledby="{uid}-ions">
        <span id="{uid}-ions" class="mr-1 text-muted-foreground">Ions</span>
        {#each ION_TYPES as t (t)}
          <label class="relative">
            <input
              type="checkbox"
              class="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
              aria-label="{t} ions"
              checked={options.ions.includes(t)}
              onchange={(e) => setIon(t, e.currentTarget.checked)} />
            <span class={toggle}>{t}</span>
          </label>
        {/each}
      </div>
      <div class="flex items-center gap-1" role="group" aria-labelledby="{uid}-charge">
        <span id="{uid}-charge" class="mr-1 text-muted-foreground">Charge</span>
        <!-- a 1+ precursor has 1+ fragments only -->
        {#each fragmentCharges(charge) as c (c)}
          <label class="relative">
            <input
              type="checkbox"
              class="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
              aria-label="{c}+ fragments"
              checked={options.charges.includes(c)}
              onchange={(e) => setCharge(c, e.currentTarget.checked)} />
            <span class={toggle}>{c}+</span>
          </label>
        {/each}
      </div>
      <!-- the neutral losses and the precursor peaks: one menu, its button says what is on -->
      <div class="flex items-center gap-1">
        <span id="{uid}-more" class="mr-1 text-muted-foreground">Losses</span>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-[26px] gap-1 px-2 text-xs font-normal', moreOn && 'border-primary')}
            aria-label="Losses and precursor peaks: {moreSummary}">
            {moreSummary}<ChevronDown class="size-3.5 text-muted-foreground" aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content class="w-auto min-w-56" align="start">
            <DropdownMenu.Group>
              <DropdownMenu.GroupHeading class="text-xs font-medium text-muted-foreground">Neutral losses</DropdownMenu.GroupHeading>
              {#each losses as l (l.formula)}
                <DropdownMenu.CheckboxItem
                  checked={options.losses.includes(l.formula)}
                  onCheckedChange={(on) => setLoss(l.formula, on)}
                  title={l.formula === 'other' ? 'Other neutral losses the engine finds (e.g. of side chains)' : undefined}
                  >{l.formula === 'other' ? 'other losses' : `${l.label} loss${l.note ? ` (${l.note})` : ''}`}</DropdownMenu.CheckboxItem>
              {/each}
            </DropdownMenu.Group>
            <DropdownMenu.Separator />
            <DropdownMenu.CheckboxItem checked={options.precursor} onCheckedChange={(on) => (view.psmOptions.precursor = on)}
              >Precursor peaks</DropdownMenu.CheckboxItem>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
      <div class="ml-auto flex items-center gap-1" role="radiogroup" aria-labelledby="{uid}-bottom">
        <span id="{uid}-bottom" class="mr-1 text-muted-foreground">Bottom</span>
        <label class="relative" title={onnx ? undefined : 'This OpenMS module has no ONNX Runtime'}>
          <input
            type="radio"
            name="{uid}-bottom"
            class="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
            value="peptdeep"
            disabled={!onnx}
            checked={options.bottom === 'peptdeep'}
            onchange={() => (view.psmOptions.bottom = 'peptdeep')} />
          <span class={toggle}>PeptDeep prediction</span>
        </label>
        <label class="relative">
          <input
            type="radio"
            name="{uid}-bottom"
            class="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
            value="theoretical"
            checked={options.bottom === 'theoretical'}
            onchange={() => (view.psmOptions.bottom = 'theoretical')} />
          <span class={toggle}>Theoretical</span>
        </label>
      </div>
    </div>

    {#if peaks}
      <SpectrumMirror
        bind:this={mirror}
        mz={peaks.mz}
        intensity={peaks.intensity}
        {groups}
        {reference}
        {bottom}
        {similarity}
        title={spectrumTitle}
        description={spectrumDescription}
        {annotating}
        onTheoretical={() => (view.psmOptions.bottom = 'theoretical')} />
      {#if annotationError}
        <p class="pb-1 text-xs text-destructive" role="alert">The spectrum could not be annotated: {annotationError}</p>
      {:else if precursorError}
        <p class="pb-1 text-xs text-muted-foreground" role="status" data-testid="precursor-note">
          The precursor peaks could not be annotated ({precursorError.length > 90 ? `${precursorError.slice(0, 89)}…` : precursorError}), so the
          fragments are shown without them. Switching the precursor peaks off and on tries again.
        </p>
      {/if}
    {:else}
      <div class="my-2 rounded-md border border-dashed px-4 py-8 text-center" data-testid="spectrum-missing">
        <p class="font-medium">Spectrum not stored</p>
        <p class="mx-auto mt-1 max-w-[44rem] text-xs text-muted-foreground">
          The result has no peaks for this PSM, so its spectrum cannot be shown, annotated or exported. A search keeps the spectra of
          its PSMs within its PSM FDR; results opened without them (as the debug results) have none. The ladder needs the
          peaks too; the table below lists the theoretical ions.
        </p>
      </div>
    {/if}
  </div>

  <!-- the ion table, the mass errors and the features side by side; what does not fit wraps -->
  <div class="mt-3 flex flex-wrap items-start gap-3">
    <div class="max-w-full min-w-0 flex-none rounded-lg border bg-background px-2 py-2">
      {#if table}
        <IonTable {table} {peptide} label={sequence} />
      {:else}
        <p class="px-2 py-6 text-center text-xs text-muted-foreground">
          {annotationError ? `No ion table: ${annotationError}` : 'Computing the fragment ions…'}
        </p>
      {/if}
    </div>
    <div class="min-w-[280px] flex-[1_1_320px] rounded-lg border bg-background px-3.5 py-3" data-testid="mass-error">
      <h3 class="mb-1 text-[13px] font-semibold">Fragment mass error</h3>
      {#if peaks}
        <MassErrorPlot matches={shown} mz={peaks.mz} intensity={peaks.intensity} {tolerance} {domain} />
      {:else}
        <p class="py-6 text-center text-xs text-muted-foreground">No spectrum: no mass errors.</p>
      {/if}
    </div>
    <div class="max-w-[380px] min-w-[250px] flex-[1_1_260px] rounded-lg border bg-background px-3.5 py-3">
      <PsmFeatures model={m} {row} {fixedMods} matched={summary} />
    </div>
  </div>
</section>
