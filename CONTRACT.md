# Herdr Control — Herdr mod contract (v2: full Mono design)

Product: one Herdr control room that shows users every machine, space, agent, terminal, port and approval at a glance, what the agents cost, and lets them jump to any of them with one click.

Live mode draws from Herdr, collector results, and supported commands. Show "—" for missing values. Demo mode uses synthetic fixtures and labels the dashboard **DEMO DATA**.

## Where it lives

- Mod folder: `mods/herdr-control/` (linked as `~/.config/herdr-app/mods/herdr-control`; every save reloads it). `mods/herdr-control/mod.json`: `{ "place": "none" }`.
- Install `mods/herdr-control-tabs/`, `mods/herdr-control-tools/`, and `mods/herdr-control-phrases/` under `mods/` as `herdr-control-tabs`, `herdr-control-tools`, and `herdr-control-phrases`, respectively. Set `HERDR_CONTROL_PHRASES_FILE` in the app's environment to the path of a readable Markdown file for the phrases overlay.
- Full tab: `herdr-app do tab.new '{"mod":"herdr-control","name":"Herdr Control","props":{"screen":"overview"}}'`. `props().screen` picks the first screen and wins over `localStorage`. Screen ids: `overview`, `spaces`, `machines`, `ports`, `agents`, `approvals`. Agents sub-tab: `props().agentsTab` = `now` | `usage` | `catalog`. Close tabs you opened when done.
- Standalone panel: use `layouts/snippets/herdr-control-panel.json` in a personal layout. `props().part = "panel"` gives the block its own dashboard navigation and omits **Back to terminal**. Herdr's own terminal and tab commands handle jumps in the surrounding layout.
- Files:
  - `mods/herdr-control/main.js` — root view, shell (sidebar + top bar), routing.
  - `mods/herdr-control/palette.js` — the Mono palette (see Colors). The only place a color value may be written.
  - `mods/herdr-control/ui.js` — shared pieces: card, hero card, card title row, chip, status dot, bar, progress, mini bar chart, heatmap cell, table row, empty state, "—" helper.
  - `mods/herdr-control/data.js` — pure functions: live data + collector output → view models. No I/O.
  - `mods/herdr-control/source.js` reads dashboard data from Herdr or `demo.js`.
  - `mods/herdr-control/collector.js` — runs the collector, keeps its last result, exposes it (see Collector).
  - `mods/herdr-control/nav.js` — shared-state keys and jumps (exists; keep its API).
  - `mods/herdr-control/screens/*.js` — one module per screen: `overview.js`, `spaces.js`, `machines.js`, `ports.js`, `agents.js` (with the three sub-tabs, may split into `agents-now.js`, `agents-usage.js`, `agents-catalog.js`), `approvals.js`, `aside.js` (terminal right rail).
  - `mods/herdr-control/prices.js` — API list prices (given, do not change).
  - `mods/herdr-control/catalog.js` — the agent catalog definition (see Catalog).
  - `mods/herdr-control/limits.js` — per-machine monthly traffic limits (`TRAFFIC_LIMITS`), empty by default; users configure it.
  - `mods/herdr-control/icons/*.svg`.
  - `mods/herdr-control/collector/collect.py` — the collector source, bundled into packed.js for local and remote runs.

## Platform rules

Use the Herdr and GPUI API declarations in `mods/herdr-control/gpui-kit.d.ts`.

- gpui-kit JavaScript: no HTML, no CSS, no DOM, no `setTimeout`/`setInterval`, no top-level `await`. Look up every builder in `gpui-kit.d.ts` before using it.
- `main.js` default-exports a class extending `View`; `init(props, cx)`, `render(cx)`. Never keep a `cx`.
- Herdr live data re-renders by itself: `spaces()`, `agents()`, `terminals()`, `machines()`, `focused()`. Do not poll these.
- The only timer: `cx.timer.every` for the collector (60 s) and the clock in the top bar (30 s). Nothing else polls.
- Animation only natively (`.loop`, `.frames`, `.transition`). A working agent's dot may pulse with `.loop("opacity", …)`.
- Charts are built from divs (bars, stacked bars, heatmap cells, progress bars, arc → use a horizontal progress bar instead of an SVG arc unless `svg()` with a static file works).

