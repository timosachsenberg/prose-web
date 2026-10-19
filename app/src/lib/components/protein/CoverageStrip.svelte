<script lang="ts">
  // The protein's sequence as one strip: its peptides along it (light blue), the selected peptide below
  // (blue) and a dot on every modified residue (#1baf7a, the colour of a modified residue everywhere).
  // Positions are percentages of the sequence, so the strip is as wide as the panel. It is a picture:
  // the Coverage tab has the same as text, and the Peptides tab lists the peptides.
  import { formatCount } from '$lib/results/display'
  import { siteTitle, type ProteinDetail, type Span } from '$lib/results/protein'

  let { detail, selected = [] }: { detail: ProteinDetail; selected?: Span[] } = $props()

  const length = $derived(detail.length)
  const left = (position: number) => `${((position / length) * 100).toFixed(3)}%`
  const width = (span: Span) => `${(((span.end - span.start) / length) * 100).toFixed(3)}%`

  // One block per distinct place of a peptide (the modified forms of a sequence lie on the same one). A
  // protein with hundreds of peptides has them sub-pixel wide, and a thousand blocks are as many nodes
  // to make when the panel opens: past `individually`, the strip draws the stretches that peptides
  // cover, joined across gaps narrower than a pixel (the strip is about 500 px wide), which looks the
  // same at that density.
  const individually = 200

  function joined(spans: Span[]): Span[] {
    const gap = length / 500
    const out: Span[] = []
    for (const s of spans) {
      const last = out[out.length - 1]
      if (last && s.start - last.end <= gap) out[out.length - 1] = { start: last.start, end: s.end }
      else out.push(s)
    }
    return out
  }
  const blocks = $derived.by(() => {
    const seen = new Set<string>()
    const out: Span[] = []
    for (const e of detail.peptides) {
      for (const s of e.spans) {
        const key = `${s.start}:${s.end}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(s)
        if (out.length > individually) return joined(detail.spans)
      }
    }
    return out
  })

  const summary = $derived(
    length === 0
      ? 'The protein has no sequence, so there is no coverage to show.'
      : `Sequence coverage ${(detail.coverage * 100).toFixed(1)} % of ${formatCount(length)} residues, ${detail.sites.length} modified ${detail.sites.length === 1 ? 'site' : 'sites'}.`,
  )
</script>

<div class="mt-2 mb-0.5">
  <div
    class="relative mt-[6px] h-[34px] rounded bg-muted"
    role="img"
    aria-label={summary}
    data-testid="coverage-strip">
    {#if length > 0}
      {#each blocks as span (`${span.start}:${span.end}`)}
        <i
          data-testid="coverage-block"
          class="absolute top-1 h-2.5 min-w-[2px] rounded-[2px] bg-[#93c5fd]"
          style:left={left(span.start)}
          style:width={width(span)}></i>
      {/each}
      {#each selected as span (`${span.start}:${span.end}`)}
        <i
          data-testid="selected-block"
          class="absolute top-[18px] h-3 min-w-[2px] rounded-[2px] bg-[#2a78d6]"
          style:left={left(span.start)}
          style:width={width(span)}></i>
      {/each}
      {#each detail.sites as site (site.position)}
        <b
          data-testid="mod-dot"
          title={siteTitle(site)}
          class="absolute -top-[5px] -ml-[3.5px] size-[7px] rounded-full border-[1.5px] border-white bg-[#1baf7a]"
          style:left={left(site.position + 0.5)}></b>
      {/each}
    {/if}
  </div>
  <div class="mt-0.5 flex items-start justify-between gap-3 text-xs text-muted-foreground" aria-hidden="true">
    <span>1</span>
    <span class="text-center"
      >peptides along the sequence{#if selected.length > 0}&nbsp;· selected peptide below{/if}&nbsp;· <b
        class="mr-0.5 inline-block size-2 rounded-full bg-[#1baf7a] align-[-0.5px]"></b>modified site</span>
    <span>{formatCount(length)}</span>
  </div>
</div>
