// Pure view-model transformations over live Herdr and collector data. No I/O.

import { statusWord, statusColor as paletteStatusColor } from "./palette.js";

const MAX_COLLECTOR_STRING = 500;
const MAX_COLLECTOR_ROWS = 2000;
const MAX_PROBE_TEXT = 256 * 1024;
export const INVALID_COLLECTOR_RESULT = "Invalid collector data";

const boundedString = (value) =>
  typeof value === "string" && value.length <= MAX_COLLECTOR_STRING ? value : undefined;
const boundedNumber = (value, max = Number.MAX_SAFE_INTEGER) =>
  Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;
const counter = (value) => boundedNumber(value);
const integer = (value) => Number.isSafeInteger(value) ? value : undefined;
const portNumber = (value) => Number.isInteger(value) && value > 0 && value <= 65535 ? value : undefined;
const percent = (value) => boundedNumber(value, 100);
const boolean = (value) => typeof value === "boolean" ? value : undefined;
const oneOf = (...values) => (value) => values.includes(value) ? value : undefined;
const dateString = (value) =>
  boundedString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    ? value : undefined;
const dateTime = (value) =>
  boundedString(value) && Number.isFinite(Date.parse(value)) ? value : undefined;
const timestamp = (value) => dateTime(value) ?? boundedNumber(value, 8.64e15);
const probeText = (value) =>
  typeof value === "string" && value.length <= MAX_PROBE_TEXT ? value : undefined;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function objectOf(fields, required = []) {
  return (value) => {
    if (!record(value)) return undefined;
    const entries = [];
    for (const [key, validate] of Object.entries(fields)) {
      if (!Object.hasOwn(value, key)) continue;
      const clean = validate(value[key]);
      if (clean !== undefined) entries.push([key, clean]);
    }
    const clean = Object.fromEntries(entries);
    return entries.length && required.every((key) => Object.hasOwn(clean, key)) ? clean : undefined;
  };
}

function arrayOf(validate) {
  return (value) => {
    if (!Array.isArray(value) || value.length > MAX_COLLECTOR_ROWS) return undefined;
    const clean = value.map(validate).filter((item) => item !== undefined);
    return value.length === 0 || clean.length > 0 ? clean : undefined;
  };
}

const peerFields = { name: boundedString, ip: boundedString, os: boundedString };
const sshHosts = arrayOf(objectOf({ alias: boundedString, hostname: boundedString }, ["alias", "hostname"]));
const provider = oneOf("claude", "codex", "opencode", "antigravity");
const limitWindow = objectOf({ remaining: percent, resets_at: counter }, ["remaining"]);
const providerLimit = (value) => {
  if (!record(value)) return undefined;
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "read_at") { clean.read_at = counter(item); continue; }
    if (!/^[a-z][a-z0-9_]{0,30}$/.test(key) || !record(item)) continue;
    const win = objectOf({ remaining: percent, resets_at: counter, window_minutes: counter }, ["remaining"])(item);
    if (win) clean[key] = win;
  }
  return Object.keys(clean).some((key) => key !== "read_at") ? clean : undefined;
};
const opencodeWindow = oneOf("5-hour", "weekly", "monthly");
const opencodeLimit = objectOf({
  reached: objectOf({
    window: opencodeWindow, resets_at: (value) => boundedNumber(value, 8.64e12),
  }, ["window", "resets_at"]),
  source: oneOf("log"),
}, ["reached", "source"]);
const dockerProbeFields = {
  docker_ps: probeText, docker_ps_rc: integer, docker_stats: probeText, docker_stats_rc: integer,
};
const legacyProbe = objectOf({
  ss: probeText, ss_rc: integer, ...dockerProbeFields, error: boundedString,
});