## Colors (replaces the old "only theme()" rule)

The Mono dark palette is defined in `mods/herdr-control/palette.js`.

```
bg #111111   surface #181818   raised #202020
line rgba(255,255,255,.08)   lineStrong rgba(255,255,255,.14)
text #ededed   muted #a3a3a3   mono #bdbdbd   accent #ededed   onAccent #111111
heroBg #e9e6df   heroText #151515   heroMuted #4a4a45   heroGreen #1f8a5a   heroWarn #b37200
ok/running #3ecf8e   warn #f0b429   danger #f25f4c   offline #808080   focus #f0b429
```

- Status → color: working = ok, blocked = warn, done = muted text with a ✓, idle = offline. Every status color is always paired with a word (never color alone).
- No color literal anywhere except `palette.js`. Fonts: Manrope (fallback: the system UI font) for text, JetBrains Mono (fallback: `theme().font` mono or the system monospace) for meta. Sizes 12, 13, 14, 15.5, 18, 32, 72. Radii: card 18, inner 11, chip 8.
- Exactly one hero card per screen (light `heroBg`), as in the design.

## Shell (every screen)

- **Sidebar** (about 232 px, `surface`): product "Herdr Control" and the user line `<username>@<hostname>` (from the collector; hostname alone when the username is unavailable, and "—" until the hostname is known). Items in this order with live badges: Overview, Spaces (space count), Machines (`online/total`), Ports (`N public` = public port count, hidden when unknown), Agents (agent count), Approvals (blocked agent count). Bottom: the Tailnet card (`Tailnet · <tailnet name>`, ping to this machine, `<N> terminals`, `Funnel :<port> open` when a funnel exists — all from the collector, "—" if not), a **Usage** card above the **Streaming mode** switch, the switch itself, and **Back to terminal** (selects the terminal view in the herdr-control layout; in a full tab it runs `terminal.show` on the focused terminal). The Usage card shows Claude, Codex and Antigravity when limits or today’s tokens exist. It uses the newest available limit snapshot per provider and sums tokens across machines. Each row shows the 5h and weekly percent left, the 5h reset countdown, and compact tokens for today. Percent colors are danger below 15%, warn below 30%, and ok otherwise. Missing values show "—". Antigravity tokens use a `~` prefix. In the narrow rail the Usage label opens the same values on hover.
- **Top bar**: left the title `<Screen> · Herdr Control` and below it `<weekday> · <HH:MM>` (local time, English weekday). Right: range chips Today / 14 Days / 30 Days (stored in shared state `herdr-control.range`; screens that show a time range use it), a bell with the blocked-agent count (click → Approvals), and an avatar "HC". The design's ⌘K search box: show it only if it works (filters the current screen's rows by text); otherwise leave it out. Show the **DEMO DATA** chip when demo mode is enabled. Show "estimated" where a value is an estimate.
- Below 900 px wide: sidebar collapses to icons with short labels (as today), top-bar range chips move under the title. Nothing may overflow or overlap.
- **Streaming mode** (`shared("herdr-control.stream")`, kept in localStorage): masks private values everywhere, following the streaming design reference: hostnames → `machine-1`, `machine-2`… (stable order), user line → `•••@machine-1`, tailnet → `••••.ts.net`, IPs → `•••`, avatar → `•••`, SSH fingerprints hidden, folder paths reduced to their last segment. The title loses "· Herdr Control". A small "streaming mode" chip shows in the top bar.

## Collector (`mods/herdr-control/collector/collect.py`)

A Python 3 script (standard library only) that prints one JSON object on stdout and exits 0. The mod runs it locally with `exec("py", ["-3", "<abs path>"], { timeout: 50000 })` on Windows (`python3` on macOS/Linux) every 60 s and on start; a run never overlaps the previous one. With `--light` it does only `system` and `ports`.

