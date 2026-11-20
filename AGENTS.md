# Contributor instructions

- Read [CONTRACT.md](CONTRACT.md) before changing the mod or layout.
- Use English for repository file names, code, comments, and documentation.
- Keep personal data out of code, tests, screenshots, and documentation.
- Run the checks in [README.md](README.md#development). Check changed JavaScript with `node --check`.
- Regenerate `mods/herdr-control/collector/packed.js` with `python scripts/pack-collector.py` after collector changes. Never edit it by hand.
- Keep demo mode synthetic. Use fixtures for the dashboard, and prevent live system reads and process-backed actions in demo mode.
