// Generic catalog definitions. Copy this file to catalog.local.js to customize them.
// Descriptive fields are labels. Only cmd, when set, is used for a version check.

export const CATALOG = [
  {
    group: "local",
    title: "Local Agents",
    subtitle: "Generic examples",
    agents: [
      {
        id: "claude", name: "Claude Code", model: "—",
        roles: [], rights: {},
        cmd: "claude", installedKey: "claude", provider: "claude", appKeys: ["claude"],
      },
      {
        id: "codex", name: "Codex", model: "—",
        roles: [], rights: {},
        cmd: "codex", installedKey: "codex", provider: "codex", appKeys: ["codex"],
      },
      {
        id: "opencode", name: "OpenCode", model: "—",
        roles: [], rights: {},
        cmd: "opencode", installedKey: "opencode", provider: "opencode", appKeys: ["opencode"],
      },
    ],
  },
];

export async function loadCatalog() {
  try {
    // Resolve at runtime so the optional file is absent in a clean install.
    const path = "./catalog.local.js";
    const local = await import(path);
    return Array.isArray(local.CATALOG) ? local.CATALOG : CATALOG;
  } catch {
    return CATALOG;
  }
}
