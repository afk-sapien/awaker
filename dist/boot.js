// Shows a way out instead of "Loading Awaker…" forever when the app script, or a module it imports, fails.
function failed(message) {
  if (message) console.error(message)
  if (!document.querySelector('.sidebar')) {
    document.getElementById('app').textContent = 'Awaker could not load. Refresh the page to try again.'
  }
}
// A script that fails to download fires error on its own element, which only a capturing listener sees.
window.addEventListener('error', event => {
  if (event.target instanceof HTMLScriptElement) failed(`Could not load ${event.target.src}`)
  else if (!(event.target instanceof Element)) failed(event.message)
}, true)
window.addEventListener('unhandledrejection', event => failed(event.reason?.message || String(event.reason)))
