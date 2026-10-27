// A page served from a static host has no service behind it to ask about settings, and no
// notifications page to send anyone to. It says so with <meta name="awaker:mode" content="static">,
// which is read here because this is the one script on the page that is not a module, so it runs
// before app.js and can leave what it read for the app to pick up.
window.awaker = {staticMode: document.querySelector('meta[name="awaker:mode"]')?.content === 'static'}

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
