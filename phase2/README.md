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
| `output/sessions/` | PoC evidence (checks + screenshot) |

## Commands

```bash
npm run phase2:browser          # launch (or reuse) the dedicated Chrome
npm run phase2:inspect          # print endpoint + open pages
npm run phase2:browser:stop     # stop it (PID-scoped, safe)
npm run phase2:smoke            # run the Shared Browser PoC harness
```

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
