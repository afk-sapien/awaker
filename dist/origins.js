// Every origin outside this one that the app reaches, declared in one place. The service builds its
// Content-Security-Policy from this list rather than transcribing it, so the policy the browser is
// handed and the code it governs cannot drift apart, and anything hosting this dashboard elsewhere
// can generate its own policy from the same list.
//
// It is also the record of what the app talks to. Adding a third party here is a visible diff in a
// four line file, which is the point: tests/origins.test.js fails if a module reaches an origin that
// is not declared, so a new one cannot arrive quietly inside a module nobody is reading.
//
// img and connect name the CSP directives the page needs. service is reached by the Node service on
// the owner's behalf and never by the page, so it is listed for completeness and stays out of the
// policy the browser enforces.
export const requiredOrigins = {
  img: ['https://sleepercdn.com'],
  connect: ['https://api.sleeper.app', 'https://site.api.espn.com'],
  service: ['https://ntfy.sh']
}
