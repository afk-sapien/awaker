// One entry point for both ways of running Awaker. Without an account it serves
// the dashboard, which runs in the browser. With SLEEPER_USERNAME set it also
// runs the API and the background reports for that account.
import {config} from './config.js'

const entry = config().username ? './main.js' : './preview.js'
await import(entry)
