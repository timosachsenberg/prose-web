<script lang="ts">
  // "Save as preset": the settings that differ from ProSE's defaults, kept in this browser.
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { searchForm as form } from '$lib/search/form.svelte'

  let { open = $bindable(false) }: { open?: boolean } = $props()

  let name = $state('')
  const builtinName = $derived(form.presets.some((p) => p.builtin && p.name === name.trim()))

  // a user preset is offered for overwriting, a built-in one is not
  $effect(() => {
    if (open) name = form.preset && !form.preset.builtin ? form.preset.name : ''
  })

  function save() {
    if (name.trim() === '' || builtinName) return
    form.saveAsPreset(name)
    open = false
  }
</script>

<Dialog.Root bind:open>
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
        save()
      }}>
      <Label for="preset-name" class="text-xs">Name</Label>
      <Input id="preset-name" class="h-8 text-[13px] md:text-[13px]" bind:value={name} autocomplete="off" />
      {#if builtinName}
        <p class="text-xs text-destructive">A built-in preset has this name.</p>
      {/if}
    </form>
    <Dialog.Footer>
      <Button variant="outline" size="sm" onclick={() => (open = false)}>Cancel</Button>
      <Button size="sm" disabled={name.trim() === '' || builtinName} onclick={save}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
