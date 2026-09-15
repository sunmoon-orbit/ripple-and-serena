// scrollHeight includes padding, NOT borders. Assigning it directly to a
// border-box textarea manufactured overflow (and the global translucent thumb).
export function sizeComposer(node, style = getComputedStyle(node)) {
  node.style.height = 'auto'
  node.style.overflowY = 'hidden'
  const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
  // CSS line heights can be fractional while scrollHeight is rounded to an
  // integer. One extra pixel prevents subpixel clipping across themes/fonts.
  const natural = Math.ceil(node.scrollHeight + borders + 1)
  const max = parseFloat(style.maxHeight) || 120
  node.style.height = `${Math.min(natural, max)}px`
  node.style.overflowY = natural > max ? 'auto' : 'hidden'
}
