window.addEventListener('error', event => {
  console.error(event.message)
  if (!document.querySelector('.sidebar')) {
    document.getElementById('app').textContent = 'Awaker could not load. Refresh the page to try again.'
  }
})