function validateLegacyProbes(value) {
  if (!record(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > MAX_COLLECTOR_ROWS) return undefined;
  const clean = [];
  for (const [key, probe] of entries) {
    const entry = legacyProbe(probe);
    if (key && boundedString(key) && entry) clean.push([key, entry]);
  }
  return entries.length === 0 || clean.length > 0 ? Object.fromEntries(clean) : undefined;
}

const publishedPort = objectOf({
  hostAddr: boundedString, hostPort: boundedString, containerPort: boundedString,
}, ["hostPort", "containerPort"]);
const dockerContainer = objectOf({
  id: boundedString, name: (value) => isValidDockerContainerName(value) ? value : undefined,
  image: boundedString, state: boundedString, status: boundedString,
  portsRaw: boundedString, publishedPorts: arrayOf(publishedPort),
  cpuPerc: boundedString, memUsage: boundedString, memPerc: boundedString,
  hasNetIo: boolean, netRx: boundedString, netTx: boundedString,
}, ["name"]);
const containers = arrayOf(dockerContainer);
const validateDocker = (value) => containers(value) ?? objectOf({
  containers, ...dockerProbeFields, error: boundedString,
})(value);

const collectorRemoteFields = {
  version: integer,
  generated_at: dateTime,
  system: objectOf({
    hostname: boundedString, username: boundedString, os: boundedString, uptime_s: counter,
    cpu_pct: percent, cpu_cores: counter, cpu_model: boundedString,
    ram_used_b: counter, ram_total_b: counter, disk_used_b: counter, disk_total_b: counter,
  }),
  ssh_hosts: sshHosts,
  ports: arrayOf(objectOf({
    port: portNumber, addr: boundedString, pid: counter, process: boundedString, cwd: boundedString,
    access: oneOf("public", "tailnet", "local"),
  }, ["port"])),
  docker: validateDocker,
  network: objectOf({
    source: oneOf("vnstat", "counters"), ifaces: arrayOf(boundedString),
    days: arrayOf(objectOf({ date: dateString, rx_b: counter, tx_b: counter }, ["date"])),
    since: dateTime, resets: counter,
  }),
  errors: arrayOf(boundedString),
  notes: arrayOf(boundedString),
};
const validateRemoteSnapshot = objectOf(collectorRemoteFields);
const validateLocalSnapshot = objectOf({
  ...collectorRemoteFields,
  tailscale: objectOf({
    tailnet: boundedString,
    self: objectOf(peerFields),
    peers: arrayOf(objectOf({
      ...peerFields, online: boolean, last_seen: dateTime, ping_ms: counter,
    }, ["name"])),
    funnel_ports: arrayOf(portNumber),
    serve: arrayOf(objectOf({
      port: portNumber, target: boundedString, funnel: boolean, proto: oneOf("tcp", "http", "https"),
    }, ["port"])),
  }),
  usage: objectOf({
    days: arrayOf(objectOf({
      date: dateString, provider, model: boundedString, project: boundedString,
      input: counter, output: counter, cache_read: counter, cache_write: counter,
      sessions: counter, active_s: counter, estimated: boolean,
    }, ["date", "provider"])),
    sessions: arrayOf(objectOf({
      start: timestamp, end: timestamp, project: boundedString, provider,
    }, ["start", "end"])),
  }),
  live: arrayOf(objectOf({ provider, since: timestamp, folder: boundedString }, ["provider"])),
  limits: objectOf({
    claude: providerLimit, codex: providerLimit, antigravity: providerLimit, opencode: opencodeLimit,
  }),
  installed: objectOf({
    claude: boolean, opencode: boolean, codex: boolean, agy: boolean, pi: boolean, gemini: boolean,
  }),
  remote: validateLegacyProbes,
});

/** Keep bounded UI fields, and reject a snapshot with no usable data or diagnostics. */
export function validateCollectorResult(value, { remote = false } = {}) {
  const clean = (remote ? validateRemoteSnapshot : validateLocalSnapshot)(value);
  if (!clean) return null;
  const { version, generated_at, errors, notes, ...sections } = clean;
  return Object.keys(sections).length > 0 || errors?.length > 0 || notes?.length > 0 ? clean : null;
}

export const SCREENS = ["overview", "spaces", "machines", "ports", "agents", "approvals"];

export const SCREEN_TITLES = {
  overview: "Overview",
  spaces: "Spaces",
  machines: "Machines",
  ports: "Ports",
  agents: "Agents",
  approvals: "Approvals",
};

export const RANGE_OPTIONS = ["Today", "14 Days", "30 Days"];

export const STATUS_ORDER = ["blocked", "done", "working", "idle"];

export const STATUS_LABELS = {
  blocked: statusWord("blocked"),
  done: statusWord("done"),
  working: statusWord("working"),
  idle: statusWord("idle"),
};

export const LAYOUT_STATE_LABELS = {
  ready: "Connected",
  loading: "Loading",
  unavailable: "Unreachable",
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function formatClock(date = new Date()) {
  const day = WEEKDAYS[date.getDay()] ?? "—";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return { day, hhmm: `${hh}:${mm}` };
}

export function countLabel(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function formatTokens(count, { estimated = false, unit = true } = {}) {
  if (!Number.isFinite(count) || count < 0) return "—";
  const scales = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  const scale = scales.find(([value]) => count >= value * 0.99995);
  const amount = scale ? `${Number((count / scale[0]).toFixed(1))}${scale[1]}` : String(Math.round(count));
  return `${estimated ? "~" : ""}${amount}${unit ? " tok" : ""}`;
}

export function rowTokens(row) {
  return (Number(row.input) || 0) + (Number(row.output) || 0)
    + (Number(row.cache_read) || 0) + (Number(row.cache_write) || 0);
}

export function summarizeUsageTokens(entries, from, to = from) {
  const providers = new Map();
  let total = 0;
  let estimated = false;
  let available = false;
  for (const entry of entries) {
    const days = entry?.result?.usage?.days;
    if (!Array.isArray(days)) continue;
    available = true;
    for (const row of days) {
      if (!row?.date || row.date < from || row.date > to) continue;
      const tokens = rowTokens(row);
      if (tokens <= 0) continue;
      const provider = row.provider || "other";
      const bucket = providers.get(provider) ?? { tokens: 0, estimated: false };
      bucket.tokens += tokens;
      bucket.estimated ||= Boolean(row.estimated || provider === "antigravity");
      providers.set(provider, bucket);
      total += tokens;
      estimated ||= bucket.estimated;
    }
  }
  return { providers, total: available ? total : null, estimated };
}

const USAGE_PROVIDERS = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "antigravity", label: "Antigravity" },
  { id: "opencode", label: "OpenCode" },
];

export function buildUsageRows(entries, now = new Date()) {
  const { providers } = summarizeUsageTokens(entries, localIsoDate(now));
  const nowS = now.getTime() / 1000;
  return USAGE_PROVIDERS.flatMap(({ id, label }) => {
    const installedKey = id === "antigravity" ? "agy" : id;
    const installed = entries.some((entry) => entry?.result?.installed?.[installedKey] === true);
    const installationKnown = entries.some((entry) => entry?.result?.installed && Object.hasOwn(entry.result.installed, installedKey));
    if (installationKnown && !installed) return [];
    let hint = null;
    let limits = null;
    let limitNotice = null;
    if (id === "opencode") {
      let reached = null;
      for (const entry of entries) {
        const candidate = opencodeLimit(entry?.result?.limits?.opencode)?.reached;
        if (candidate && candidate.resets_at > (reached?.resets_at ?? nowS)) reached = candidate;
      }
      if (reached) {
        const resetDate = new Date(reached.resets_at * 1000);
        limitNotice = `${reached.window} limit reached · resets ${MONTHS_SHORT[resetDate.getMonth()]} ${resetDate.getDate()}`;
      }
    } else {
      for (const entry of entries) {
        const candidate = entry?.result?.limits?.[id];
        if (!candidate || !Object.values(candidate).some((window) => Number.isFinite(window?.remaining))) continue;
        if (!limits || (candidate.read_at ?? 0) > (limits.read_at ?? 0)) limits = candidate;
      }
    }
    if (id === "claude" && installed) {
      const at = limits?.read_at;
      if (!Number.isFinite(at) || nowS - at > 6 * 3600) hint = "Open a Claude session";
    }
    const tokens = providers.get(id);
    if (!installed && !limits && !tokens && !limitNotice) return [];
    const windows = Object.entries(limits ?? {})
      .filter(([key, value]) => key !== "read_at" && Number.isFinite(value?.remaining))
      .map(([key, value]) => ({
        key,
        label: codexWindowLabel(value.window_minutes, key),
        remaining: value.remaining,
        resets_at: value.resets_at,
        countdown: formatResetCountdown(value.resets_at, nowS),
      }));
    const fiveWindow = windows.find((window) => window.label === "5h");
    const weekWindow = windows.find((window) => window.label === "week");
    const countdown = fiveWindow?.countdown ?? "—";
    return [{
      id,
      label,
      five: fiveWindow?.remaining ?? null,
      week: weekWindow?.remaining ?? null,
      ...(windows.length ? { windows } : {}),
      countdown,
      tokens: formatTokens(tokens?.tokens, { estimated: tokens?.estimated }),
      ...(hint ? { hint } : {}),
      ...(limitNotice ? { limitNotice } : {}),
    }];
  });
}

function formatResetCountdown(resetsAt, nowS) {
  if (!Number.isFinite(resetsAt) || resetsAt <= nowS) return "—";
  const minutes = Math.ceil((resetsAt - nowS) / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remMin = minutes % 60;
    return `${hours}h${remMin ? ` ${remMin}m` : ""}`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d${remHours ? ` ${remHours}h` : ""}`;
}

function codexWindowLabel(minutes, fallback) {
  if (!Number.isFinite(minutes)) return fallback === "five" ? "5h" : fallback;
  if (Math.abs(minutes - 300) <= 30) return "5h";
  if (Math.abs(minutes - 10080) <= 360) return "week";
  if (Math.abs(minutes - 43200) <= 1440) return "30d";
  return `${minutes}m`;
}

export function summarizeUsageCard(rows, { compact = false } = {}) {
  const reached = rows.find((row) => row.limitNotice);
  if (reached) return compact ? "Limit reached" : `${reached.label} · ${reached.limitNotice}`;
  const lowest = rows.reduce((min, row) =>
    Number.isFinite(row.five) && (!min || row.five < min.five) ? row : min, null);
  if (lowest) return compact ? `5h ${lowest.five}%` : `${lowest.label} · 5h ${lowest.five}%`;
  const withTokens = rows.filter((row) => row.tokens !== "—");
  if (withTokens.length === 1) {
    const { label, tokens } = withTokens[0];
    return compact ? tokens : `${label} · ${tokens}`;
  }
  return rows.length ? (compact ? String(rows.length) : countLabel(rows.length, "provider")) : "—";
}

export function sidebarLayout(height) {
  // Until GPUI reports a size, use the layout that fits the smaller viewport.
  const available = Number.isFinite(height) && height > 0 ? height : 0;
  return {
    usageCollapsed: available < 900,
    tailnetCompact: available < 700,
  };
}

export const SIDEBAR_TERMINAL_METRICS = {
  headerHeight: 18,
  tabHeight: 26,
  tabGap: 2,
  groupGap: 4,
  moreHeight: 22,
};

export function sidebarListBudget({ height, headerHeight, footerHeight, controlsHeight, insetHeight, minListHeight }) {
  const measured = [height, headerHeight, footerHeight].every(Number.isFinite);
  const remaining = measured ? height - headerHeight - footerHeight - controlsHeight - insetHeight : minListHeight;
  return { listHeight: Math.max(minListHeight, remaining), scroll: remaining < minListHeight };
}

export function sidebarTerminalPreview(spaces, height) {
  const { headerHeight, tabHeight, tabGap, groupGap, moreHeight } = SIDEBAR_TERMINAL_METRICS;
  const available = Number.isFinite(height) ? height : moreHeight;
  const tabPitch = tabHeight + tabGap;
  const groups = (spaces ?? []).filter((space) => space?.tabs?.length)
    .map((space) => ({ space, tabs: space.tabs }));
  const totalTabs = groups.reduce((sum, { tabs }) => sum + tabs.length, 0);
  const fullHeight = groups.length * headerHeight + totalTabs * tabPitch
    + Math.max(0, groups.length - 1) * groupGap;
  if (fullHeight <= available) return { groups, totalTabs, hiddenTabs: 0 };

  const visible = [];
  let hiddenTabs = totalTabs;
  let remaining = available - moreHeight;
  // Reserve the trailing gap before the next group or the overflow button.
  const groupOverhead = headerHeight + groupGap;
  for (const { space, tabs } of groups) {
    const count = Math.min(tabs.length, Math.floor((remaining - groupOverhead) / tabPitch));
    if (count < 1) break;
    visible.push({ space, tabs: tabs.slice(0, count) });
    hiddenTabs -= count;
    remaining -= groupOverhead + count * tabPitch;
    if (count < tabs.length) break;
  }
  return { groups: visible, totalTabs, hiddenTabs };
}

export function statusLabel(status) {
  return STATUS_LABELS[status] ?? (status || "—");
}

export function statusColor(t, status) {
  if (typeof t === "string") return paletteStatusColor(t);
  return t?.[status] ?? paletteStatusColor(status);
}

export function layoutStateLabel(layoutState) {
  return LAYOUT_STATE_LABELS[layoutState] ?? (layoutState || "—");
}

export function layoutStateColor(t, layoutState) {
  if (layoutState === "ready") return t.ansi2 ?? t.done;
  if (layoutState === "loading") return t.working ?? t.blocked;
  if (layoutState === "unavailable") return t.unknown ?? t.dim;
  return t.dim;
}

export function machineFromAddress(address) {
  if (!address || typeof address !== "string") return null;
  const idx = address.indexOf("/");
  return idx === -1 ? null : address.slice(0, idx);
}

export function machineDisplayName(name) {
  return name == null || name === "" ? "This computer" : name;
}

export function liveTerminals(allTerminals) {
  return (allTerminals ?? []).filter((t) => t && t.state === "live" && !t.hidden);
}

const BACKSLASH = String.fromCharCode(92);

// Antigravity workers running inside Herdr tabs report themselves via OSC 7501
// (agents()) AND show up as recently modified .db files in the collector's live[] array.
// Drop one background antigravity row per Herdr Antigravity agent to avoid double-counting,
// preferring an exact normalized folder/cwd match and falling back to the newest `since`.
function normalizeFolderPath(p) {
  if (!p || typeof p !== "string") return "";
  const cleaned = p
    .trim()
    .split(BACKSLASH)
    .join("/")
    .replace(/\/+$/, "")
    .toLowerCase();
  return cleaned || (p.trim() ? "/" : "");
}

function isAntigravityAgent(agent) {
  if (!agent) return false;
  const key = String(agent.program?.key || "").toLowerCase();
  const app = String(agent.app || "").toLowerCase();
  const name = String(agent.program?.name || "").toLowerCase();
  return (
    key === "antigravity" ||
    key === "agy" ||
    app === "antigravity" ||
    app === "agy" ||
    name === "antigravity"
  );
}

function parseSinceMs(since) {
  if (typeof since === "number" && Number.isFinite(since)) return since;
  if (typeof since === "string" && since) {
    const ms = Date.parse(since);
    if (Number.isFinite(ms)) return ms;
  }
  return -Infinity;
}

function sameMachine(a, b) {
  const na = a == null || a === "" ? null : String(a).toLowerCase();
  const nb = b == null || b === "" ? null : String(b).toLowerCase();
  return na === nb;
}

export function dedupeBackgroundLive({
  collectEntries,
  agentsList,
  spacesList,
  terminalsList,
  panesList,
}) {
  const allRows = [];
  for (const entry of collectEntries ?? []) {
    const entryMachine = entry?.machine ?? null;
    for (const item of entry?.result?.live ?? []) {
      if (!item || !item.provider) continue;
      allRows.push({
        entryMachine,
        item,
        provider: String(item.provider).toLowerCase(),
        folderNorm: normalizeFolderPath(item.folder),
        sinceMs: parseSinceMs(item.since),
        dropped: false,
      });
    }
  }

  const agyAgents = (agentsList ?? []).filter(isAntigravityAgent);
  if (agyAgents.length === 0 || allRows.length === 0) {
    return allRows.map(({ entryMachine, item }) => ({ entryMachine, item }));
  }

  const paneCwdById = new Map();
  const paneCwdByTerm = new Map();
  for (const p of panesList ?? []) {
    if (!p?.cwd) continue;
    if (p.pane) paneCwdById.set(p.pane, p.cwd);
    if (p.terminal) paneCwdByTerm.set(p.terminal, p.cwd);
  }
  const termCwdByAddr = new Map();
  for (const t of terminalsList ?? []) {
    if (t?.address && t?.cwd) termCwdByAddr.set(t.address, t.cwd);
  }
  const spaceFolderById = new Map();
  for (const s of spacesList ?? []) {
    if (s?.id && s?.folder) spaceFolderById.set(s.id, s.folder);
  }

  const resolvedAgents = agyAgents.map((a) => {
    const rawFolder =
      a.cwd ||
      a.folder ||
      (a.pane ? paneCwdById.get(a.pane) : null) ||
      (a.address ? paneCwdByTerm.get(a.address) : null) ||
      (a.address ? termCwdByAddr.get(a.address) : null) ||
      (a.space ? spaceFolderById.get(a.space) : null) ||
      "";
    return {
      machine: machineFromAddress(a.address),
      folderNorm: normalizeFolderPath(rawFolder),
      matched: false,
    };
  });

  const pickNewest = (candidates) => {
    let best = null;
    for (const row of candidates) {
      if (!best || row.sinceMs > best.sinceMs) best = row;
    }
    return best;
  };

  for (const ag of resolvedAgents) {
    if (!ag.folderNorm) continue;
    const hit = pickNewest(
      allRows.filter(
        (r) =>
          !r.dropped &&
          r.provider === "antigravity" &&
          sameMachine(r.entryMachine, ag.machine) &&
          r.folderNorm === ag.folderNorm,
      ),
    );
    if (hit) {
      hit.dropped = true;
      ag.matched = true;
    }
  }

  for (const ag of resolvedAgents) {
    if (ag.matched) continue;
    const hit = pickNewest(
      allRows.filter(
        (r) =>
          !r.dropped &&
          r.provider === "antigravity" &&
          sameMachine(r.entryMachine, ag.machine),
      ),
    );
    if (hit) {
      hit.dropped = true;
      ag.matched = true;
    }
  }

  return allRows
    .filter((r) => !r.dropped)
    .map(({ entryMachine, item }) => ({ entryMachine, item }));
}

export function navCounts({ machinesList, spacesList, agentsList, terminalsList }) {
  return {
    machines: (machinesList ?? []).length,
    spaces: (spacesList ?? []).length,
    agents: (agentsList ?? []).length,
    terminals: liveTerminals(terminalsList).length,
  };
}

export function buildShellSummary({
  machinesList,
  spacesList,
  agentsList,
  terminalsList,
  panesList,
  collectEntries,
  localEntry,
  now = new Date(),
}) {
  const localResult = localEntry?.result ?? null;
  const hostname = localResult?.system?.hostname || null;
  const username = localResult?.system?.username;
  const userLine = hostname ? `${username ? username + "@" : ""}${hostname}` : "—";

  // Count from the same models the Machines screen draws, so the nav badge
  // and the "n/m online" header can't disagree (SSH alias vs Tailscale name).
  const { models: machineModels } = buildMachineModels({
    machinesList,
    agentsList,
    spacesList,
    collectEntries,
    localEntry,
    now,
  });
  const onlineMachines = machineModels.filter((m) => m.online).length;
  const totalMachines = machineModels.length;
  const ts = localResult?.tailscale;

  const entries = collectEntries ?? [];
  const portResults = entries.filter((e) => Array.isArray(e?.result?.ports));
  const publicPorts =
    portResults.length === 0
      ? null
      : portResults.reduce(
          (sum, e) => sum + e.result.ports.filter((p) => p?.access === "public").length,
          0,
        );

  const blockedAgents = (agentsList ?? []).filter((a) => a && a.status === "blocked").length;
  const bgLiveCount = dedupeBackgroundLive({
    collectEntries: entries,
    agentsList,
    spacesList,
    terminalsList,
    panesList,
  }).length;

  // Ping: prefer another Herdr machine's measured ping to this machine; else nearest online peer ping.
  let pingMs = null;
  const selfNames = new Set(
    [ts?.self?.name, hostname]
      .filter(Boolean)
      .map((n) => n.toLowerCase()),
  );
  for (const e of entries) {
    if (e.machine === null) continue;
    for (const p of e.result?.tailscale?.peers ?? []) {
      if (p?.name && selfNames.has(p.name.toLowerCase()) && typeof p.ping_ms === "number") {
        pingMs = pingMs == null ? p.ping_ms : Math.min(pingMs, p.ping_ms);
      }
    }
  }
  if (pingMs == null) {
    for (const p of ts?.peers ?? []) {
      if (p?.online && typeof p.ping_ms === "number") {
        pingMs = pingMs == null ? p.ping_ms : Math.min(pingMs, p.ping_ms);
      }
    }
  }

  let funnelPort = null;
  for (const e of entries) {
    const hit = tailscaleRoutes(e?.result?.tailscale).find((s) => s.funnel);
    if (hit) {
      funnelPort = hit.port;
      break;
    }
  }

  const staleAgeMin =
    localEntry?.error && typeof localEntry.at === "number"
      ? Math.max(1, Math.floor((now.getTime() - localEntry.at) / 60000))
      : null;

  return {
    hostname,
    userLine,
    spacesCount: (spacesList ?? []).length,
    onlineMachines,
    totalMachines,
    publicPorts,
    agentsCount: (agentsList ?? []).length + bgLiveCount,
    blockedAgents,
    tailnetName: ts?.tailnet || null,
    pingMs: pingMs != null ? Math.round(pingMs) : null,
    liveTerminals: liveTerminals(terminalsList).length,
    funnelPort,
    staleAgeMin,
    collectError: localEntry?.error ?? null,
  };
}

export function attentionAgents(agentsList) {
  return (agentsList ?? [])
    .filter((a) => a && (a.status === "blocked" || a.status === "done"))
    .slice()
    .sort((a, b) => {
      const rankA = a.status === "blocked" ? 2 : 1;
      const rankB = b.status === "blocked" ? 2 : 1;
      if (rankA !== rankB) return rankB - rankA;
      return (b.seq ?? 0) - (a.seq ?? 0);
    });
}

export function recentAgents(agentsList, limit = 6) {
  return (agentsList ?? [])
    .slice()
    .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
    .slice(0, limit);
}

export function groupAgents(agentsList, filter = "all") {
  const list = agentsList ?? [];
  const counts = { all: list.length, blocked: 0, done: 0, working: 0, idle: 0 };
  for (const a of list) {
    if (a.status in counts) counts[a.status] += 1;
  }

  const filtered = filter === "all" ? list : list.filter((a) => a.status === filter);
  const groups = [];
  for (const st of STATUS_ORDER) {
    const items = filtered
      .filter((a) => a.status === st)
      .slice()
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.seq ?? 0) - (a.seq ?? 0));
    if (items.length > 0) {
      groups.push({ status: st, label: statusLabel(st), items });
    }
  }
  return { counts, groups };
}

export function buildMachinesView({ machinesList, spacesList, agentsList, terminalsList }) {
  const spacesAll = spacesList ?? [];
  const agentsAll = agentsList ?? [];
  const termsLive = liveTerminals(terminalsList);

  return (machinesList ?? []).map((m) => {
    const key = m.name ?? null;
    return {
      name: key,
      displayName: machineDisplayName(key),
      isLocal: key === null,
      layout: m.layout,
      stateLabel: layoutStateLabel(m.layout),
      spaceCount: spacesAll.filter((s) => (s.machine ?? null) === key).length,
      agentCount: agentsAll.filter((a) => machineFromAddress(a.address) === key).length,
      terminalCount: termsLive.filter((t) => machineFromAddress(t.address) === key).length,
    };
  });
}

export function buildSpacesView(spacesList) {
  return (spacesList ?? []).map((s) => ({
    id: s.id,
    name: s.name || "—",
    machine: machineDisplayName(s.machine ?? null),
    isLocal: (s.machine ?? null) === null,
    folder: s.folder || "—",
    branch: s.branch || null,
    status: s.status ?? null,
    statusLabel: s.status ? statusLabel(s.status) : null,
    active: Boolean(s.active),
    tabs: (s.tabs ?? []).map((tab) => ({
      id: tab.id,
      name: tab.name || String(tab.index ?? "—"),
      active: Boolean(tab.active),
      status: tab.status ?? null,
    })),
    tabCount: (s.tabs ?? []).length,
  }));
}

export function terminalProgramName(term) {
  return term?.program?.name || term?.agent || term?.name || "Terminal";
}

export function terminalStateLabel(state) {
  return state === "live" ? "Live" : (state || "—");
}

export function formatAgentPlace(a) {
  if (!a) return "—";
  const parts = [a.space_name, a.tab_name].filter(Boolean);
  return parts.length ? parts.join(" / ") : "—";
}

const SPACE_STATUS_PRIORITY = ["blocked", "done", "working", "idle"];

export function deriveSpaceStatus(space, spaceAgents = []) {
  const list = spaceAgents ?? [];
  for (const st of SPACE_STATUS_PRIORITY) {
    if (list.some((a) => a && a.status === st)) {
      return st;
    }
  }
  return space?.status ?? "idle";
}

// ---------------------------------------------------------------------------
// Remote Linux machine parsing (ss -tlnH / docker ps / docker stats)
// ---------------------------------------------------------------------------

const SS_PROC_RE = /users:\(\("([^"]+)",pid=(\d+)/;

export function normalizeRemoteAddr(rawAddr) {
  if (!rawAddr || typeof rawAddr !== "string") return "";
  let clean = rawAddr.trim();
  if (clean.startsWith("[") && clean.endsWith("]")) {
    clean = clean.slice(1, -1);
  }
  const pctIdx = clean.indexOf("%");
  if (pctIdx !== -1) {
    clean = clean.slice(0, pctIdx);
  }
  if (clean.toLowerCase().startsWith("::ffff:")) {
    clean = clean.slice(7);
  }
  if (clean === "*") {
    clean = "0.0.0.0";
  }
  return clean;
}

export function classifyListenAddress(rawAddr) {
  const addr = normalizeRemoteAddr(rawAddr);
  const lower = addr.toLowerCase();
  if (
    lower === "127.0.0.1" ||
    lower === "::1" ||
    lower === "localhost" ||
    lower.startsWith("127.")
  ) {
    return { bindScope: "local", bindLabel: "this machine only", access: "local" };
  }
  if (lower === "0.0.0.0" || lower === "::" || lower === "*") {
    return { bindScope: "all", bindLabel: "all interfaces", access: "all_interfaces" };
  }
  return { bindScope: "specific", bindLabel: "specific interface", access: "specific" };
}

export function formatAddrPort(addr, port) {
  if (!addr) return `:${port}`;
  return addr.includes(":") ? `[${addr}]:${port}` : `${addr}:${port}`;
}

export function parseSsOutput(text) {
  if (!text || typeof text !== "string") return [];
  const rows = [];
  const seen = new Set();

  for (const rawLine of text.split(/\r?\n/, MAX_COLLECTOR_ROWS)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("State")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4 || parts[0] !== "LISTEN") continue;

    const localEp = parts[3];
    const colonIdx = localEp.lastIndexOf(":");
    if (colonIdx <= 0) continue;

    const rawAddr = boundedString(localEp.slice(0, colonIdx));
    const portStr = localEp.slice(colonIdx + 1);
    if (!/^\d+$/.test(portStr)) continue;
    const port = Number(portStr);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;

    const addr = normalizeRemoteAddr(rawAddr);
    if (!addr) continue;

    const mProc = SS_PROC_RE.exec(line);
    const process = boundedString(mProc?.[1]) ?? "";
    const pid = counter(Number(mProc?.[2])) ?? 0;

    const dedupeKey = `${addr}|${port}|${process}|${pid}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const { bindScope, bindLabel, access } = classifyListenAddress(addr);
    rows.push({
      addr,
      port,
      process: process || "—",
      hasProcess: Boolean(process),
      pid,
      bindScope,
      bindLabel,
      access,
    });
  }

  rows.sort(
    (a, b) =>
      a.port - b.port ||
      a.addr.localeCompare(b.addr) ||
      a.process.localeCompare(b.process),
  );
  return rows;
}

function parsePublishedPortsString(portsStr) {
  if (!portsStr || typeof portsStr !== "string") return [];
  const trimmed = portsStr.trim();
  if (!trimmed) return [];

  const result = [];
  for (const part of trimmed.split(",")) {
    const item = part.trim();
    if (!item) continue;
    const arrowIdx = item.indexOf("->");
    if (arrowIdx === -1) continue;
    const hostSide = item.slice(0, arrowIdx).trim();
    const containerSide = item.slice(arrowIdx + 2).trim();
    const lastColon = hostSide.lastIndexOf(":");
    const hostAddr = lastColon > 0 ? normalizeRemoteAddr(hostSide.slice(0, lastColon)) : "";
    const hostPort = lastColon >= 0 ? hostSide.slice(lastColon + 1).trim() : hostSide;
    result.push({
      raw: item,
      hostAddr,
      hostPort,
      containerPort: containerSide,
    });
  }
  return result;
}

export function parseDockerPsOutput(text) {
  if (!text || typeof text !== "string") return [];
  const rows = [];

  for (const rawLine of text.split(/\r?\n/, MAX_COLLECTOR_ROWS)) {
    const line = rawLine.trim();
    if (!line || !line.startsWith("{")) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;

    const id = boundedString(obj.ID)?.trim() ?? "";
    const rawNames = (boundedString(obj.Names) ?? boundedString(obj.Name))?.trim() ?? "";
    if (!id && !rawNames) continue;

    const name = rawNames ? rawNames.split(",")[0].trim() : id;
    if (!isValidDockerContainerName(name)) continue;
    const image = boundedString(obj.Image)?.trim();
    const state = boundedString(obj.State)?.trim().toLowerCase() ?? "";
    const status = boundedString(obj.Status)?.trim() || state;
    const portsRaw = boundedString(obj.Ports)?.trim() ?? "";

    rows.push({
      id: id || name,
      name,
      image: image || "—",
      state,
      status: status || "—",
      portsRaw,
      publishedPorts: parsePublishedPortsString(portsRaw),
    });
  }

  return rows;
}

const DOCKER_NETIO_UNITS = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

const DOCKER_NETIO_PART_RE = /^(\d+(?:\.\d+)?)\s*(B|kB|KB|MB|GB|TB|kiB|KiB|MiB|GiB|TiB)$/i;
const DOCKER_CONTAINER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function parseDockerIoToken(token) {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  const match = DOCKER_NETIO_PART_RE.exec(trimmed);
  if (!match) return null;
  const num = Number(match[1]);
  const unit = match[2];
  const mult = DOCKER_NETIO_UNITS[unit.toLowerCase()];
  if (!Number.isFinite(num) || num < 0 || !mult) return null;
  return {
    text: `${match[1]}${unit}`,
    bytes: Math.round(num * mult),
  };
}

/** Parse a `docker stats` NetIO string (e.g. `"1.2kB / 648B"` or `"0B / 0B"`) into rx/tx values or `"—"`. */
export function parseDockerNetIo(raw) {
  if (typeof raw !== "string") {
    return { ok: false, rx: "—", tx: "—", rxBytes: null, txBytes: null, summary: "—" };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, rx: "—", tx: "—", rxBytes: null, txBytes: null, summary: "—" };
  }
  const parts = trimmed.split("/");
  if (parts.length !== 2) {
    return { ok: false, rx: "—", tx: "—", rxBytes: null, txBytes: null, summary: "—" };
  }
  const rx = parseDockerIoToken(parts[0]);
  const tx = parseDockerIoToken(parts[1]);
  if (!rx || !tx) {
    return { ok: false, rx: "—", tx: "—", rxBytes: null, txBytes: null, summary: "—" };
  }
  return {
    ok: true,
    rx: rx.text,
    tx: tx.text,
    rxBytes: rx.bytes,
    txBytes: tx.bytes,
    summary: `↓ ${rx.text} · ↑ ${tx.text}`,
  };
}

