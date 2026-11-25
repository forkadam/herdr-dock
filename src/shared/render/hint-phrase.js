// In both of Render's hint texts (hints.js: HINT, REMINDER): how a session's log shows the hint arrived
// (transcript.js, hintReach). Its own module, so mods that read transcripts don't bundle the hint texts.
export const HINT_PHRASE = "Render panel beside this terminal";

// Where the hint hook records each prompt run, under the app home: <this>/<session id>/<prompt id>.json (render-hint.js
// writes, the Render helper reads). One name for both, so they can't drift apart.
export const HINT_RUNS = "herdr-dock/hint-runs";
