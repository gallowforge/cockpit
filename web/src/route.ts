// Pages live at #/name. Anything else after the # is not an address of ours (a marker another site appended to
// the link, such as the #gh-dark-mode-only GitHub puts on README links), so it opens the overview instead of
// "Page not found".
export function routeOf(hash: string): string[] {
  if (!hash.startsWith('#/')) return []
  return hash.slice(2).split('/').filter(Boolean).map(decodeURIComponent)
}
