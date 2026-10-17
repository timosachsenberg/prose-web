<script lang="ts">
  // Search settings: the preset, the ten common parameters (in the mockup's order) and "All N
  // parameters", the dialog generated from ProSE's parameter definitions.
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import FdrInput from '$lib/components/FdrInput.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Label } from '$lib/components/ui/label'
  import { searchForm as form } from '$lib/search/form.svelte'
  import { dialogEntries } from '$lib/settings/parameters'
  import AllParametersDialog from './AllParametersDialog.svelte'
  import ChoiceSelect from './ChoiceSelect.svelte'
  import ModificationsField from './ModificationsField.svelte'
  import NumberField from './NumberField.svelte'
  import RangeField from './RangeField.svelte'
  import ToleranceField from './ToleranceField.svelte'

  let dialogOpen = $state(false)

  const count = $derived(form.entries.size > 0 ? dialogEntries([...form.entries.values()]).length : null)

  const presetOptions = $derived(form.presets.map((p) => ({ value: p.id, label: p.name })))

  // the usual enzymes first, then the others alphabetically
  const COMMON_ENZYMES = [
    'Trypsin/P',
    'Trypsin',
    'Lys-C',
    'Lys-C/P',
    'Arg-C',
    'Asp-N',
    'Glu-C+P',
    'Chymotrypsin',
    'Chymotrypsin/P',
    'unspecific cleavage',
  ]
  const enzymeOptions = $derived.by(() => {
    const valid = form.entry('enzyme')?.validStrings ?? [String(form.value('enzyme'))]
    const common = COMMON_ENZYMES.filter((e) => valid.includes(e))
    const rest = valid.filter((e) => !common.includes(e)).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    return [...common, ...rest].map((e) => ({ value: e, label: e }))
  })

  const lower = $derived(form.value<number>('precursor:mass_tolerance_lower'))
  const upper = $derived(form.value<number>('precursor:mass_tolerance_upper'))

  function setPrecursor(v: number) {
    form.setParam('precursor:mass_tolerance_lower', v)
    form.setParam('precursor:mass_tolerance_upper', v)
  }

  const modOptions = $derived(form.entry('modifications:variable')?.validStrings)
  // valid names before OpenMS is loaded: those the presets use
  const trustedMods = $derived(
    new Set(
      form.presets.flatMap((p) =>
        ['modifications:fixed', 'modifications:variable'].flatMap((k) =>
          Array.isArray(p.parameters[k]) ? (p.parameters[k] as string[]) : [],
        ),
      ),
    ),
  )
  const fixedOptions = $derived(form.entry('modifications:fixed')?.validStrings)
</script>

