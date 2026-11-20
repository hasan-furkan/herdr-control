# Local agent catalog

`mods/herdr-control/catalog.js` ships with generic catalog entries. To customize the catalog, copy it to `mods/herdr-control/catalog.local.js`, remove the `loadCatalog` function from the copy, and edit the exported `CATALOG` array. When the local module is available, its array replaces the default.

Each group has a stable `group` ID, a `title`, a `subtitle`, and an `agents` array. Each agent has an `id` and a display `name`. Set `installedKey` to a collector key and `provider` to a usage provider to join live data. Use `appKeys` to match the agent's Herdr program. Set `cmd` only for a trusted executable that supports `--version`. Roles and rights describe the entry.

Keep `mods/herdr-control/catalog.local.js` out of commits and distribution archives. Include it when transferring your configuration privately.

## Streaming mode

Streaming mode masks machine and tailnet names, network addresses, usernames, space and project names, folder paths, terminal and agent titles, terminal command lines, git branches and commit details, command output and errors, process names, deployment-specific catalog details, and raw Docker labels. Parsed Docker port numbers and dashboard counts remain visible.

Herdr draws native terminal contents, pane headers, and other built-in panels separately. Use a Herdr Control dashboard screen when sharing the dashboard.
