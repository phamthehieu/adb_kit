/**
 * Icon-only buttons carry their meaning in `title` only; assistive tech and voice control need an
 * accessible name. Give every such button `aria-label = title`. Runs at most twice a second so a
 * streaming Logcat does not pay for it.
 */
function nameIconButtons(): void {
  for (const b of document.querySelectorAll<HTMLElement>('button:not([aria-label])')) {
    if (!b.textContent?.trim() && b.title) b.setAttribute('aria-label', b.title)
  }
}

export function startA11y(): void {
  let timer: number | undefined
  const schedule = (): void => {
    if (timer !== undefined) return
    timer = window.setTimeout(() => {
      timer = undefined
      nameIconButtons()
    }, 500)
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  schedule()
}