<Card.Root size="sm" class="gap-3 rounded-lg shadow-none">
  <Card.Header class="flex flex-wrap items-center gap-x-2.5 gap-y-2">
    <Card.Title class="text-[14px] font-semibold">Search settings</Card.Title>
    <Label for="preset" class="font-normal text-muted-foreground">Preset</Label>
    <ChoiceSelect id="preset" class="w-[230px]" value={form.presetId} options={presetOptions} onChange={(id) => form.choosePreset(id)} />
    {#if form.modified}
      <span class="text-xs text-muted-foreground">modified</span>
    {/if}
    <div class="flex-1"></div>
    <Button
      variant="ghost"
      size="sm"
      class="h-7 px-2 text-xs text-muted-foreground"
      disabled={count === null}
      title={count === null ? 'Available once OpenMS is loaded' : undefined}
      onclick={() => (dialogOpen = true)}>
      {count === null ? 'All parameters' : `All ${count} parameters`}<ChevronRightIcon class="size-3.5" />
    </Button>
  </Card.Header>

  <Card.Content class="grid grid-cols-2 gap-x-4 gap-y-3.5 md:grid-cols-4">
    <div class="grid min-w-0 gap-1">
      <Label for="enzyme" class="text-xs">Enzyme</Label>
      <ChoiceSelect id="enzyme" value={String(form.value('enzyme'))} options={enzymeOptions} onChange={(v) => form.setParam('enzyme', v)} />
    </div>
    <div class="grid min-w-0 gap-1">
      <Label for="missed-cleavages" class="text-xs">Missed cleavages</Label>
      <NumberField
        id="missed-cleavages"
        kind="int"
        min={0}
        value={form.value<number>('peptide:missed_cleavages')}
        onChange={(v) => form.setParam('peptide:missed_cleavages', v)} />
    </div>
    <div class="grid min-w-0 gap-1">
      <Label for="precursor-tolerance" class="text-xs">Precursor tolerance</Label>
      <ToleranceField
        id="precursor-tolerance"
        label="Precursor tolerance"
        value={upper}
        unit={String(form.value('precursor:mass_tolerance_unit'))}
        onValue={setPrecursor}
        onUnit={(u) => form.setParam('precursor:mass_tolerance_unit', u)} />
      {#if lower !== upper}
        <p class="text-xs text-muted-foreground">Asymmetric: −{lower} / +{upper}. Typing sets both sides.</p>
      {/if}
    </div>
    <div class="grid min-w-0 gap-1">
      <Label for="fragment-tolerance" class="text-xs">Fragment tolerance</Label>
      <ToleranceField
        id="fragment-tolerance"
        label="Fragment tolerance"
        value={form.value<number>('fragment:mass_tolerance')}
        unit={String(form.value('fragment:mass_tolerance_unit'))}
        onValue={(v) => form.setParam('fragment:mass_tolerance', v)}
        onUnit={(u) => form.setParam('fragment:mass_tolerance_unit', u)} />
    </div>

    <div class="col-span-2 grid min-w-0 gap-1">
      <span id="fixed-mods-label" class="text-xs font-medium">Fixed modifications</span>
      <ModificationsField
        labelId="fixed-mods-label"
        kind="fixed"
        value={form.value<string[]>('modifications:fixed') ?? []}
        options={fixedOptions}
        trusted={trustedMods}
        onChange={(v) => form.setParam('modifications:fixed', v)} />
    </div>
    <div class="col-span-2 grid min-w-0 gap-1">
      <span id="variable-mods-label" class="text-xs font-medium">Variable modifications</span>
      <ModificationsField
        labelId="variable-mods-label"
        kind="variable"
        value={form.value<string[]>('modifications:variable') ?? []}
        options={modOptions}
        trusted={trustedMods}
        onChange={(v) => form.setParam('modifications:variable', v)} />
    </div>

    <div class="grid min-w-0 content-start gap-1">
      <Label for="psm-fdr" class="text-xs">PSM FDR</Label>
      <FdrInput
        id="psm-fdr"
        class="[&>div:first-child]:h-8 [&>div:first-child]:bg-background [&>div:first-child]:shadow-none"
        bind:value={() => form.value<number>('FDR:PSM'), (v) => form.setParam('FDR:PSM', v)} />
    </div>
    <div class="grid min-w-0 content-start gap-1">
      <Label for="protein-fdr" class="text-xs">Protein FDR</Label>
      <FdrInput
        id="protein-fdr"
        class="[&>div:first-child]:h-8 [&>div:first-child]:bg-background [&>div:first-child]:shadow-none"
        bind:value={() => form.value<number>('FDR:protein'), (v) => form.setParam('FDR:protein', v)} />
    </div>
    <div class="grid min-w-0 content-start gap-1">
      <span id="charges-label" class="text-xs font-medium">Charges</span>
      <RangeField
        labelId="charges-label"
        from={form.value<number>('precursor:min_charge')}
        to={form.value<number>('precursor:max_charge')}
        fromLabel="Lowest precursor charge"
        toLabel="Highest precursor charge"
        min={1}
        onFrom={(v) => form.setParam('precursor:min_charge', v)}
        onTo={(v) => form.setParam('precursor:max_charge', v)} />
    </div>
    <div class="grid min-w-0 content-start gap-1">
      <span id="length-label" class="text-xs font-medium">Peptide length</span>
      <RangeField
        labelId="length-label"
        from={form.value<number>('peptide:min_size')}
        to={form.value<number>('peptide:max_size')}
        fromLabel="Shortest peptide (residues)"
        toLabel="Longest peptide (residues)"
        min={1}
        onFrom={(v) => form.setParam('peptide:min_size', v)}
        onTo={(v) => form.setParam('peptide:max_size', v)} />
    </div>
  </Card.Content>
</Card.Root>

<AllParametersDialog bind:open={dialogOpen} />
