// The arithmetic of the virtualized tables: rows of one fixed height, under a sticky header, in a
// scroll box. Only the rows in view (plus a few) are in the DOM.

/** The rows to render: those in the viewport and `overscan` more on either side (`end` exclusive). */
export function visibleRange(
  scrollTop: number,
  height: number,
  rowHeight: number,
  count: number,
  overscan: number,
): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + overscan)
  return { start: Math.min(start, end), end }
}

/**
 * The row a key moves the focus to: ArrowUp/ArrowDown by one, PageUp/PageDown by `pageSize`,
 * Home/End to the ends. null: not a navigation key, or no rows.
 */
export function keyTarget(key: string, current: number, count: number, pageSize: number): number | null {
  if (count === 0) return null
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i))
  switch (key) {
    case 'ArrowDown':
      return clamp(current + 1)
    case 'ArrowUp':
      return clamp(current - 1)
    case 'PageDown':
      return clamp(current + pageSize)
    case 'PageUp':
      return clamp(current - pageSize)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * The scroll position that shows row `index` whole below a sticky header of `headerHeight` in a box
 * of `height`: unchanged if it is in view, else just enough to bring it in.
 */
export function scrollToShow(index: number, scrollTop: number, height: number, rowHeight: number, headerHeight: number): number {
  const top = index * rowHeight
  const bottom = top + rowHeight
  const body = height - headerHeight
  if (top < scrollTop) return top
  if (bottom > scrollTop + body) return bottom - body
  return scrollTop
}
