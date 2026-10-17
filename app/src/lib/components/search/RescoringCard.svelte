<script lang="ts">
  // Rescoring: Percolator (ProSE's `rescore`, through the search request) and PeptDeep's features
  // (`peptdeep:enable` with the models), which are Percolator features and so need Percolator.
  import * as Card from '$lib/components/ui/card'
  import { Label } from '$lib/components/ui/label'
  import { Switch } from '$lib/components/ui/switch'
  import { engineState } from '$lib/engine/app-engine.svelte'
  import { searchForm as form } from '$lib/search/form.svelte'
  import ChoiceSelect from './ChoiceSelect.svelte'

  const instrumentLabels: Record<string, string> = {
    QE: 'Q Exactive / Orbitrap',
    Lumos: 'Orbitrap Lumos / Fusion',
    timsTOF: 'timsTOF',
    SciexTOF: 'SCIEX TOF',
    ThermoTOF: 'Thermo TOF (Astral)',
  }
  const instruments = $derived(
    (form.entry('peptdeep:instrument')?.validStrings ?? Object.keys(instrumentLabels)).map((v) => ({
      value: v,
      label: instrumentLabels[v] ?? v,
    })),
  )

  /** The module has ONNX Runtime (unknown while OpenMS loads). */
  const onnx = $derived(engineState.info?.onnx ?? true)
  const peptdeepBlocked = $derived(!form.rescore ? 'percolator' : !onnx ? 'onnx' : null)
  const peptdeepOn = $derived(form.peptdeep && peptdeepBlocked === null)
</script>

<Card.Root size="sm" class="gap-1 rounded-lg shadow-none">
  <Card.Header class="flex items-center">
    <Card.Title class="text-[14px] font-semibold">Rescoring</Card.Title>
  </Card.Header>
  <Card.Content class="divide-y">
    <div class="flex items-start gap-3 py-2.5">
      <Switch id="percolator" class="mt-0.5" bind:checked={form.rescore} aria-describedby="percolator-hint" />
      <div class="min-w-0">
        <Label for="percolator" class="text-[13px] font-semibold">Percolator</Label>
        <p id="percolator-hint" class="mt-0.5 text-xs text-muted-foreground">
          Learns from targets and decoys which PSM features separate them; typically 10–20 % more PSMs at the same FDR.
        </p>
      </div>
    </div>
    <div class="flex flex-wrap items-start gap-3 py-2.5">
      <Switch
        id="peptdeep"
        class="mt-0.5"
        checked={peptdeepOn}
        disabled={peptdeepBlocked !== null}
        onCheckedChange={(c) => (form.peptdeep = c)}
        aria-describedby="peptdeep-hint" />
      <div class="min-w-0 flex-1">
        <Label for="peptdeep" class="text-[13px] font-semibold">PeptDeep predictions</Label>
        <p id="peptdeep-hint" class="mt-0.5 text-xs text-muted-foreground">
          Adds agreement with predicted fragment intensities and retention times as Percolator features. Loads 17 MB of
          models once; needs about 0.6 GB more memory.
          {#if peptdeepBlocked === 'percolator'}
            <span class="text-foreground">Needs Percolator: switch it on to use PeptDeep.</span>
          {:else if peptdeepBlocked === 'onnx'}
            <span class="text-foreground">This OpenMS module has no ONNX Runtime.</span>
          {/if}
        </p>
      </div>
      <div class="grid w-[190px] gap-1">
        <Label for="instrument" class="text-xs">Instrument</Label>
        <ChoiceSelect
          id="instrument"
          disabled={!peptdeepOn}
          value={String(form.value('peptdeep:instrument') ?? 'QE')}
          options={instruments}
          onChange={(v) => form.setParam('peptdeep:instrument', v)} />
      </div>
    </div>
  </Card.Content>
</Card.Root>