/** Docker names start with an alphanumeric character. */
export function isValidDockerContainerName(name) {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 255) return false;
  return DOCKER_CONTAINER_NAME_RE.test(name);
}

/** Build validated Herdr tab name and argv for Docker logs. */
export function buildDockerLogsTabSpec(name) {
  if (!isValidDockerContainerName(name)) {
    return { ok: false, error: "Invalid container name", tabName: null, argv: null };
  }
  return {
    ok: true,
    error: null,
    tabName: `log · ${name}`,
    argv: ["docker", "logs", "-f", "--tail", "200", "--", name],
  };
}

export function parseDockerStatsOutput(text) {
  if (!text || typeof text !== "string") return [];
  const rows = [];

  for (const rawLine of text.split(/\r?\n/, MAX_COLLECTOR_ROWS)) {
    const line = rawLine.trim();
    if (!line || !line.startsWith("{")) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;

    const id = boundedString(obj.ID)?.trim() ?? "";
    const containerId = boundedString(obj.Container)?.trim() ?? "";
    const name = boundedString(obj.Name)?.trim() ?? "";
    if (!id && !containerId && !name) continue;

    const cpuPerc = boundedString(obj.CPUPerc)?.trim() ?? "";
    const memUsage = boundedString(obj.MemUsage)?.trim() ?? "";
    const memPerc = boundedString(obj.MemPerc)?.trim() ?? "";
    const netIoRaw = boundedString(obj.NetIO)?.trim() ?? "";
    const netIo = parseDockerNetIo(netIoRaw);

    let memUsed = "";
    let memLimit = "";
    if (memUsage.includes("/")) {
      const slash = memUsage.indexOf("/");
      memUsed = memUsage.slice(0, slash).trim();
      memLimit = memUsage.slice(slash + 1).trim();
    }

    rows.push({
      id: id || containerId,
      containerId,
      name,
      cpuPerc: cpuPerc || "—",
      memUsage: memUsage || "—",
      memUsed: memUsed || "—",
      memLimit: memLimit || "—",
      memPerc: memPerc || "—",
      netIoRaw: netIoRaw || "—",
      netRx: netIo.rx,
      netTx: netIo.tx,
      netRxBytes: netIo.rxBytes,
      netTxBytes: netIo.txBytes,
      hasNetIo: netIo.ok,
      netSummary: netIo.summary,
    });
  }

  return rows;
}

