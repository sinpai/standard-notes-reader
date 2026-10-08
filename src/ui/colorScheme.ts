/**
 * Standard Notes themes only provide colors, so native controls (scrollbars, selects, checkboxes)
 * are switched to dark mode by looking at how light the themed background is.
 */
export function updateColorScheme(): void {
  const root = document.documentElement
  const background = getComputedStyle(document.body).backgroundColor
  const channels = background.match(/[\d.]+/g)?.map(Number)
  if (!channels || channels.length < 3) {
    return
  }
  const [red, green, blue] = channels as [number, number, number]
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
  root.style.colorScheme = luminance < 0.5 ? 'dark' : 'light'
}
