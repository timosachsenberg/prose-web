// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { exportSpectrumSvg } from './svg-export'

// A spectrum-like SVG whose look comes partly from the page: a class with a CSS variable, a colour
// that is `currentColor`, the font from an ancestor, and a link to a page outside.
function pageSvg(): SVGSVGElement {
  document.head.innerHTML = `<style>
    :root { --ion-b: #2a78d6 }
    .chart { font-family: 'Inter Variable', sans-serif; color: #3f3f46 }
    .peak-b { stroke: var(--ion-b); stroke-width: 1.75px }
    .muted { fill: #71717a }
  </style>`
  document.body.innerHTML = `<div class="chart">
    <svg id="s" width="640" height="300" viewBox="0 0 640 300" role="img" aria-labelledby="t" class="spectrum" data-testid="spectrum">
      <title id="t">Spectrum of PEPTIDEK</title>
      <path class="peak-b" d="M10 150V20" />
      <text class="muted" x="10" y="12" font-size="11">b2</text>
      <rect fill="currentColor" x="0" y="0" width="4" height="4" />
      <a href="https://example.org/"><text x="40" y="12">link</text></a>
      <image href="https://example.org/logo.png" x="0" y="0" width="8" height="8" />
    </svg>
  </div>`
  return document.getElementById('s') as unknown as SVGSVGElement
}

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('exportSpectrumSvg', () => {
  it('exportSpectrumSvg inlines styles and has no external references', () => {
    const svg = pageSvg()
    const out = exportSpectrumSvg(svg)

    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(out).toContain('width="640"')
    expect(out).toContain('height="300"')
    // the styles of the page are inline: the class's colour, resolved; currentColor as its colour
    expect(out).toMatch(/<path[^>]*style="[^"]*stroke: ?#2a78d6/)
    expect(out).toMatch(/<path[^>]*style="[^"]*stroke-width: ?1\.75px/)
    expect(out).toMatch(/<text[^>]*style="[^"]*fill: ?#71717a/)
    expect(out).toMatch(/<rect[^>]*fill="#3f3f46"/)
    expect(out).toMatch(/<svg[^>]*style="[^"]*font-family: ?(&quot;|')?Inter Variable/)
    // nothing that needs the page or the network
    expect(out).not.toMatch(/class=|var\(|currentColor|url\(|<style|@import|href=|<image|data-testid/)
    expect(out).toContain('<title id="t">Spectrum of PEPTIDEK</title>')
    // the text of the link stays, without the link
    expect(out).toContain('>link</text>')
    // a white background, so that it reads the same on any viewer
    expect(out).toMatch(/<rect x="0" y="0" width="640" height="300" fill="#ffffff"\/>/)
  })

  it('leaves out what only the page shows (a prediction on its way)', () => {
    const svg = pageSvg()
    svg.insertAdjacentHTML('beforeend', '<text x="300" y="200" data-no-export="">Predicting with PeptDeep…</text>')
    const out = exportSpectrumSvg(svg)
    expect(out).not.toContain('Predicting')
    expect(out).toContain('>b2</text>')
  })

  it('leaves the SVG on the page as it is', () => {
    const svg = pageSvg()
    const before = svg.outerHTML
    exportSpectrumSvg(svg)
    expect(svg.outerHTML).toBe(before)
  })
})