export function mergeDockerContainers(psList, statsList) {
  const containers = Array.isArray(psList) ? psList : [];
  const stats = Array.isArray(statsList) ? statsList : [];
  const requestedIds = new Set(containers.map((container) => container.id));
  const byId = new Map();
  const byName = new Map();
  const firstById = new Map();
  const firstByPrefix = new Map();
  stats.forEach((stat, index) => {
    if (!stat) return;
    if (stat.name) byName.set(stat.name, stat);
    const entry = { stat, index };
    if (stat.id && !firstById.has(stat.id)) firstById.set(stat.id, entry);
    for (const id of [stat.id, stat.containerId]) {
      if (!id) continue;
      byId.set(id, stat);
      for (let length = 1; length <= id.length; length += 1) {
        const prefix = id.slice(0, length);
        if (requestedIds.has(prefix) && !firstByPrefix.has(prefix)) firstByPrefix.set(prefix, entry);
      }
    }
  });

  const findStat = (c) => {
    if (c.id && byId.has(c.id)) return byId.get(c.id);
    if (c.name && byName.has(c.name)) return byName.get(c.name);
    if (!c.id) return null;
    let match = firstByPrefix.get(c.id);
    for (let length = 1; length < c.id.length; length += 1) {
      const shorter = firstById.get(c.id.slice(0, length));
      if (shorter && (!match || shorter.index < match.index)) match = shorter;
    }
    return match?.stat ?? null;
  };

  const merged = containers.map((c) => {
    const st = findStat(c);
    return {
      id: c.id,
      name: c.name,
      image: c.image,
      state: c.state,
      status: c.status,
      portsRaw: c.portsRaw,
      publishedPorts: c.publishedPorts,
      cpuPerc: st?.cpuPerc || "—",
      memUsage: st?.memUsage || "—",
      memUsed: st?.memUsed || "—",
      memLimit: st?.memLimit || "—",
      memPerc: st?.memPerc || "—",
      netIoRaw: st?.netIoRaw || "—",
      netRx: st?.netRx || "—",
      netTx: st?.netTx || "—",
      netRxBytes: st?.netRxBytes ?? null,
      netTxBytes: st?.netTxBytes ?? null,
      hasNetIo: Boolean(st?.hasNetIo),
      netSummary: st?.netSummary || "—",
    };
  });

  merged.sort((a, b) => {
    const ar = a.state === "running" ? 0 : 1;
    const br = b.state === "running" ? 0 : 1;
    if (ar !== br) return ar - br;
    return String(a.name).localeCompare(String(b.name));
  });
  return merged;
}