### Every machine, not only this one

The panel runs on several computers (this Windows PC, the Mac, servers) and every one of them has its own agents, usage, ports and resources. So the collector runs **on every machine Herdr knows**, not only here:

- How it is sent: the raw script exceeds the Windows command-line limit. After each change, `scripts/pack-collector.py` generates `mods/herdr-control/collector/packed.js` with the minified, LZMA-compressed source and the Python isolation flag. The packer uses Base85 or a denser encoding to leave space for Windows command-line arguments.
- This computer: `exec(<python>, [...prefix, "-I", "-c", COLLECTOR_BOOTSTRAP], { timeout: 50000 })` (no `on`).
- Every other machine in `machines()` whose layout is `ready`: append `--remote` and use `{ on: machine.name, timeout: 50000 }`. The remote profile collects host metrics. Run at most once per machine at a time, every 60 s. Try `python3`, then `py -3`, then `python`, and remember what worked per machine.
- Each result is stored under the machine's name (`null` = this computer) in `shared("herdr-control.collect")` as `{ machines: { "<name|local>": { result, at, error } } }`. A machine that cannot be reached or has no Python keeps its last result with its age, or shows "—" with the reason ("Python unavailable", "unreachable").
- Every row the screens show carries its machine: usage rows, ports, system values, limits. Totals (Overview tokens, Usage and Cost, heat map) are the sum over all machines; a "Machine" filter chip row (All + one chip per machine) can narrow Agents · Usage and Cost. Tables that mix machines show a machine column.
- Tailscale `serve`/funnel status is read on each machine by its own run (ports are classified there). Tailscale peers/ping come from this computer's run only (one view of the tailnet is enough).
- Machines that are only in the tailnet (not Herdr machines, e.g. a phone) show only what tailscale says (online, ping, OS); their usage/ports/resources are "—".
- `--light` is no longer used by the mod; keep the flag for manual tests.
- The same mod runs on the Mac: there "this computer" is the Mac and the PC is a remote machine. Nothing in the mod or the script may assume Windows paths; the script picks paths per OS.

Output (every key always present; a part that failed is `null` plus an entry in `errors`):

```json
{
  "version": 1, "generated_at": "<ISO>",
  "system": { "hostname": "", "username": null, "os": "", "uptime_s": 0, "cpu_pct": 0, "cpu_cores": 0, "cpu_model": "",
              "ram_used_b": 0, "ram_total_b": 0, "disk_used_b": 0, "disk_total_b": 0 },
  "tailscale": { "tailnet": "", "self": { "name": "", "ip": "", "os": "" },
                 "peers": [ { "name": "", "ip": "", "os": "", "online": true, "last_seen": "<ISO|null>", "ping_ms": null } ],
                 "serve": [ { "port": 0, "proto": "https", "target": "" } ], "funnel_ports": [] },
  "ports": [ { "port": 0, "addr": "", "pid": 0, "process": "", "cwd": null, "access": "public|tailnet|local" } ],
  "usage": { "days": [ { "date": "YYYY-MM-DD", "provider": "claude|opencode|codex|antigravity",
                         "model": "", "input": 0, "output": 0, "cache_read": 0, "cache_write": 0,
                         "sessions": 0, "active_s": 0, "project": "" } ] },
  "live": [ { "provider": "antigravity", "since": "<ISO>", "folder": "<optional path>" } ],
  "network": { "source": "vnstat|counters", "ifaces": [""], "days": [ { "date": "YYYY-MM-DD", "rx_b": 0, "tx_b": 0 } ],
               "since": "<ISO>", "resets": 0 },
  "limits": { "claude": { "five": { "remaining": 87.0, "resets_at": 1795214070 }, "week": null,
                          "source": "file", "read_at": 1795197207 },
              "codex": null, "antigravity": null, "opencode": null },
  "installed": { "claude": true, "opencode": true, "codex": false, "agy": true, "pi": false, "gemini": false },
  "errors": [],
  "notes": []
}
```

