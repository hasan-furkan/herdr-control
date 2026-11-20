# Install Herdr Control

Read the user's Herdr app `AGENTS.md` first. Use its config directory, normally `~/.config/herdr-app`. Herdr desktop needs JavaScript mods, layouts, and peer `exec` support. Live collection requires Python 3.9+ on the local machine and each monitored peer. Demo data needs no Python.

[Layout illustration (demo data)](preview.png)

Ask the user to choose **Option A: Layout** or **Option B: Mod only** if their request leaves the choice open.

## Option A: Layout

### Layout

- `root` is a row. `sidebar` is a 232px block with Herdr Control navigation, a Terminals list, Tailnet and Usage cards, Streaming mode, and Back to terminal.
- `work` is a column. `tabs` is the 42px tab bar. `work-stack` starts at `screen`, the dashboard with its top bar and Overview, Spaces, Machines, Ports, Agents, and Approvals views.
- `terminal`, the other stack child, holds `main` for the active tab's native panes, `aside` for the 300px agents, ports, and approvals rail, and `panel` for Herdr's Files and Changes in `panel-body`. Both side panels start hidden.
- `status` is the 28px status bar with the machine, branch, and agent counts.

`herdr-control` provides the dashboard, collection, sidebar, rail and status. `herdr-control-tabs` provides tab navigation and Files/Changes controls. `herdr-control-tools` opens Herdr shortcuts and the demo toggle. `herdr-control-phrases` opens a read-only Markdown phrasebook. The two overlays are available with `herdr-app do mod.open --name herdr-control-tools` or `--name herdr-control-phrases`.

### First install

1. Check all four destination mod names in `<config>/mods/` before writing. Reuse an existing Herdr Control installation or use the update procedure below. If a name belongs to unrelated content, ask before proceeding.
2. Copy the four directories under this repository's `mods/` into `<config>/mods/` under the same names. Exclude `catalog.local.js` and Python cache files from the source copy.
3. Copy `layouts/herdr-control.json` into `<config>/layouts/`. If that filename is taken, use an unused name such as `herdr-control-gallery.json`. Ask before overwriting an existing layout. Copy the whole layout as one file and keep the node IDs and mod references.
4. Switch with `herdr-app do layout.switch --name herdr-control`, substituting the filename stem chosen above. Leave the previous layout available.

### Update

1. Back up the four destination mod folders. Check for symlinks or junctions and preserve their targets when replacing the installed folders. Stage and validate the four replacement folders before swapping them in. Restore from the backup if the swap fails.
2. Replace only those four mod folders. Restore the user's `herdr-control/catalog.local.js` into its original location and reapply any custom `TRAFFIC_LIMITS` entries to the new `limits.js`.
3. Keep the selected layout, all layout files and saved layout state, settings, keys, and unrelated mods. If the user explicitly requests a layout change, merge by node ID and reuse existing nodes.

### Options and uninstall

- Set `HERDR_CONTROL_PHRASES_FILE` in Herdr's environment for the phrasebook. On Windows, `HERDR_CONTROL_AGY_PROBE=1` enables the optional Antigravity quota probe. Customize traffic policies in `herdr-control/limits.js` and the agent roster in `herdr-control/catalog.local.js` under the installed `mods/` directory.
- For screenshots, use the Tools overlay's **Herdr Control: Toggle demo data** or run `herdr-app do herdr-control.toggle-demo` while Herdr Control is visible. Run it again to resume live collection. The top bar shows **DEMO DATA** while enabled.
- To uninstall, switch to the prior layout. Back up local mod settings and the installed layout. Remove only the layout file created during install and the four installed mod folders once no other layout refers to them. Remove an installed link by its name while preserving its target.

## Option B: Mod only

### First install

1. Identify the user's current layout file in `<config>/layouts/` (see `herdr-app status`). Back it up before editing and place the backup outside the set of active layout JSON files. If the current layout ships with Herdr, ask whether to duplicate it for a persistent panel or use the on-demand tab below. Herdr restores its shipped layout files on startup.
2. Copy only `mods/herdr-control` into `<config>/mods/`. Reuse an existing Herdr Control installation or follow the update procedure below. Ask before replacing unrelated content with the same name. Exclude `catalog.local.js` and Python cache files from the source copy.
3. Search the target layout for a block with `content.mod` set to `herdr-control`. If one exists, update that node in place to use `content.props.part` set to `panel`, keeping its ID and placement. If there are multiple matches, ask which single node to update. Otherwise, insert exactly one copy of [the panel node](layouts/snippets/herdr-control-panel.json) into an existing `row`'s `children`, beside the active-tab area on the requested side. Choose an unused ID if `herdr-control-panel` is already taken.
4. Keep every other layout node and field, saved layout state, settings, key bindings, and other mods intact. Validate the edited JSON and run `herdr-app check` on the installed mod.

The user can show or hide the block with `herdr-app do layout.toggle --id herdr-control-panel`. Use the actual node ID if it differs. If the user configures their own shortcut, an example entry under `layout:<name>` in `keys.json` is `"ctrl-alt-h": {"command":"layout.toggle","args":{"id":"herdr-control-panel"}}`.

For the on-demand tab, install the same mod folder and run `herdr-app do tab.new --mod herdr-control --name "Herdr Control"`. Use the layout's own tabs to switch away or close the dashboard tab when finished.

### Update and uninstall

- To update, back up and replace only the `herdr-control` mod folder. Preserve any link target, restore the user's `catalog.local.js`, and reapply their custom `TRAFFIC_LIMITS` entries. Keep the existing panel node and layout settings.
- To uninstall, back up the layout and local mod settings, then remove only the installed panel node. Close any Herdr Control tabs. Remove the `herdr-control` folder once no other layout uses it. For a symlink or junction, remove the link and preserve its target.