export function parseRemoteMachineEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return { ok: false, error: "unreachable", ports: null, dockerError: null, containers: [] };
  }
  if (entry.error) {
    return { ok: false, error: entry.error, ports: null, dockerError: null, containers: [] };
  }

  const ssOk = entry.ss_rc === 0 || (entry.ss_rc == null && typeof entry.ss === "string");
  const ports = ssOk ? parseSsOutput(entry.ss) : null;

  const psRc = entry.docker_ps_rc;
  const dockerFailed = psRc !== undefined && psRc !== null && psRc !== 0;
  if (dockerFailed) {
    return {
      ok: true,
      error: null,
      ports,
      dockerError: "Could not read Docker",
      containers: [],
    };
  }

  const psList = parseDockerPsOutput(entry.docker_ps);
  const statsList = parseDockerStatsOutput(entry.docker_stats);
  const containers = mergeDockerContainers(psList, statsList);

  return {
    ok: true,
    error: null,
    ports,
    dockerError: null,
    containers,
  };
}

function buildDockerModel(docker) {
  if (Array.isArray(docker) || Array.isArray(docker.containers)) {
    return { ok: true, dockerError: null, containers: Array.isArray(docker) ? docker : docker.containers };
  }
  return parseRemoteMachineEntry(docker);
}

