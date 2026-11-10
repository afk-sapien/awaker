// Every third party this app may be told not to reach, in one place, with the switch that turns it
// off. Sleeper is not one of the switches: without it there is no app. Everything else is opt-out
// and on by default, because a self-hosted dashboard's owner is the one deciding, and off is one
// file or one PUT away.
//
// kind says what a source is reached for, which is why this is not a list of news sources. The news
// read reports the news sources and nothing else; a host file and the service settings offer every
// switch here. dist/origins.js names the origin behind each key, so turning off the last source
// reaching an origin takes that origin out of the policy a host has to write.
//
// Adding a key here adds a switch everywhere at once: dist/site.json, the service settings, and the
// content security policy. Nothing outside this file can name a source, point one somewhere else,
// or switch one on.
export const SOURCES = {
  sleeper: {name: 'Sleeper', description: 'Sleeper player record', kind: 'news', always: true},
  espnNews: {name: 'ESPN', description: 'ESPN league news', kind: 'news', always: false},
  espnScoreboard: {name: 'ESPN', description: 'NFL game status: kickoff, quarter, clock and score', kind: 'games', always: false}
}
export const SOURCE_SWITCHES = Object.keys(SOURCES).filter(key => !SOURCES[key].always)
export const NEWS_SOURCES = Object.keys(SOURCES).filter(key => SOURCES[key].kind === 'news')
// Off wins. A static host and a service can both hold an opinion, and either one saying off is off.
export const sourceEnabled = (source, ...configs) =>
  SOURCES[source]?.always === true || configs.every(config => !config || config[source] !== false)
