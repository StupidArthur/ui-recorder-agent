# phase2 — Live Agent Capture (in progress)

Phase 2 records what the **OpenCode Agent actually does** through
`chrome-devtools-mcp` / `playwright-mcp`, instead of replaying a scripted
`steps.js` flow.

Phase 1 (`npm run record`) is frozen and untouched. See `../SOLUTION.md` for
Phase 1 and `../PHASE2.md` for the live-capture report.

Current scope: **Phase 2A — Shared Browser PoC only.** No event capture, no
video recorder, no camera/zoom yet (see STOP POINT in the task brief).

## Browser ownership

The Recorder session owns the browser lifetime — not the MCP server:

```
Session owns Chrome  ->  MCP attaches to it  ->  Agent works  ->  session flushes
```

## Files

| File | Purpose |
|---|---|
| `launch-browser.js` | Launch/stop/inspect the dedicated, headed Chrome on a localhost-only CDP endpoint |
| `marker.html` | Home page of the dedicated Chrome (proves which browser is which) |
| `mcp-smoke-test.js` | PoC harness: spawns a real `chrome-devtools-mcp` against our Chrome and drives it |
| `event-recorder.js` | **Phase 2B observer**: connects over CDP, records real interaction events (never controls) |
| `event-recorder.inject.js` | Page-side listener installed into every document (observe-only, fail-safe) |
| `output/sessions/` | Evidence: PoC results, and `events-<ts>/` capture sessions |

## Commands

```bash
npm run phase2:browser          # launch (or reuse) the dedicated Chrome
npm run phase2:inspect          # print endpoint + open pages
npm run phase2:browser:stop     # stop it (PID-scoped, safe)
npm run phase2:smoke            # run the Shared Browser PoC harness
npm run phase2:events           # start the Phase 2B event observer (Ctrl+C to stop)
```

## Live capture — usage order (Phase 2B)

```bash
# Terminal A — own the browser
npm run phase2:browser

# Terminal B — observe only
npm run phase2:events

# Terminal C / OpenCode — let the Agent work normally
#   ... the Agent drives the browser via chrome-devtools-mcp ...

# stop the observer with Ctrl+C in Terminal B (Chrome keeps running)
```

Result: `phase2/output/sessions/events-<timestamp>/` containing
`session.json`, `events.jsonl`, `summary.json`. No video is produced in Phase 2B.

Test aids (not part of normal use): `--duration <sec>`, `--stop-file <path>`, `--heartbeat`.

## Configuration

The debug port is defined in exactly one place — `DEBUG_PORT` in
`launch-browser.js` (currently `9222`). The MCP config in
`~/.config/opencode/opencode.json` hardcodes the matching URL:

```json
"chrome-devtools": {
  "type": "local",
  "command": ["cmd", "/c", "npx", "-y", "chrome-devtools-mcp@latest",
              "--browserUrl", "http://127.0.0.1:9222"],
  "enabled": true
}
```

Change the port in the launcher **and** here together.

## Safety

- The debugging endpoint binds to `127.0.0.1` only (`--remote-debugging-address=127.0.0.1`).
- A dedicated profile is used (`.runtime/chrome-profile`), never the daily Chrome profile.
- `--stop` only kills the PID recorded in `.runtime/browser.json`; it never runs
  `taskkill /IM chrome.exe`.
- Treat this Chrome as a dedicated automation browser — anything running locally
  could control it while remote debugging is on.