// ---------------------------------------------------------------------------
// Shared port summarization & machine view-model builder
// ---------------------------------------------------------------------------

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PORT_ACCESS_RANK = { public: 0, tailnet: 1, local: 2 };

/** Format a local Date object as YYYY-MM-DD. */
export function localIsoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format YYYY-MM-DD as "DD Mon" with English month abbreviations. */
export function formatShortDate(isoDate) {
  if (!isoDate || typeof isoDate !== "string") return "—";
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const mon = MONTHS_SHORT[Number(parts[1]) - 1];
  const day = Number(parts[2]);
  if (!mon || !Number.isFinite(day)) return isoDate;
  return `${String(day).padStart(2, "0")} ${mon}`;
}

/** Extract target port integer from a Tailscale serve target string like "http://127.0.0.1:8080". */
export function extractTargetPort(target) {
  if (!target || typeof target !== "string") return null;
  const idx = target.lastIndexOf(":");
  if (idx === -1) return null;
  const num = Number(target.slice(idx + 1).replace(/\/.*$/, ""));
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function tailscaleRoutes(tailscale) {
  const serve = Array.isArray(tailscale?.serve) ? tailscale.serve : [];
  const routes = serve.filter((route) => portNumber(route?.port) !== undefined);
  if (!Array.isArray(tailscale?.funnel_ports)) return routes;
  const funnelPorts = new Set(tailscale.funnel_ports);
  const servedPorts = new Set(routes.map((route) => route.port));
  return [
    ...routes.map((route) => ({ ...route, funnel: funnelPorts.has(route.port) })),
    ...Array.from(funnelPorts, (port) => ({ port, funnel: true }))
      .filter(({ port }) => !servedPorts.has(port) && portNumber(port) !== undefined),
  ];
}

/** Find the Herdr space on the same machine whose folder contains the given cwd. */
function matchSpaceFromCwd(cwd, spacesForMachine) {
  const cwdNorm = normalizeFolderPath(cwd);
  if (!cwdNorm) return "—";

  let bestSpace = null;
  let bestLen = -1;
  for (const sp of spacesForMachine ?? []) {
    const folderNorm = normalizeFolderPath(sp?.folder);
    if (!folderNorm) continue;
    const isMatch = cwdNorm === folderNorm || cwdNorm.startsWith(`${folderNorm}/`);
    if (isMatch && folderNorm.length > bestLen) {
      bestLen = folderNorm.length;
      bestSpace = sp;
    }
  }
  return bestSpace?.name || "—";
}

/** Format elapsed offline duration from a Tailscale last_seen ISO string. */
function formatOfflineAgo(isoStr, now) {
  if (!isoStr || typeof isoStr !== "string") return "offline";
  const ts = Date.parse(isoStr);
  if (!Number.isFinite(ts)) return "offline";
  const diffMs = Math.max(0, now.getTime() - ts);
  const days = Math.floor(diffMs / 86400000);
  if (days >= 1) return `offline for ${days} d`;
  const hours = Math.floor(diffMs / 3600000);
  if (hours >= 1) return `${hours} h ago`;
  const mins = Math.max(1, Math.floor(diffMs / 60000));
  return `${mins} min ago`;
}

/** Look up a machine's traffic limit entry in TRAFFIC_LIMITS by any known name. */
function findTrafficLimit(machine, limitsMap) {
  if (!limitsMap || typeof limitsMap !== "object") return null;
  const candidates = [
    machine.herdrName,
    machine.displayName,
    machine.system?.hostname,
    machine.tsName,
    machine.isLocal ? "local" : null,
  ].filter((c) => typeof c === "string" && c.trim() !== "");

  for (const c of candidates) {
    if (limitsMap[c]) return limitsMap[c];
  }
  const lowerEntries = Object.entries(limitsMap);
  for (const c of candidates) {
    const lc = c.toLowerCase();
    const hit = lowerEntries.find(([k]) => String(k).toLowerCase() === lc);
    if (hit) return hit[1];
  }
  return null;
}

/** Compute current billing-period network totals, daily bars, projection, and limit status. */
export function computeTrafficModel(machine, limitsMap, now = new Date()) {
  const limitCfg = findTrafficLimit(machine, limitsMap);
  const y = now.getFullYear();
  const m = now.getMonth();
  const rawBillingDay = Number(limitCfg?.billing_day) || 1;
  const bDay = Math.max(1, Math.min(28, Math.floor(rawBillingDay)));

  const periodStart =
    now.getDate() >= bDay ? new Date(y, m, bDay) : new Date(y, m - 1, bDay);
  const nextPeriodStart =
    now.getDate() >= bDay ? new Date(y, m + 1, bDay) : new Date(y, m, bDay);
  const todayStart = new Date(y, m, now.getDate());

  const periodDays = Math.max(1, Math.round((nextPeriodStart - periodStart) / 86400000));
  const elapsedDays = Math.max(1, Math.round((todayStart - periodStart) / 86400000) + 1);

  const periodDates = [];
  const cursor = new Date(periodStart);
  while (cursor <= todayStart) {
    periodDates.push(localIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const periodLabel = `${formatShortDate(periodDates[0])} – ${formatShortDate(periodDates[periodDates.length - 1])}`;
  const network = machine.network;
  if (!network || !Array.isArray(network.days)) {
    return {
      hasNetwork: false,
      limitCfg,
      periodLabel,
      periodDates,
      limitTone: null,
      limitChip: null,
    };
  }

  const byDate = new Map();
  for (const row of network.days) {
    if (!row || !row.date) continue;
    const prev = byDate.get(row.date) ?? { rx: 0, tx: 0 };
    byDate.set(row.date, {
      rx: prev.rx + (Number(row.rx_b) || 0),
      tx: prev.tx + (Number(row.tx_b) || 0),
    });
  }

  let rxTotal = 0;
  let txTotal = 0;
  let maxDayTotal = 0;
  const dailyBars = periodDates.map((date) => {
    const val = byDate.get(date) ?? { rx: 0, tx: 0 };
    const total = val.rx + val.tx;
    rxTotal += val.rx;
    txTotal += val.tx;
    if (total > maxDayTotal) maxDayTotal = total;
    return { date, rx: val.rx, tx: val.tx, total };
  });

  const totalB = rxTotal + txTotal;
  const countMode = limitCfg?.count === "out" ? "out" : "total";
  const usedForLimit = countMode === "out" ? txTotal : totalB;
  const projectedTotalB = (totalB / elapsedDays) * periodDays;
  const projectedForLimit = (usedForLimit / elapsedDays) * periodDays;

  let hasLimit = false;
  let limitB = 0;
  let usedRatio = 0;
  let projRatio = 0;
  let effectiveRatio = 0;
  let limitTone = null;
  let limitChip = null;

  if (limitCfg && typeof limitCfg.monthly_tb === "number" && limitCfg.monthly_tb > 0) {
    hasLimit = true;
    limitB = limitCfg.monthly_tb * 1e12;
    usedRatio = usedForLimit / limitB;
    projRatio = projectedForLimit / limitB;
    effectiveRatio = Math.max(usedRatio, projRatio);
    if (effectiveRatio >= 0.95) {
      limitTone = "danger";
      limitChip = `${Math.round(effectiveRatio * 100)}% traffic`;
    } else if (effectiveRatio >= 0.8) {
      limitTone = "warn";
      limitChip = `${Math.round(effectiveRatio * 100)}% traffic`;
    } else {
      limitTone = "ok";
    }
  }

  return {
    hasNetwork: true,
    source: network.source || "counters",
    ifaces: Array.isArray(network.ifaces) ? network.ifaces : [],
    since: network.since || null,
    resets: Number(network.resets) || 0,
    limitCfg,
    countMode,
    hasLimit,
    limitB,
    usedForLimit,
    usedRatio,
    projRatio,
    effectiveRatio,
    limitTone,
    limitChip,
    periodLabel,
    periodDays,
    elapsedDays,
    rxTotal,
    txTotal,
    totalB,
    projectedTotalB,
    projectedForLimit,
    dailyBars,
    maxDayTotal,
  };
}

/** Deduplicate listening sockets by (port, process, pid), classify listen addresses, and annotate Tailscale serve/funnel. */
export function summarizePorts(rawPorts, serveList, spacesForMachine = []) {
  if (!Array.isArray(rawPorts)) return null;

  const funnelTargetMap = new Map();
  const serveTargetMap = new Map();
  const funnelDirectSet = new Set();
  const listenerNoteMap = new Map();

  for (const s of serveList ?? []) {
    if (!s) continue;
    const tPort = extractTargetPort(s.target);
    if (s.funnel) {
      if (typeof s.port === "number") funnelDirectSet.add(s.port);
      if (tPort !== null) funnelTargetMap.set(tPort, s.port);
      if (typeof s.port === "number" && tPort !== null) {
        listenerNoteMap.set(s.port, `Funnel → :${tPort}`);
      }
    } else if (tPort !== null) {
      serveTargetMap.set(tPort, s.port);
      if (typeof s.port === "number") {
        listenerNoteMap.set(s.port, `Serve → :${tPort}`);
      }
    }
  }

  const map = new Map();
  for (const p of rawPorts) {
    if (!p || typeof p.port !== "number") continue;
    const access = p.access ?? "unknown";
    const proc = p.process || "—";
    const dedupeKey = `${p.port}|${proc}|${p.pid ?? 0}`;
    const prev = map.get(dedupeKey);
    if (!prev || (PORT_ACCESS_RANK[access] ?? 9) < (PORT_ACCESS_RANK[prev.access] ?? 9)) {
      const addr = typeof p.addr === "string" ? normalizeRemoteAddr(p.addr) : "";
      const classified = addr ? classifyListenAddress(addr) : null;
      const bindScope = classified?.bindScope ?? null;
      const bindLabel =
        !classified || access === "public" || (access === "tailnet" && bindScope === "specific")
          ? null
          : classified.bindLabel;
      const funnelPort = funnelTargetMap.get(p.port) ?? null;
      const funnelDirectPort = funnelDirectSet.has(p.port) ? p.port : null;
      const servePort = serveTargetMap.get(p.port) ?? null;
      const listenerNote = proc.toLowerCase().includes("tailscale")
        ? (listenerNoteMap.get(p.port) ?? null)
        : null;

      map.set(dedupeKey, {
        id: `${p.port}-${p.pid ?? 0}-${access}`,
        port: p.port,
        addr,
        process: proc,
        access,
        bindScope,
        bindLabel,
        cwd: p.cwd || null,
        spaceName: matchSpaceFromCwd(p.cwd, spacesForMachine),
        funnelPort,
        funnelDirectPort,
        servePort,
        listenerNote,
        since: "—",
      });
    }
  }

  const list = Array.from(map.values());
  list.sort(
    (a, b) =>
      (PORT_ACCESS_RANK[a.access] ?? 9) - (PORT_ACCESS_RANK[b.access] ?? 9) ||
      a.port - b.port ||
      a.process.localeCompare(b.process),
  );
  return list;
}

/** Merge Herdr machines, local collector data, and Tailscale peers into unified machine models, keying strictly by Herdr machine name (never host). */
export function buildMachineModels({
  machinesList = [],
  agentsList = [],
  spacesList = [],
  collectEntries = [],
  localEntry = null,
  limitsMap = {},
  now = new Date(),
} = {}) {
  const entries = collectEntries ?? [];
  const localRes = localEntry?.result ?? null;
  const ts = localRes?.tailscale ?? null;
  const localHostname = localRes?.system?.hostname || null;
  const sshHosts = localRes?.ssh_hosts ?? [];
  const localTsName = ts?.self?.name || null;

  let selfPingMs = null;
  const selfNames = new Set(
    [localTsName, localHostname].filter(Boolean).map((n) => String(n).toLowerCase()),
  );
  for (const e of entries) {
    if (!e || e.machine === null) continue;
    for (const peer of e.result?.tailscale?.peers ?? []) {
      if (
        peer?.name &&
        selfNames.has(String(peer.name).toLowerCase()) &&
        typeof peer.ping_ms === "number"
      ) {
        selfPingMs = selfPingMs === null ? peer.ping_ms : Math.min(selfPingMs, peer.ping_ms);
      }
    }
  }

  const entryMap = new Map();
  for (const e of entries) {
    if (!e) continue;
    const key = e.machine === null ? "local" : String(e.machine).toLowerCase();
    entryMap.set(key, e);
  }

  const merged = new Map();
  const remoteMap = new Map();
  for (const [rName, rEntry] of Object.entries(localRes?.remote ?? {})) {
    if (rName) remoteMap.set(String(rName).toLowerCase(), { name: rName, entry: rEntry });
  }

  for (const hm of machinesList ?? []) {
    if (!hm) continue;
    const isLocal = hm.name == null;
    const key = isLocal ? "local" : String(hm.name).toLowerCase();
    const cEntry = entryMap.get(key) ?? (isLocal ? localEntry : null);
    const res = cEntry?.result ?? null;
    const sys = res?.system ?? null;
    const tsSelf = res?.tailscale?.self ?? (isLocal ? ts?.self : null);
    const displayName = isLocal
      ? tsSelf?.name || sys?.hostname || "This computer"
      : hm.name;

    merged.set(key, {
      key,
      isLocal,
      isHerdrMachine: true,
      herdrName: hm.name ?? null,
      herdrLayout: hm.layout ?? null,
      displayName,
      tsName: tsSelf?.name || null,
      inTailscale: isLocal && Boolean(ts?.self),
      online: hm.layout === "ready",
      ip: tsSelf?.ip || null,
      os: sys?.os || tsSelf?.os || null,
      pingMs: isLocal ? selfPingMs : null,
      lastSeen: null,
      collectorEntry: cEntry,
      sshHostNames: sshHosts.filter((host) => String(host.alias).toLowerCase() === String(hm.name ?? "").toLowerCase()).map((host) => host.hostname),
    });
  }

  if (ts?.self) {
    const prev = merged.get("local");
    merged.set("local", {
      key: "local",
      isLocal: true,
      isHerdrMachine: prev?.isHerdrMachine ?? true,
      herdrName: null,
      herdrLayout: prev?.herdrLayout ?? "ready",
      displayName: ts.self.name || prev?.displayName || localHostname || "This computer",
      tsName: ts.self.name || null,
      inTailscale: true,
      online: true,
      ip: ts.self.ip || prev?.ip || null,
      os: prev?.collectorEntry?.result?.system?.os || ts.self.os || prev?.os || null,
      pingMs: prev?.pingMs ?? selfPingMs,
      lastSeen: null,
      collectorEntry: prev?.collectorEntry ?? localEntry,
    });
  }

  // A Herdr machine is often named by its SSH alias ("windows") while Tailscale
  // knows it by hostname ("workstation"). Fold the peer into that machine
  // when the machine's own collector reported the same Tailscale name or IP.
  // Name wins; an IP match counts only when a single Herdr machine claims it
  // (WSL and its Windows host can share one Tailscale address).
  const herdrKeyForPeer = (peer) => {
    const pName = String(peer.name).toLowerCase();
    const peerNames = new Set([pName, pName.split(".")[0]]);
    const peerIp = String(peer.ip ?? "").toLowerCase();
    const sameName = (value) => {
      const host = String(value ?? "").replace(/\.$/, "").toLowerCase();
      return peerNames.has(host) || peerNames.has(host.split(".")[0]);
    };
    if (merged.has(pName)) return pName;
    const remotes = [...merged].filter(([, m]) => !m.isLocal && m.isHerdrMachine);
    const byName = remotes.find(([, m]) => m.tsName && String(m.tsName).toLowerCase() === pName);
    if (byName) return byName[0];
    const bySshHost = remotes.find(([, m]) => (m.sshHostNames ?? []).some(sameName));
    if (bySshHost) return bySshHost[0];
    const byIp = peer.ip ? remotes.filter(([, m]) => m.ip && m.ip === peer.ip) : [];
    if (byIp.length === 1) return byIp[0][0];
    const sshByIp = peerIp ? remotes.filter(([, m]) => (m.sshHostNames ?? []).some((host) => String(host).toLowerCase() === peerIp)) : [];
    return sshByIp.length === 1 ? sshByIp[0][0] : pName;
  };

  for (const peer of ts?.peers ?? []) {
    if (!peer?.name) continue;
    const key = herdrKeyForPeer(peer);
    const prev = merged.get(key);
    const cEntry = prev?.collectorEntry ?? entryMap.get(key) ?? null;
    const sys = cEntry?.result?.system ?? null;
    merged.set(key, {
      key,
      isLocal: Boolean(prev?.isLocal),
      isHerdrMachine: Boolean(prev?.isHerdrMachine),
      herdrName: prev?.herdrName ?? null,
      herdrLayout: prev?.herdrLayout ?? null,
      displayName: prev?.displayName || peer.name,
      tsName: peer.name,
      inTailscale: true,
      online: Boolean(peer.online || prev?.online),
      ip: peer.ip || prev?.ip || null,
      os: sys?.os || peer.os || prev?.os || null,
      pingMs: typeof peer.ping_ms === "number" ? peer.ping_ms : (prev?.pingMs ?? null),
      lastSeen: peer.last_seen ?? null,
      collectorEntry: cEntry,
    });
  }

  for (const [key, rItem] of remoteMap.entries()) {
    if (!merged.has(key)) {
      const cEntry = entryMap.get(key) ?? null;
      const sys = cEntry?.result?.system ?? null;
      merged.set(key, {
        key,
        isLocal: false,
        isHerdrMachine: true,
        herdrName: rItem.name,
        herdrLayout: rItem.entry?.error ? "unavailable" : "ready",
        displayName: rItem.name,
        tsName: null,
        inTailscale: false,
        online: !rItem.entry?.error,
        ip: null,
        os: sys?.os || "Linux",
        pingMs: null,
        lastSeen: null,
        collectorEntry: cEntry,
      });
    }
  }

  const tabWorkingSince = new Map();
  for (const sp of spacesList ?? []) {
    for (const tab of sp?.tabs ?? []) {
      if (tab?.id && typeof tab.working_since === "number") {
        tabWorkingSince.set(tab.id, tab.working_since);
      }
    }
  }

  const progTotals = new Map();
  for (const a of agentsList ?? []) {
    if (!a) continue;
    const pname = a.program?.name || a.app || "Agent";
    progTotals.set(pname, (progTotals.get(pname) ?? 0) + 1);
  }
  const progSeen = new Map();
  const agentsWithMeta = (agentsList ?? []).map((a) => {
    const pname = a.program?.name || a.app || "Agent";
    const idx = (progSeen.get(pname) ?? 0) + 1;
    progSeen.set(pname, idx);
    const displayProgram = (progTotals.get(pname) ?? 0) > 1 ? `${pname} #${idx}` : pname;
    const ws = tabWorkingSince.get(a.tab) ?? null;
    return {
      ...a,
      displayProgram,
      workingSince: ws,
      machineKey: machineFromAddress(a.address),
    };
  });

  const models = Array.from(merged.values()).map((m) => {
    const res = m.collectorEntry?.result ?? null;
    const system = res?.system ?? null;
    const serveList = tailscaleRoutes(res?.tailscale ?? (m.isLocal ? ts : null));
    const funnelEntry = serveList.find((s) => s.funnel);
    const funnelPort = funnelEntry ? funnelEntry.port : null;

    const remoteRaw = !m.isLocal && m.collectorEntry?.error !== INVALID_COLLECTOR_RESULT
      ? remoteMap.get(m.key)?.entry ?? null
      : null;
    const remoteInfo = remoteRaw ? parseRemoteMachineEntry(remoteRaw) : null;
    const dockerInfo = res?.docker ? buildDockerModel(res.docker) : remoteInfo;

    const rawPorts = Array.isArray(res?.ports) ? res.ports : null;
    const publicPortsCount = rawPorts
      ? rawPorts.filter((p) => p && p.access === "public").length
      : 0;
    let summarizedPorts = summarizePorts(rawPorts, serveList);
    if (!summarizedPorts && remoteInfo?.ports) {
      summarizedPorts = remoteInfo.ports.map((p, idx) => ({
        id: `${p.port}-${p.addr}-${idx}`,
        port: p.port,
        addr: p.addr,
        process: p.process || "—",
        access: p.access,
        bindScope: p.bindScope,
        bindLabel: p.bindLabel,
        cwd: null,
        funnelPort: null,
        funnelDirectPort: null,
        servePort: null,
      }));
    }

    const machineAgents = m.isHerdrMachine
      ? agentsWithMeta.filter((a) =>
          m.isLocal ? a.machineKey === null : a.machineKey === m.herdrName,
        )
      : [];

    const isOnline = Boolean(m.online || (remoteInfo && remoteInfo.ok));

    let statusText = "—";
    let statusTone = "offline";
    if (m.isLocal) {
      statusText = "online · this computer";
      statusTone = "ok";
    } else if (m.inTailscale) {
      if (isOnline) {
        statusText = m.isHerdrMachine ? "online" : "online · Tailscale only";
        statusTone = "ok";
      } else {
        statusText = formatOfflineAgo(m.lastSeen, now);
        statusTone = "offline";
      }
    } else if (remoteInfo?.ok) {
      statusText = "connected · SSH";
      statusTone = "ok";
    } else {
      statusText = layoutStateLabel(m.herdrLayout);
      statusTone =
        m.herdrLayout === "ready" ? "ok" : m.herdrLayout === "loading" ? "warn" : "offline";
    }

    const shortPathParts = [];
    if (m.inTailscale) shortPathParts.push("Tailscale");
    if (m.isHerdrMachine && !m.isLocal) {
      shortPathParts.push(m.inTailscale ? "+ SSH" : "SSH");
    }
    const shortPathBase = shortPathParts.join(" ") || (m.isLocal ? "Local" : "—");
    const connectionPathShort =
      funnelPort !== null ? `${shortPathBase} · Funnel` : shortPathBase;

    const detailPathParts = [];
    if (m.isLocal) detailPathParts.push("Local");
    if (m.inTailscale) detailPathParts.push("Tailscale");
    if (m.isHerdrMachine && !m.isLocal) detailPathParts.push("SSH");
    if (funnelPort !== null) detailPathParts.push(`Funnel :${funnelPort}`);
    const connectionPathDetail = detailPathParts.join(" · ") || "—";

    const network = res?.network ?? null;
    const enriched = {
      ...m,
      online: isOnline,
      system,
      network,
      remote: dockerInfo,
      collectError: m.collectorEntry?.error ?? null,
      collectAt: m.collectorEntry?.at ?? null,
      serveList,
      funnelPort,
      rawPorts,
      ports: summarizedPorts,
      publicPortsCount,
      machineAgents,
      statusText,
      statusTone,
      connectionPathShort,
      connectionPathDetail,
    };

    enriched.traffic = computeTrafficModel(enriched, limitsMap, now);
    return enriched;
  });

  models.sort((a, b) => {
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    if (a.isHerdrMachine !== b.isHerdrMachine) return a.isHerdrMachine ? -1 : 1;
    return String(a.displayName).localeCompare(String(b.displayName));
  });

  let latestCollectAt = null;
  for (const e of entries) {
    if (typeof e?.at === "number" && (latestCollectAt === null || e.at > latestCollectAt)) {
      latestCollectAt = e.at;
    }
  }

  return {
    models,
    tailnetName: ts?.tailnet || null,
    latestCollectAt,
  };
}
