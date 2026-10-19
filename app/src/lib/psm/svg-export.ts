// "Export spectrum (SVG)": the spectrum as a standalone SVG file. What the page's CSS gives the chart
// (classes, CSS variables, `currentColor`, the font of an ancestor) is written into inline styles, and
// nothing in the file refers to the page or the network: no classes, no stylesheet, no links, no images.
// Elements marked `data-no-export` (states of the page, like a prediction on its way) are left out.

const SVG_NS = 'http://www.w3.org/2000/svg'

/** The properties that make the look of the chart. */
const STYLE_PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'paint-order',
  'visibility',
] as const

/** Properties an element does not inherit from its parent: written when they are not the initial value. */
const NOT_INHERITED: Record<string, string> = { opacity: '1' }

/** Attributes that only matter on the page. */
const PAGE_ONLY = /^(class|style|tabindex|data-.*|on.*|aria-(?!label$|labelledby$|describedby$).*)$/

function unresolved(value: string): boolean {
  return value.includes('var(') || value.includes('url(')
}

function resolveColor(value: string, color: string): string {
  return value === 'currentColor' || value === 'currentcolor' ? color : value
}

/**
 * The SVG `svg` (a chart on the page) as the text of a standalone SVG file, with the page's styles
 * inline and without external references. The SVG on the page is not changed.
 */
export function exportSpectrumSvg(svg: SVGSVGElement): string {
  const view = svg.ownerDocument.defaultView
  const styleOf = (el: Element) => view!.getComputedStyle(el)
  const clone = svg.cloneNode(true) as SVGSVGElement

  // walk the page's elements and their copies side by side
  const originals = [svg as Element, ...Array.from(svg.querySelectorAll('*'))]
  const copies = [clone as Element, ...Array.from(clone.querySelectorAll('*'))]
  // what only the page shows, found before its attributes go
  const pageOnly = Array.from(clone.querySelectorAll('[data-no-export]'))
  const computed = new Map<Element, CSSStyleDeclaration>()
  for (const el of originals) computed.set(el, styleOf(el))

  originals.forEach((el, i) => {
    const copy = copies[i]
    const style = computed.get(el)!
    const parent = el === svg ? null : computed.get(el.parentElement!) ?? null
    const color = style.getPropertyValue('color') || '#000000'
    const inline: string[] = []
    for (const property of STYLE_PROPERTIES) {
      const attribute = copy.getAttribute(property)
      if (attribute !== null && !unresolved(attribute) && attribute !== 'currentColor') continue // the attribute says it
      let value = resolveColor(style.getPropertyValue(property).trim(), color)
      if (value === '' && attribute === 'currentColor') value = color
      if (value === '' || unresolved(value)) continue
      if (attribute !== null) {
        copy.setAttribute(property, value)
        continue
      }
      const initial = NOT_INHERITED[property]
      if (initial !== undefined ? value === initial : parent !== null && resolveColor(parent.getPropertyValue(property).trim(), color) === value) continue
      inline.push(`${property}: ${value}`)
    }
    for (const name of copy.getAttributeNames()) {
      const value = copy.getAttribute(name) ?? ''
      if (PAGE_ONLY.test(name) || unresolved(value) || value === 'currentColor') copy.removeAttribute(name)
    }
    if (inline.length > 0) copy.setAttribute('style', inline.join('; '))
  })

  // what only the page shows (e.g. "Predicting with PeptDeep…"), no links, no images, no stylesheets or
  // scripts: a link keeps its content
  for (const el of pageOnly) el.remove()
  for (const el of Array.from(clone.querySelectorAll('a'))) el.replaceWith(...Array.from(el.childNodes))
  for (const el of Array.from(clone.querySelectorAll('image, use, style, script, foreignObject'))) el.remove()
  for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const name of el.getAttributeNames()) if (/href$/i.test(name)) el.removeAttribute(name)
  }

  // the size of the chart on the page, a viewBox, and a white background behind everything (the
  // serializer declares the SVG namespace)
  const box = svg.getBoundingClientRect()
  const width = svg.getAttribute('width') ?? String(Math.round(box.width))
  const height = svg.getAttribute('height') ?? String(Math.round(box.height))
  clone.setAttribute('width', width)
  clone.setAttribute('height', height)
  if (!clone.hasAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`)
  const background = svg.ownerDocument.createElementNS(SVG_NS, 'rect')
  for (const [name, value] of [['x', '0'], ['y', '0'], ['width', width], ['height', height], ['fill', '#ffffff']]) {
    background.setAttribute(name, value)
  }
  const first = Array.from(clone.children).find((c) => c.localName !== 'title' && c.localName !== 'desc') ?? null
  clone.insertBefore(background, first)

  const text = new (view!.XMLSerializer)().serializeToString(clone)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${text}\n`
}
