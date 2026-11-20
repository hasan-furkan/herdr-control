# Install Herdr Control

Read the user's Herdr app `AGENTS.md` first. Use its config directory, normally `~/.config/herdr-app`. Herdr desktop needs JavaScript mods, layouts, and peer `exec` support. Live collection requires Python 3.9+ on the local machine and each monitored peer. Demo data needs no Python.

[Layout illustration (demo data)](preview.png)

## Layout

- `root` is a row. `sidebar` is a 232px block with Herdr Control navigation, a Terminals list, Tailnet and Usage cards, Streaming mode, and Back to terminal.
- `work` is a column. `tabs` is the 42px tab bar. `work-stack` starts at `screen`, the dashboard with its top bar and Overview, Spaces, Machines, Ports, Agents, and Approvals views.
- `terminal`, the other stack child, holds `main` for the active tab's native panes, `aside` for the 300px agents, ports, and approvals rail, and `panel` for Herdr's Files and Changes in `panel-body`. Both side panels start hidden.
- `status` is the 28px status bar with the machine, branch, and agent counts.

`herdr-control` provides the dashboard, collection, sidebar, rail and status. `herdr-control-tabs` provides tab navigation and Files/Changes controls. `herdr-control-tools` opens Herdr shortcuts and the demo toggle. `herdr-control-phrases` opens a read-only Markdown phrasebook. The two overlays are available with `herdr-app do mod.open --name herdr-control-tools` or `--name herdr-control-phrases`.

## First install

1. Check all four destination mod names in `<config>/mods/` before writing. Reuse an existing Herdr Control installation or use the update procedure below. If a name belongs to unrelated content, ask before proceeding.
2. Copy the four directories under this repository's `mods/` into `<config>/mods/` under the same names. Exclude `catalog.local.js` and Python cache files from the source copy.
3. Copy `layouts/herdr-control.json` into `<config>/layouts/`. If that filename is taken, use an unused name such as `herdr-control-gallery.json`. Ask before overwriting an existing layout. Copy the whole layout as one file and keep the node IDs and mod references.
4. Switch with `herdr-app do layout.switch --name herdr-control`, substituting the filename stem chosen above. Leave the previous layout available.

## Update

1. Back up the four destination mod folders. Check for symlinks or junctions and preserve their targets when replacing the installed folders. Stage and validate the four replacement folders before swapping them in. Restore from the backup if the swap fails.
2. Replace only those four mod folders. Restore the user's `herdr-control/catalog.local.js` into its original location and reapply any custom `TRAFFIC_LIMITS` entries to the new `limits.js`.
3. Keep the selected layout, all layout files and saved layout state, settings, keys, and unrelated mods. If the user explicitly requests a layout change, merge by node ID and reuse existing nodes.

## Options and uninstall

- Set `HERDR_CONTROL_PHRASES_FILE` in Herdr's environment for the phrasebook. On Windows, `HERDR_CONTROL_AGY_PROBE=1` enables the optional Antigravity quota probe. Customize traffic policies in `herdr-control/limits.js` and the agent roster in `herdr-control/catalog.local.js` under the installed `mods/` directory.
- For screenshots, use the Tools overlay's **Herdr Control: Toggle demo data** or run `herdr-app do herdr-control.toggle-demo` while Herdr Control is visible. Run it again to resume live collection. The top bar shows **DEMO DATA** while enabled.
- To uninstall, switch to the prior layout. Back up local mod settings and the installed layout. Remove only the layout file created during install and the four installed mod folders once no other layout refers to them. Remove an installed link by its name while preserving its target.