- `system`: Windows CPU uses two `GetSystemTimes` samples 250 ms apart before the PowerShell metadata and disk query. Windows RAM is total physical memory minus available physical memory from `GlobalMemoryStatusEx`. Linux CPU uses two aggregate `/proc/stat` samples 250 ms apart and RAM is `MemTotal` minus `MemAvailable`. macOS CPU uses the second `top -l 2 -n 0` sample, and RAM is active, wired, and compressor-occupied pages from `vm_stat` multiplied by the page size. The panel derives the RAM percentage from used and total bytes.
- `tailscale`: `tailscale status --json` and `tailscale serve status --json` (Windows: `C:\Program Files\Tailscale\tailscale.exe`). `ping_ms`: `tailscale ping -c 1 --timeout 2s <ip>` only for online peers, in parallel threads, total ≤ 5 s.
- `ports`: listening TCP sockets. Windows `Get-NetTCPConnection -State Listen` + `Get-Process`; macOS `lsof -nP -iTCP -sTCP:LISTEN`; Linux `ss -ltnpH`. `access`: `public` if the port is the target of a funnel entry, `tailnet` if bound to 0.0.0.0/::/a tailscale IP or served without funnel, `local` if bound to 127.0.0.1/::1. Skip system ports < 1024 except 22/80/443, and Windows system processes (`System`, `svchost`, `lsass`, `wininit`, `services`, `spoolsv`).
- `usage`, **incremental**: the cache in `%LOCALAPPDATA%\herdr-control\usage-cache.json` (`~/.cache/herdr-control/` elsewhere) keeps 31 days of completed files. It identifies each file by path hash, size, and modification time, plus SQLite WAL metadata when present. The collector reports pending file counts and skipped oversized records in `notes` and retries unfinished files on the next run. The per-line limit is 8 MiB.
  - Claude Code: `~/.claude/projects/**/*.jsonl` — each assistant line's `message.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`), `message.model`, timestamp; one file = one session; project = the `cwd` field's last folder name. De-duplicate lines by `message.id` + `requestId`.
  - OpenCode: `~/.local/share/opencode/opencode.db` (SQLite, open read-only with `?mode=ro` URI) — look at the schema first; take per-message tokens, model, time, session, project path.
  - Codex: `~/.codex/sessions/**/*.jsonl` `token_count` events if present.
  - Antigravity: read `~/.gemini/antigravity-cli/conversations/*.db` read-only, skipping locked databases and files outside retention. Decode inferred token counts and model enums from `gen_metadata.data`. Rows have `estimated: true`, `active_s: 0`, and the local file modification day because metadata rows have no timestamps. The recent-file signal still supplies background Antigravity entries in `live`.
  - `active_s`: for providers with message timestamps, sum of gaps between consecutive messages that are ≤ 5 min per session.
- `limits`: a provider or individual time window may be `null`. Each available window contains percent remaining (0–100) and a Unix reset time in seconds or `null`. A provider also has `read_at` in Unix seconds and `source` (`file` or `cli`).
  - Claude: `~/.claude/limits-claude.json`, younger than 6 hours.
  - Codex: the most recent rate-limit record in one of the five newest `~/.codex/sessions/**/*.jsonl` logs. Reuse the cached record while the newest log is unchanged. Expired windows show 100% remaining and clear the reset time.
  - Antigravity: the Gemini group of `~/.claude/limits.json`, younger than 1 hour. If the file is missing or stale, fall back to `agy -p /usage --output-format json` with a 20-second timeout and a cache cooldown (3600 s on Windows, 300 s on macOS/Linux), re-probing on newer Antigravity activity at a minimum interval of 60 s, including after a failed probe. Windows requires `HERDR_CONTROL_AGY_PROBE=1` for CLI calls.
  - OpenCode Go: read the latest quota error in the last 2 MiB of `~/.local/share/opencode/log/opencode.log`. A current error yields `{ reached: { window, resets_at }, source: "log" }`, where `window` is `5-hour`, `weekly`, or `monthly` and `resets_at` is Unix seconds. The sidebar Usage card shows the active window and reset date in the danger color and prioritizes it when collapsed. Without an active signal, the limits value is "—".
