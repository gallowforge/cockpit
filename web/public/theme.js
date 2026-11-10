// Names the theme on the root before the first paint, so the page never opens
// in the wrong one. src/theme.ts keeps it right from there on and holds the
// same key and the same two ground colours. A file of its own because the
// content security policy allows no inline script.
(function () {
  var mode = null
  try { mode = localStorage.getItem('vesper:theme') } catch (e) { /* storage is off: follow the device */ }
  var day = mode === 'light' || (mode !== 'dark' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches)
  document.documentElement.dataset.theme = day ? 'light' : 'dark'
  var ground = document.querySelector('meta[name="theme-color"]')
  if (ground) ground.setAttribute('content', day ? '#eef2ec' : '#060d0a')
})()