- `installed`: is the command on PATH (`shutil.which`).
- `network` (monthly traffic, mainly for rented servers with a traffic limit, e.g. 30 TB/month): bytes received/sent per local day for the last 62 days, on the machine's real network interfaces (skip loopback, `tailscale*`, `utun*`, `docker*`, `veth*`, `br-*`, `podman*`, `cni*`, `virbr*`, Hyper-V/WSL `vEthernet*`).
  - Linux with `vnstat` installed (`vnstat --json d`): use its daily totals; `source: "vnstat"` (complete, vnstat runs as a service).
  - Otherwise `source: "counters"`: read the cumulative interface counters (Linux `/proc/net/dev`; macOS `netstat -ib`, `Ibytes`/`Obytes` of `en*`; Windows `Get-NetAdapterStatistics` of physical adapters) and keep the last reading in the cache folder (`network-cache.json`). Each run adds `new - old` to today's row; if a counter went down (reboot or reset) the new value itself is added and `resets` is incremented. Traffic between the last run before a reboot and the reboot is lost; a gap spanning several days is booked on the run's day. `since` = first reading time.
  - `null` + error when neither works.
- Total runtime ≤ 20 s on a warm cache. Never print secrets, tokens or file contents. Never write outside its cache folder.
- `mods/herdr-control/collector.js` keeps the last good result and its time; on failure it keeps the old one and the sidebar shows "data from <N> min ago" in `warn`.

## Prices and estimates

`mods/herdr-control/prices.js` holds USD per million tokens. API estimate = input × in + output × out + cache_read × cache_read_price + cache_write × in × 1.25; a missing cache-read price = 0.1 × input. Models not in the file → "—" (never 0). Every estimate is labeled **estimated**. "Paid by subscription" is not known → "—".

## Screens

Every screen follows its design's layout (grid, card order, sizes). Each card has the design's title. A card with no data shows a designed empty state (one short title + one sentence), not an empty box.

1. **Overview** (`overview`)
   - Hero "Today’s Agent Activity": total tokens today and `<N> working · <N> awaiting a decision · <N> done` from `agents()`. "Agent Timeline" timeline 08:00–20:00: one row per agent now in `agents()` (program name + space), a bar from its tab's `working_since` to now while working; a "now HH:MM" line. Earlier runs of today come from `usage` sessions (start/end) of today, by project. If neither exists: empty state.
   - "Agents · today" (or the selected range): token bars per provider and a token total. Installed providers without recorded tokens show "none" when usage data is available. A `~` marks token values that include Antigravity estimates. "all →" opens Agents.
   - "Machines": `online · total` from tailscale peers + self; rows: name, `online · <ping> ms` or `offline for <N> d` (from `last_seen`), `<N> agents` (agents whose address is on that machine). Herdr machines not in tailscale still appear with their layout state.
   - "Approvals": blocked agents (title = tab title, `program · space · since`), each with **Inspect**. Severity chip: not known → leave it out. "Approved/rejected today": only counts made through this mod's buttons today (kept in localStorage); otherwise leave the line out.
   - "Spaces": one line per space: name, branch (mono), `<N> agents`, status chip.
   - "Ports · risk": counts by access + the public ones listed.
2. **Spaces** (`spaces`): left list of spaces (status, branch, `<N> terminals · <N> agents`, last change from tabs' `changed_at`); right the selected space: name, branch, folder (mono), buttons **Open terminals** (`space.select`) and **Start agent** (`openOverlay` of Herdr's agent picker if one exists in `herdr-app commands`, else leave it out); "Activity over the Last 14 Days" from `usage` rows whose `project` equals the space folder's last segment; pending approval of that space; "Open Terminals" (terminals of the space: address, machine, title, state); "Agents in This Space"; "Ports in Use" (ports whose process `cwd` is inside the space folder; unknown → empty state); "Last 4 Commits": `exec("git", ["-C", folder, "log", "-4", "--format=%h%x09%s%x09%cr"], { on: machine })`.
3. **Machines** (`machines`, with `stream: true` for streaming mode): left list (tailscale self + peers + Herdr machines, merged by name): name, ping, state line, connection path (`Tailscale`, `+ SSH` when it is a Herdr machine, `Funnel` when serving), `<N> agents`, `<N> public ports`. Footer: last collector run time + tailnet name. Right: selected machine — name (mono), IP, OS, uptime, connection path; **Open terminal** (`terminal.open` on that machine if the command accepts a machine; else leave it out); "Resource Usage" CPU/RAM/disk bars from `system` (this computer) or the `--light` run (others), "—" when unreachable; "Latency · last hour": ping samples the mod keeps in memory from each collector run (up to 60), "—" until there are 2; "Monthly Traffic" (from `network`): this period's download/upload and total in TB/GB, a bar against the limit when `mods/herdr-control/limits.js` has one for that machine (`TRAFFIC_LIMITS = { "<machine>": { monthly_tb: 30, count: "total" | "out", billing_day: 1 } }`, TB = 10^12 bytes; empty by default, users configure it), daily bars for the period, and an end-of-period projection (used ÷ elapsed days × period days) labelled "estimated"; the bar turns `warn` at 80% and `danger` at 95% of the limit (or of the projection), and the machine's row in the left list gets the same chip. Under the card, a source line: "vnstat" or "counters · since <since> · <resets> resets (possible gaps)". No `network` → "No traffic data"; "Agents on This Machine"; "Open Ports and Access". SSH fingerprint and location: not available → leave out.
4. **Ports** (`ports`): hero "EXPOSED TO NETWORK" with the number of public ports and, for each, `machine :port → Funnel <port> · process`; when 0, the hero says "No public ports" in green. Table "Ports by Server" grouped by machine (header: ping, counts by access), rows: port (mono), process, space (from cwd, else "—"), access chip, "Duration" only if known (else "—"). Filter chips All / Public only / tailnet / local. Machines whose ports are unknown: one line "No port data".
5. **Agents** (`agents`) — sub-tabs Now / Usage and Cost / Catalog.
   - **Now** (`now`): hero "Working now" table of `agents()`: agent (program name, `#n` when several of the same program), model ("—" unless known), space, machine, status, duration (from `working_since`, else "—"), context ("—"). Row click → focus agent. "Provider Quotas": 5h and weekly percent remaining from `limits`, plus the 5h reset countdown when available. "Unused Agents": installed programs with 0 sessions in 14 days. "14-Day Usage Heatmap": hours per provider per day from `usage`, with five buckets. Antigravity has no recorded activity duration.
   - **Usage and Cost** (`usage`): hero "Estimated API Cost" = sum of estimates over the range, "estimated", total tokens; "paid by subscription" "—". "Daily Token Usage": stacked bars per day per provider. "Usage and Cost by Agent": provider, models, input, output, cache read, sessions, total tokens, API estimate, payment ("subscription" for claude/opencode, "—" otherwise). "Activity": top 6 projects by tokens (project, provider, tokens, estimate). "Share by Space": token share per project. Token figures that include Antigravity estimates are prefixed with `~`.
   - **Catalog** (`catalog`): from `mods/herdr-control/catalog.js` (a definition, labeled "definition" in the card subtitle) joined with live state: `installed`, last session time from `usage`, running now from `agents()`. Hermes agents are listed from the catalog with state "—" (no live source). "Run health check" runs `<cmd> --version` via `exec` and shows success or an error; no other health claims.
6. **Approvals** (`approvals`): list of blocked agents (program, space, tab title, since). **Inspect** → focus the agent and show the terminal. For agents whose `program.key` is `claude`: **Approve** = `hc(["keys", address, "enter"])`, **Reject** = `hc(["keys", address, "esc"])`, each only after an inline confirm step ("Are you sure?" → Yes) and only while the agent is still `blocked`. Other programs: Inspect only. Empty: "No pending approvals".
7. **Terminal right rail** (`terminal`, part `aside`): for the active space: "Agents in this space", "Ports in this space", "Awaiting approval" (with Inspect/Approve/Reject as above). The terminal panes themselves are Herdr's own, not drawn by the mod.

## Live and demo data

- Live mode omits missing values or displays "—". Estimates are labeled "estimated" and definitions are labeled "definition".
- `herdr-control.toggle-demo` switches the shared key `herdr-control.demo`. Demo renders fixtures and blocks new collector runs, process-backed actions, and navigation to native terminal contents. The tab bar and Phrasebook use the demo fixtures published in shared state.
- Status words map exactly: working = Working, blocked = Awaiting a decision, done = Done, idle = Idle.
- Not available and not shown: OpenCode Go quota percentages, context usage, model of a live agent (unless the agent's title states it), SSH fingerprints, location, approval severity.

## Screenshot commands

With the Herdr Control layout, standalone panel, or dashboard tab visible, run `herdr-app do herdr-control.<command>`. The commands work with live data and demo data. For example, `herdr-app do herdr-control.goto-machines` opens Machines.

| Command | Effect |
| --- | --- |
| `toggle-demo` | Switch between live and synthetic data. |
| `goto-overview`, `goto-spaces`, `goto-machines`, `goto-ports`, `goto-approvals` | Open the named screen. Machines defaults to `build-server` in demo mode. |
| `goto-agents-now`, `goto-agents-usage`, `goto-agents-catalog` | Open Agents on the named tab. |
| `stream-on`, `stream-off` | Set streaming mode on or off. |
| `usage-expand`, `usage-collapse` | Set the sidebar Usage card's expanded or collapsed state. In the narrow rail, expanded usage details are available on hover. |

## Herdr Control layout (replaces Herdr's own sidebar)

- `layouts/herdr-control.json` (copied to `~/.config/herdr-app/layouts/herdr-control.json`): the left sidebar uses `props.part = "nav"`. The work area has the cloned tab bar (`herdr-control-tabs`), the `work-stack`, and a status bar (`props.part = "status"`). The stack switches between `terminal` (Herdr's active tab panes, a 300px right rail with `props.part = "aside"`, and Files/Changes) and `screen` (the dashboard with `props.part = "content"`).
- Nav part: the sidebar above. The layout starts on `screen` with Overview; entering the layout resets shared state to that. Clicking a screen sets `shared("herdr-control.screen")`, `shared("herdr-control.view") = "screen"` and runs `layout.select {stack: "work-stack", child: "screen"}`. Back to terminal selects `terminal`.
- Content part: shows `shared("herdr-control.screen")` with the top bar, without the sidebar. A jump (agent focus, terminal show, space select) also selects `terminal` (`mods/herdr-control/nav.js`).
- Without `part` the mod is the full tab with sidebar and top bar.
- Ctrl+Shift+H: `layout.switch {name: "herdr-control"}`.
- Tab bar: `herdr-control-tabs`, a clone of Herdr's `tabs` mod (`mods/herdr-control-tabs/`); its `toTerminal()` brings the terminal view to the front. After a Herdr update, re-clone `tabs` and re-apply `toTerminal()`.
- The nav part runs the collector in the full layout. Outside it, a standalone panel or full tab can run collection. The other layout parts read results through `shared("herdr-control.collect")`.

## Done means

1. `herdr-app check mods/herdr-control` exits 0 after every change. `py -3 mods/herdr-control/collector/collect.py` exits 0 and prints valid JSON. Run `python -m unittest discover -s mods/herdr-control/collector` for the collector tests.
2. No error in `herdr-app status` with the tab and the herdr-control layout open.
3. A screenshot of every screen and sub-tab (`herdr-app shot reports/screenshots/<name>.png`), plus Machines in streaming mode, plus one below 900 px if the window can be resized. Look at each; fix anything cut off, overlapping, unreadable or showing a design sample value.
4. A short report: files written, what real values each screen showed, what is "—" and why.
