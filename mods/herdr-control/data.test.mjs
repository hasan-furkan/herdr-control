// Regression tests for collector validation, view models and streaming mode.
// Run with: node --test mods/herdr-control/data.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

let localCatalogAvailable = false;

// Stub the Herdr runtime when running under Node.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "herdr") {
      return { url: "herdr://stub", shortCircuit: true };
    }
    if (specifier === "gpui-kit" || specifier === "gpui-base") {
      return { url: "gpui://stub", shortCircuit: true };
    }
    if (specifier === "./catalog.local.js") {
      if (!localCatalogAvailable) throw new Error("The optional catalog is absent");
      return { url: "data:text/javascript,export const CATALOG = [];", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "gpui://stub") {
      return {
        format: "module",
        source: `
          export class View {}
          function element() {
            const result = { content: [], actions: {}, labels: [] };
            const proxy = new Proxy(result, {
              get(target, name) {
                if (name in target) return target[name];
                if (name === "then" || typeof name !== "string") return undefined;
                return (...args) => {
                  if (name === "child") target.content.push(args[0]);
                  if (name === "children") target.content.push(...args[0]);
                  if (name === "when" && args[0]) args[1](proxy);
                  if (name === "id") target.elementId = args[0];
                  if ((name === "tooltip" || name === "accessibility_label") && typeof args[0] === "string") {
                    target.labels.push(args[0]);
                  }
                  if (name.startsWith("on_")) target.actions[name] = args.at(-1);
                  return proxy;
                };
              },
            });
            return proxy;
          }
          export const div = element, h_flex = element, v_flex = element, svg = element, image = element;
          export const Switch = { new: element };
          export const ScrollHandle = { new: () => ({ scroll_to_item() {} }) };
          export const TextView = { markdown: (_id, text) => element().child(text) };
        `,
        shortCircuit: true,
      };
    }
    if (url === "herdr://stub") {
      return {
        format: "module",
        source: `
          export const state = new Map();
          export const targets = [];
          export const hostReads = [];
          export const calls = [];
          export const transport = { exec: null };
          const read = (name, value) => { hostReads.push(name); return value; };
          export const fonts = () => read("fonts", ["PRIVATE_FONT"]);
          export const settings = () => read("settings", { ui_font: "PRIVATE_FONT" });
          export const machines = () => read("machines", targets);
          export const spaces = () => read("spaces", [{ name: "PRIVATE_SPACE" }]);
          export const agents = () => read("agents", [{ title: "PRIVATE_AGENT" }]);
          export const panes = () => read("panes", [{ title: "PRIVATE_PANE" }]);
          export const terminals = () => read("terminals", [{ name: "PRIVATE_TERMINAL" }]);
          export const focused = () => read("focused", { terminal: "PRIVATE_ADDRESS" });
          export const keys = () => read("keys", []);
          export const commands = () => read("commands", []);
          export const props = () => ({});
          export const theme = () => ({});
          export const window = () => ({ platform: "windows" });
          export const shared = (key) => state.get(key);
          export const setShared = (key, value) => state.set(key, value);
          export const checking = () => false;
          export const exec = (...args) => transport.exec(...args);
          export const hc = (...args) => calls.push(["hc", ...args]);
          export const setAgentOrder = (...args) => calls.push(["setAgentOrder", ...args]);
          export const openOverlay = (...args) => calls.push(["openOverlay", ...args]);
          export const closeOverlay = (...args) => calls.push(["closeOverlay", ...args]);
          export const readTextFile = (...args) => calls.push(["readTextFile", ...args]);
          export const layout = () => state.get("test.layout") ?? {};
          export const run = (...args) => calls.push(args);
          export const commandWaiters = [];
          export const nextCommand = () => new Promise((resolve) => commandWaiters.push(resolve));
        `,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const {
  dedupeBackgroundLive,
  buildShellSummary,
  machineFromAddress,
  parseSsOutput,
  parseDockerPsOutput,
  parseDockerStatsOutput,
  parseDockerNetIo,
  isValidDockerContainerName,
  buildDockerLogsTabSpec,
  mergeDockerContainers,
  parseRemoteMachineEntry,
  formatAddrPort,
  summarizePorts,
  buildMachinesView,
  buildMachineModels,
  buildUsageRows,
  countLabel,
  formatTokens,
  summarizeUsageTokens,
  INVALID_COLLECTOR_RESULT,
  sidebarLayout,
  summarizeUsageCard,
  tailscaleRoutes,
  validateCollectorResult,
} = await import("./data.js");
const { COLLECT_KEY, collectedEntry, startCollector } = await import("./collector.js");
const { COLLECTOR_BOOTSTRAP } = await import("./collector/packed.js");
const { CATALOG, loadCatalog } = await import("./catalog.js");
const {
  STREAM_KEY, formatDockerPortsDisplay, maskBranch, maskContainer, maskError, maskHost,
  maskIp, maskPath, maskText, maskTitle, maskUser,
} = await import("./mask.js");
const { state, targets, transport, hostReads, calls, commandWaiters } = await import("herdr");
const { getDemoData, DEMO_KEY, TOGGLE_DEMO_COMMAND } = await import("./demo.js");
const { isDemo, setDemo } = await import("./demo-mode.js");
const { readDashboard } = await import("./source.js");
const { default: HerdrControl } = await import("./main.js");
const { default: Tabs } = await import("../herdr-control-tabs/main.js");
const { default: Phrases } = await import("../herdr-control-phrases/main.js");

test("demo fixtures survive collector validation and exercise the dashboard view models", () => {
  const now = new Date();
  const demo = getDemoData(now);
  for (const { machine, result } of demo.collectEntries) {
    if (machine === "staging") {
      assert.equal(result, null);
      continue;
    }
    assert.deepEqual(validateCollectorResult(result, { remote: machine !== null }), result);
  }
  const summary = buildShellSummary({ ...demo, now });
  assert.equal(summary.userLine, "demo@control-desk");
  assert.equal(summary.tailnetName, "example-tailnet.ts.net");
  assert.equal(summary.onlineMachines, 4);
  assert.equal(summary.totalMachines, 5);
  assert.equal(summary.publicPorts, 2);
  assert.equal(summary.blockedAgents, 2);
  assert.equal(summary.spacesCount, 3);
  assert.equal(summary.liveTerminals, 5);
  const rows = buildUsageRows(demo.collectEntries, now);
  assert.equal(rows.length, 4);
  assert.equal(rows.find((row) => row.id === "claude").five, 23);
  assert.deepEqual(rows.filter((row) => row.limitNotice).map((row) => row.id), ["opencode"]);
  const quota = demo.localEntry.result.limits;
  const nowSeconds = now.getTime() / 1000;
  for (const id of ["claude", "codex", "antigravity"]) {
    assert.ok(quota[id].five.resets_at > nowSeconds);
    assert.ok(quota[id].week.resets_at > nowSeconds);
  }
  assert.ok(quota.opencode.reached.resets_at > nowSeconds);
  const { models } = buildMachineModels({ ...demo, limitsMap: demo.limits, now });
  const build = models.find((machine) => machine.key === "build-server");
  assert.deepEqual(build.remote.containers.map(({ name }) => name).sort(), ["api", "postgres", "web", "worker"]);
  assert.equal(build.traffic.limitB, 4.5 * 10 ** 12);
  assert.equal(buildMachinesView(demo).reduce((count, machine) => count + machine.terminalCount, 0), 5);
  assert.equal(models.find((machine) => machine.key === "staging").online, false);
});

test("demo timestamps roll forward with the wall clock", () => {
  const first = new Date(2030, 11, 31, 23, 59);
  const second = new Date(2031, 0, 1, 0, 0);
  for (const [now, date] of [[first, "2030-12-31"], [second, "2031-01-01"]]) {
    const result = getDemoData(now).localEntry.result;
    assert.equal(result.usage.days[0].date, date);
    assert.equal(Date.parse(result.generated_at), now.getTime() - 60_000);
    assert.equal(result.limits.opencode.reached.resets_at * 1000 - now.getTime(), 2 * 86_400_000);
  }
});

function renderedText(element) {
  if (typeof element === "string") return element;
  return [...(element?.labels ?? []), ...(element?.content ?? []).map(renderedText)].join("\n");
}

test("screenshot commands drive the layout and full tab in live and demo modes", async () => {
  const routes = [
    ["goto-overview", "overview"], ["goto-spaces", "spaces"],
    ["goto-machines", "machines"], ["goto-ports", "ports"],
    ["goto-approvals", "approvals"], ["goto-agents-now", "agents", "now"],
    ["goto-agents-usage", "agents", "usage"], ["goto-agents-catalog", "agents", "catalog"],
  ];

  try {
    for (const part of ["nav", null]) {
      for (const demo of [false, true]) {
        state.clear();
        calls.length = 0;
        commandWaiters.length = 0;
        if (part === "nav") state.set("layout", "herdr-control");
        setDemo(demo);
        const tasks = [];
        const cx = { spawn: (task) => tasks.push(task), notify() {}, timer: { every() {} } };
        const owner = new HerdrControl();
        owner.init({ part }, cx);
        tasks.at(-1)(cx);
        async function send(command) {
          commandWaiters.shift()(command);
          await Promise.resolve();
        }

        for (const [command, screen, tab] of routes) {
          calls.length = 0;
          if (part === "nav") state.set("herdr-control.view", "terminal");
          await send(command);
          assert.equal(owner.currentScreen(), screen, command);
          if (tab) assert.equal(owner.currentAgentsTab(), tab, command);
          if (part === "nav") {
            assert.equal(state.get("herdr-control.view"), "screen");
            assert.deepEqual(calls.at(-1), ["layout.select", { stack: "work-stack", child: "screen" }]);
          }
        }

        await send("stream-on");
        assert.equal(state.get(STREAM_KEY), true);
        await send("stream-off");
        assert.equal(state.get(STREAM_KEY), false);
        await send("usage-collapse");
        assert.equal(state.get("herdr-control.usageCollapsed"), true);
        await send("usage-expand");
        assert.equal(state.get("herdr-control.usageCollapsed"), false);
        if (part === "nav" && demo) {
          owner.height = 800;
          assert.match(renderedText(owner.render(cx)), /^OpenCode$/m);
          await send("usage-collapse");
          assert.doesNotMatch(renderedText(owner.render(cx)), /^OpenCode$/m);
        }
        await send("goto-agents-unknown");
        assert.equal(owner.currentAgentsTab(), "catalog");
      }
    }
  } finally {
    state.clear();
    calls.length = 0;
    commandWaiters.length = 0;
  }
});

test("demo screens and optional mods never read live data or launch a process", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2031, 0, 1, 14, 32) });
  hostReads.length = 0;
  calls.length = 0;
  const tasks = [];
  const ticks = [];
  const processes = [];
  const cx = {
    spawn: (task) => tasks.push(task),
    notify() {},
    timer: { every: (_ms, task) => ticks.push(task) },
  };
  transport.exec = (...args) => processes.push(args);
  targets.push({ name: "PRIVATE_MACHINE", layout: "ready" });
  state.set(COLLECT_KEY, {
    schema: 1,
    machines: { local: { result: { system: { hostname: "PRIVATE_HOST", username: "PRIVATE_USER" } } } },
  });
  try {
    const owner = new HerdrControl();
    // Enable through the same nextCommand route used by Herdr.
    owner.init({ part: "nav" }, cx);
    state.set("herdr-control.machine", "workstation");
    const [listener] = tasks.splice(-1);
    listener(cx);
    commandWaiters.shift()(TOGGLE_DEMO_COMMAND);
    await Promise.resolve();
    assert.equal(state.get(DEMO_KEY), true);
    assert.equal(readDashboard(), getDemoData());

    const dashboard = new HerdrControl();
    dashboard.init({ part: "content" }, cx);
    dashboard.approvalError = "PRIVATE_APPROVAL";
    dashboard.spacesError = { scope: "list", message: "PRIVATE_GIT" };
    dashboard.healthChecks = { claude: { version: "PRIVATE_VERSION" } };
    owner.navTerminalError = "PRIVATE_NAV_ERROR";
    const fragments = [];
    for (const screen of ["overview", "spaces", "machines", "ports", "agents", "approvals"]) {
      state.set("herdr-control.screen", screen);
      for (const tab of screen === "agents" ? ["now", "usage", "catalog"] : ["now"]) {
        state.set("herdr-control.agentsTab", tab);
        const content = renderedText(dashboard.render(cx));
        assert.match(content, /DEMO DATA/);
        if (screen === "overview") {
          for (const number of [1, 2, 3]) assert.match(content, new RegExp(`Claude Code #${number}`));
          assert.doesNotMatch(content, /^claude$/m);
        }
        if (screen === "machines") {
          assert.match(content, /postgres:16/);
          assert.match(content, /4\.5 TB/);
        }
        fragments.push(content);
      }
    }
    for (const part of ["aside", "status"]) {
      const mod = new HerdrControl();
      mod.init({ part }, cx);
      fragments.push(renderedText(mod.render(cx)));
    }
    const tabs = new Tabs();
    tabs.init();
    fragments.push(renderedText(tabs.render()));
    const phrases = new Phrases();
    phrases.init({}, cx);
    fragments.push(renderedText(phrases.render()));
    fragments.push(renderedText(owner.render(cx)));
    assert.doesNotMatch(fragments.join("\n"), /PRIVATE_/);
    assert.match(fragments.join("\n"), /Approve database migration/);
    assert.match(fragments.join("\n"), /Follow up/);
    assert.match(fragments.join("\n"), /Update api preview/);
    state.set(STREAM_KEY, true);
    assert.match(renderedText(owner.render(cx)), /machine-1/);

    dashboard.runAgentHealthChecks([{ id: "test", cmd: "never" }], cx);
    dashboard.createTerminalFromUi(null, "nav", cx);
    dashboard.returnToTerminal();
    phrases.load(cx);
    for (const tick of ticks) tick(cx);
    assert.equal(tasks.length, 1, "only the deferred live collector was queued");
    await tasks[0](cx);
    assert.deepEqual(processes, []);
    assert.deepEqual(hostReads, []);
    assert.deepEqual(calls, []);
    commandWaiters.shift()(TOGGLE_DEMO_COMMAND);
    await Promise.resolve();
    assert.equal(isDemo(), false);
    assert.equal(tasks.length, 2, "disabling demo immediately schedules a live refresh");
  } finally {
    setDemo(false);
    assert.equal(isDemo(), false);
    transport.exec = null;
    state.clear();
    targets.length = 0;
    commandWaiters.length = 0;
  }
});

test("the catalog uses the default until a local override is available", async () => {
  assert.equal(await loadCatalog(), CATALOG);
  localCatalogAvailable = true;
  try {
    assert.deepEqual(await loadCatalog(), []);
  } finally {
    localCatalogAvailable = false;
  }
});

test("collector validation keeps usable fields and drops bad types, oversized arrays and NaN", () => {
  const entry = {
    version: 1,
    system: { hostname: "workstation", cpu_pct: NaN, uptime_s: Infinity, cpu_cores: "8", os: "x".repeat(501) },
    tailscale: {
      self: { name: "workstation", ip: [] },
      peers: { length: 1 },
      serve: [],
    },
    ports: [
      null,
      { port: "80" },
      { port: 65536 },
      { port: 443, access: "public", process: false, addr: "127.0.0.1" },
    ],
    network: { days: Array(2001).fill({ date: "2026-11-20", rx_b: 1, tx_b: 2 }), source: "counters" },
    limits: { claude: { five: { remaining: 101 }, week: { remaining: 42 } } },
    usage: { days: [{ date: "2026-11-20", provider: "codex", input: 100, output: NaN }] },
    errors: ["read failed", { message: "wrong type" }],
    notes: ["claude: 2 files pending", 5, "x".repeat(501)],
    secret: "unknown field",
  };
  assert.deepEqual(validateCollectorResult(entry), {
    version: 1,
    system: { hostname: "workstation" },
    tailscale: { self: { name: "workstation" }, serve: [] },
    ports: [{ port: 443, access: "public", addr: "127.0.0.1" }],
    network: { source: "counters" },
    limits: { claude: { week: { remaining: 42 } } },
    usage: { days: [{ date: "2026-11-20", provider: "codex", input: 100 }] },
    errors: ["read failed"],
    notes: ["claude: 2 files pending"],
  });
  assert.equal(validateCollectorResult({ version: 1, tailscale: { serve: {} }, ports: "bogus", errors: [], notes: [] }), null);
  assert.equal(validateCollectorResult({ notes: Array(2001).fill("claude: 2 files pending") }), null);
  assert.equal(validateCollectorResult({ system: { cpu_pct: NaN }, ports: Array(2001).fill({ port: 1 }) }), null);
  for (const value of [null, [], {}, "broken"]) assert.equal(validateCollectorResult(value), null);
  assert.deepEqual(validateCollectorResult({ ports: [] }), { ports: [] });
  const partial = validateCollectorResult({ ports: [{ port: 80, access: "bogus" }] });
  assert.equal(summarizePorts(partial.ports, [])[0].access, "unknown");
});

test("collector uses the remote profile and discards invalid results per machine", async () => {
  const docker = {
    docker_ps_rc: 0,
    docker_ps: '{"ID":"ab12","Names":"web","State":"running","Ports":"127.0.0.1:8080->80/tcp"}',
  };
  const notes = ["claude: 2 files pending"];
  const calls = [];
  const jobs = [];
  targets.push({ name: "good", layout: "ready" }, { name: "bad", layout: "ready" });
  state.set(COLLECT_KEY, { machines: { bad: { result: { system: { hostname: "old" } }, at: 1 } } });
  transport.exec = (command, argv, options) => {
    calls.push({ command, argv, options });
    if (options.on === "good" && command === "python3") return Promise.resolve({ code: 1 });
    const result = options.on === "bad"
      ? { tailscale: { peers: "wrong" }, system: { cpu_pct: "invalid" } }
      : { ports: [], docker, notes, usage: { days: [] }, live: [], installed: { codex: true }, remote: {} };
    return Promise.resolve({ code: 0, stdout: JSON.stringify(result) });
  };
  try {
    startCollector("nav", { timer: { every() {} }, spawn: (job) => jobs.push(job()) });
    await Promise.all(jobs);
    assert.equal(calls.length, 4);
    for (const { command, argv, options } of calls) {
      assert.deepEqual(argv, [
        ...(command === "py" ? ["-3"] : []),
        "-I", "-c", COLLECTOR_BOOTSTRAP,
        ...(options.on ? ["--remote"] : []),
      ]);
    }
    assert.deepEqual(collectedEntry("bad"), { result: null, at: null, error: INVALID_COLLECTOR_RESULT });
    assert.deepEqual(collectedEntry("good").result, { ports: [], docker, notes });
    const localEntry = collectedEntry();
    assert.deepEqual(localEntry.result.usage, { days: [] });
    assert.deepEqual(localEntry.result.notes, notes);
    const { models } = buildMachineModels({
      machinesList: targets, collectEntries: [
        { machine: "good", ...collectedEntry("good") },
        { machine: "bad", ...collectedEntry("bad") },
      ], localEntry,
    });
    assert.equal(models.find((m) => m.key === "good").remote.containers[0].name, "web");
    assert.equal(models.find((m) => m.key === "good").collectError, null);
    assert.equal(models.find((m) => m.key === "bad").collectError, INVALID_COLLECTOR_RESULT);
  } finally {
    targets.length = 0;
    transport.exec = null;
    state.clear();
  }
});

test("streaming hides raw values and only renders validated Docker port labels", () => {
  const path = "C:\\Users\\private-user";
  const title = "private title";
  const argv = "tool --token private";
  const rawPorts = { portsRaw: "192.0.2.1:3000" };
  assert.equal(maskPath(path), path);
  assert.equal(maskTitle(title), title);
  assert.equal(formatDockerPortsDisplay(rawPorts), rawPorts.portsRaw);

  state.set(STREAM_KEY, true);
  try {
    assert.equal(maskPath(path), "hidden");
    assert.equal(maskText(argv), "hidden");
    assert.equal(maskTitle(title), "terminal");
    assert.equal(maskBranch("private-user/branch"), "branch");
    assert.equal(maskError(`Permission denied: ${path}`), "Command failed");
    assert.equal(maskIp("192.0.2.1"), "•••");
    assert.equal(maskUser("private-user@local"), "•••@machine-1");
    assert.equal(maskHost("secret-host"), "machine-?");
    assert.equal(maskContainer("private", 1), "container-2");
    assert.equal(maskText("—"), "—");
    assert.equal(formatDockerPortsDisplay(rawPorts), "hidden");
    assert.equal(formatDockerPortsDisplay({
      ...rawPorts,
      publishedPorts: [
        { hostAddr: "192.0.2.1", hostPort: "3000", containerPort: "80/tcp" },
        { hostPort: "private-host", containerPort: "80/tcp" },
        { hostPort: "3000", containerPort: "private-user" },
        { hostPort: "65536", containerPort: "80/tcp" },
      ],
    }), "•••:3000→80/tcp");
  } finally {
    state.delete(STREAM_KEY);
  }
});

test("formats compact token counts, estimates and missing values", () => {
  assert.equal(formatTokens(1_200_000), "1.2M tok");
  assert.equal(formatTokens(23_000, { estimated: true }), "~23K tok");
  assert.equal(formatTokens(1_410_000_000, { unit: false }), "1.4B");
  assert.equal(formatTokens(25), "25 tok");
  assert.equal(formatTokens(0), "0 tok");
  assert.equal(formatTokens(undefined), "—");
  assert.equal(formatTokens(null, { estimated: true }), "—");
});

test("formats singular and plural counts", () => {
  assert.equal(countLabel(1, "terminal"), "1 terminal");
  assert.equal(countLabel(0, "terminal"), "0 terminals");
  assert.equal(countLabel(2, "terminal"), "2 terminals");
});

test("usage rows combine today's machine tokens with the newest provider limits", () => {
  const now = new Date(2026, 10, 20, 12);
  const reset = now.getTime() / 1000 + 130 * 60;
  const date = "2026-11-20";
  const entries = [
    { result: null },
    { result: {
      limits: {
        claude: { five: { remaining: 92, resets_at: null }, read_at: 1 },
        codex: { five: null, week: { remaining: 0, resets_at: reset } },
      },
      usage: { days: [
        { date, provider: "claude", input: 900_000 },
        { date, provider: "antigravity", input: 2615, output: 403, cache_read: 6981 },
        { date, provider: "opencode", input: 100 },
        { date: "2026-11-19", provider: "claude", input: 900_000 },
      ] },
    } },
    { result: {
      limits: {
        claude: { five: { remaining: 87, resets_at: reset }, week: { remaining: 46 }, read_at: 2 },
        opencode: { five: { remaining: 57 } },
      },
      usage: { days: [{ date, provider: "claude", output: 200_000, cache_read: 80_000, cache_write: 20_000 }] },
    } },
  ];
  assert.deepEqual(buildUsageRows(entries, now), [
    { id: "claude", label: "Claude", five: 87, week: 46, countdown: "2h 10m", tokens: "1.2M tok" },
    { id: "codex", label: "Codex", five: null, week: 0, countdown: "—", tokens: "—" },
    { id: "antigravity", label: "Antigravity", five: null, week: null, countdown: "—", tokens: "~10K tok" },
    { id: "opencode", label: "OpenCode", five: null, week: null, countdown: "—", tokens: "100 tok" },
  ]);
  assert.equal(summarizeUsageTokens(entries, date).total, 1_210_099);
  assert.equal(summarizeUsageTokens(entries, date).estimated, true);
  assert.equal(summarizeUsageTokens(entries.slice(0, 1), date).total, null);
  assert.equal(summarizeUsageTokens(entries, "2026-11-18").total, 0);
  assert.equal(buildUsageRows(entries, new Date(reset * 1000 + 1))[0].countdown, "—");
});

test("sidebar switches to single-line cards at the short-height boundaries", () => {
  for (const height of [900, 1150]) {
    assert.deepEqual(sidebarLayout(height), { usageCollapsed: false, tailnetCompact: false });
  }
  for (const height of [700, 800, 899.5]) {
    assert.deepEqual(sidebarLayout(height), { usageCollapsed: true, tailnetCompact: false });
  }
  for (const height of [1, 699.5, 0, -1, null, undefined, NaN, Infinity]) {
    assert.deepEqual(sidebarLayout(height), { usageCollapsed: true, tailnetCompact: true });
  }
});

test("collapsed usage highlights the lowest five-hour quota or falls back to token activity", () => {
  const claude = { label: "Claude", five: 52, tokens: "—" };
  const codex = { label: "Codex", five: 0, tokens: "—" };
  const opencode = { label: "OpenCode", five: null, tokens: "100 tok" };
  assert.equal(summarizeUsageCard([claude, codex, opencode]), "Codex · 5h 0%");
  assert.equal(summarizeUsageCard([claude, codex, opencode], { compact: true }), "5h 0%");
  assert.equal(summarizeUsageCard([opencode]), "OpenCode · 100 tok");
  assert.equal(summarizeUsageCard([{ ...claude, five: null }, { ...codex, five: null }]), "2 providers");
  assert.equal(summarizeUsageCard([]), "—");
});

test("the OpenCode log signal appears without tokens, takes priority, and expires", () => {
  const now = new Date(2026, 10, 20, 12);
  const reset = new Date(2026, 10, 24, 12);
  const result = validateCollectorResult({
    limits: {
      codex: { five: { remaining: 0 } },
      opencode: {
        reached: { window: "monthly", resets_at: reset.getTime() / 1000 },
        source: "log",
        url: "private",
      },
    },
  });
  assert.deepEqual(result.limits.opencode, {
    reached: { window: "monthly", resets_at: reset.getTime() / 1000 }, source: "log",
  });
  assert.equal(validateCollectorResult({
    ports: [], limits: { opencode: { reached: { window: "private", resets_at: 1 }, source: "log" } },
  }).limits, undefined);
  const rows = buildUsageRows([{ result }], now);
  assert.equal(rows[1].limitNotice, "monthly limit reached · resets Nov 24");
  assert.equal(rows[1].tokens, "—");
  assert.equal(summarizeUsageCard(rows), "OpenCode · monthly limit reached · resets Nov 24");
  assert.equal(summarizeUsageCard(rows, { compact: true }), "Limit reached");
  assert.deepEqual(buildUsageRows([{ result }], reset).map((row) => row.id), ["codex"]);
});

test("Funnel ports annotate structured Serve routes and work without a matching route", () => {
  const result = validateCollectorResult({
    tailscale: {
      funnel_ports: [443, 8443, 70000, "8080"],
      serve: [
        { port: 443, proto: "https", target: "backend:8080" },
        { port: 8000, proto: "tcp", target: "[::1]:8081" },
      ],
    },
    ports: [
      { port: 8080, access: "public" },
      { port: 8081, access: "tailnet" },
      { port: 8443, access: "tailnet" },
    ],
  });
  assert.deepEqual(result.tailscale.funnel_ports, [443, 8443]);
  const localEntry = { machine: null, result };
  assert.equal(buildShellSummary({ collectEntries: [localEntry], localEntry }).funnelPort, 443);
  const rows = summarizePorts(result.ports, tailscaleRoutes(result.tailscale));
  assert.equal(rows.find((row) => row.port === 8080).funnelPort, 443);
  assert.equal(rows.find((row) => row.port === 8081).servePort, 8000);
  assert.equal(rows.find((row) => row.port === 8443).funnelDirectPort, 8443);
  assert.equal(tailscaleRoutes({ funnel_ports: [], serve: [{ port: 443, funnel: true }] })[0].funnel, false);
});

test("usage rows ignore older Antigravity hour-only data and providers with no data", () => {
  const now = new Date(2026, 10, 20);
  assert.deepEqual(buildUsageRows([{ result: {
    usage: { days: [{ date: "2026-11-20", provider: "antigravity", active_s: 3600, estimated: true }] },
    limits: { claude: null, codex: {}, antigravity: null },
  } }], now), []);
});

test("drops duplicate background antigravity live row matching live Herdr agent", () => {
  const machinesList = [{ name: null, layout: "ready" }];
  const spacesList = [
    {
      id: "sp1",
      name: "~",
      machine: null,
      folder: "C:\\Users\\alex",
    },
    {
      id: "sp2",
      name: "demo",
      machine: null,
      folder: "C:\\Users\\alex\\projects\\demo",
    },
  ];
  const agentsList = [
    {
      address: "t27",
      app: "antigravity",
      program: { key: "antigravity", name: "Antigravity" },
      space: "sp2",
      space_name: "demo",
      tab: "tb1",
      pane: "p2",
      status: "working",
      title: "t27",
    },
  ];
  const terminalsList = [
    { address: "t22", cwd: "C:\\Users\\alex", state: "live" },
    {
      address: "t27",
      cwd: "C:\\Users\\alex\\projects\\demo",
      state: "live",
    },
  ];
  const panesList = [
    {
      pane: "p1",
      terminal: "t22",
      cwd: "C:\\Users\\alex",
    },
    {
      pane: "p2",
      terminal: "t27",
      cwd: "C:\\Users\\alex\\projects\\demo",
    },
  ];
  const localEntry = {
    machine: null,
    result: {
      system: { hostname: "WORKSTATION" },
      tailscale: { self: { name: "workstation" }, peers: [], serve: [] },
      ports: [],
      live: [
        {
          provider: "antigravity",
          since: "2025-01-15T21:54:53+01:00",
          folder: "C:\\Users\\alex\\projects\\demo",
        },
      ],
    },
  };
  const collectEntries = [localEntry];

  assert.equal(machineFromAddress("t27"), null);

  const bgLive = dedupeBackgroundLive({
    collectEntries,
    agentsList,
    spacesList,
    terminalsList,
    panesList,
  });
  assert.deepEqual(bgLive, []);

  const summary = buildShellSummary({
    machinesList,
    spacesList,
    agentsList,
    terminalsList,
    panesList,
    collectEntries,
    localEntry,
  });
  assert.equal(summary.agentsCount, 1);
});

test("keeps genuinely external background antigravity row when a second folder is active", () => {
  const collectEntries = [
    {
      machine: null,
      result: {
        live: [
          {
            provider: "antigravity",
            since: "2025-01-15T21:54:53+01:00",
            folder: "C:\\Users\\alex\\projects\\demo",
          },
          {
            provider: "antigravity",
            since: "2025-01-15T21:50:00+01:00",
            folder: "C:\\Users\\alex\\projects\\other-demo",
          },
        ],
      },
    },
  ];
  const agentsList = [
    {
      address: "t27",
      app: "antigravity",
      program: { key: "antigravity", name: "Antigravity" },
      space: "sp1",
      pane: "p1",
      status: "working",
    },
  ];
  const spacesList = [
    {
      id: "sp1",
      machine: null,
      folder: "C:\\Users\\alex\\projects\\demo",
    },
  ];

  const bgLive = dedupeBackgroundLive({
    collectEntries,
    agentsList,
    spacesList,
    terminalsList: [],
    panesList: [],
  });
  assert.equal(bgLive.length, 1);
  assert.equal(bgLive[0].item.folder, "C:\\Users\\alex\\projects\\other-demo");
});

test("dedupes remote machine antigravity agent against matching remote collector entry", () => {
  const collectEntries = [
    {
      machine: "laptop",
      result: {
        live: [
          {
            provider: "antigravity",
            since: "2025-01-15T21:54:53+01:00",
            folder: "/home/alex/projects/demo",
          },
        ],
      },
    },
  ];
  const agentsList = [
    {
      address: "laptop/t3",
      app: "agy",
      program: { key: "antigravity", name: "Antigravity" },
      space: "laptop/sp1",
      pane: "laptop/p1",
      status: "working",
    },
  ];
  const panesList = [
    { pane: "laptop/p1", terminal: "laptop/t3", cwd: "/home/alex/projects/demo" },
  ];

  const bgLive = dedupeBackgroundLive({
    collectEntries,
    agentsList,
    spacesList: [],
    terminalsList: [],
    panesList,
  });
  assert.deepEqual(bgLive, []);
});

test("parseSsOutput parses build-server sample lines, IPv6 [::]:22, process names, and classifies scopes", () => {
  const sample = [
    "State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process",
    "LISTEN 0      1000   10.255.255.254:53    0.0.0.0:*",
    "LISTEN 0      4096        127.0.0.1:2223  0.0.0.0:*",
    "LISTEN 0      4096        127.0.0.1:18081 0.0.0.0:*",
    "LISTEN 0      4096        127.0.0.1:18082 0.0.0.0:*",
    'LISTEN 0      128              [::]:22       [::]:*    users:(("sshd",pid=412,fd=3))',
    "LISTEN 0      128             [::1]:8080     [::]:*",
    "LISTEN 0      128           0.0.0.0:80    0.0.0.0:*",
  ].join("\n");

  const parsed = parseSsOutput(sample);
  assert.equal(parsed.length, 7);

  const p22 = parsed.find((r) => r.port === 22);
  assert.deepEqual(p22, {
    addr: "::",
    port: 22,
    process: "sshd",
    hasProcess: true,
    pid: 412,
    bindScope: "all",
    bindLabel: "all interfaces",
    access: "all_interfaces",
  });
  assert.equal(formatAddrPort(p22.addr, p22.port), "[::]:22");

  const p53 = parsed.find((r) => r.port === 53);
  assert.equal(p53.addr, "10.255.255.254");
  assert.equal(p53.bindScope, "specific");
  assert.equal(p53.bindLabel, "specific interface");
  assert.equal(p53.process, "—");
  assert.equal(p53.hasProcess, false);

  const p80 = parsed.find((r) => r.port === 80);
  assert.equal(p80.bindScope, "all");
  assert.equal(p80.bindLabel, "all interfaces");

  const p2223 = parsed.find((r) => r.port === 2223);
  assert.equal(p2223.addr, "127.0.0.1");
  assert.equal(p2223.bindScope, "local");
  assert.equal(p2223.bindLabel, "this machine only");

  const p8080 = parsed.find((r) => r.port === 8080);
  assert.equal(p8080.addr, "::1");
  assert.equal(p8080.bindScope, "local");
  assert.equal(p8080.bindLabel, "this machine only");
});

test("parseSsOutput skips malformed lines and handles empty input", () => {
  assert.deepEqual(parseSsOutput(""), []);
  assert.deepEqual(parseSsOutput(null), []);
  assert.deepEqual(parseSsOutput("   \n  \n"), []);

  const malformed = [
    "ESTAB  0 0 127.0.0.1:22 127.0.0.1:50000",
    "LISTEN 0 128",
    "LISTEN 0 128 nocolon 0.0.0.0:*",
    "LISTEN 0 128 :8080 0.0.0.0:*",
    "LISTEN 0 128 127.0.0.1:notaport 0.0.0.0:*",
    "LISTEN 0 128 127.0.0.1:99999 0.0.0.0:*",
    "garbage line here",
    "LISTEN 0 4096 127.0.0.1:18081 0.0.0.0:*",
  ].join("\n");

  const parsed = parseSsOutput(malformed);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].port, 18081);
});

test("docker parsers handle build-server containers, no-ports container, malformed lines, and empty output", () => {
  assert.deepEqual(parseDockerPsOutput(""), []);
  assert.deepEqual(parseDockerStatsOutput(null), []);

  const psText = [
    '{"ID":"000000000001","Image":"nginx:alpine","Names":"demo-prod","Ports":"127.0.0.1:18082->80/tcp","State":"running","Status":"Up 4 minutes"}',
    '{"ID":"000000000002","Image":"nginx:alpine","Names":"demo-test","Ports":"127.0.0.1:18081->80/tcp","State":"running","Status":"Up 4 minutes"}',
    '{"ID":"aa1122334455","Image":"busybox:latest","Names":"worker-noports","Ports":"","State":"running","Status":"Up 1 minute"}',
    "{not valid json",
    '{"unrelated":"object"}',
  ].join("\n");

  const statsText = [
    '{"ID":"000000000001","Name":"demo-prod","CPUPerc":"0.12%","MemUsage":"4.652MiB / 64MiB","MemPerc":"7.27%"}',
    '{"ID":"000000000002","Name":"demo-test","CPUPerc":"0.05%","MemUsage":"4.711MiB / 64MiB","MemPerc":"7.36%"}',
    "not json",
  ].join("\n");

  const ps = parseDockerPsOutput(psText);
  assert.equal(ps.length, 3);
  const stats = parseDockerStatsOutput(statsText);
  assert.equal(stats.length, 2);

  const merged = mergeDockerContainers(ps, stats);
  assert.equal(merged.length, 3);

  const prod = merged.find((c) => c.name === "demo-prod");
  assert.equal(prod.image, "nginx:alpine");
  assert.equal(prod.cpuPerc, "0.12%");
  assert.equal(prod.memUsed, "4.652MiB");
  assert.equal(prod.memLimit, "64MiB");
  assert.equal(prod.publishedPorts.length, 1);
  assert.equal(prod.publishedPorts[0].hostAddr, "127.0.0.1");
  assert.equal(prod.publishedPorts[0].hostPort, "18082");

  const noPorts = merged.find((c) => c.name === "worker-noports");
  assert.equal(noPorts.portsRaw, "");
  assert.deepEqual(noPorts.publishedPorts, []);
  assert.equal(noPorts.cpuPerc, "—");
  assert.equal(noPorts.memUsage, "—");
});

test("parseRemoteMachineEntry reports a Docker read error when docker fails without failing ports", () => {
  const res = parseRemoteMachineEntry({
    ss: "LISTEN 0 4096 127.0.0.1:2223 0.0.0.0:*",
    ss_rc: 0,
    docker_ps: "permission denied while trying to connect to the Docker daemon socket",
    docker_ps_rc: 1,
    docker_stats: "",
    docker_stats_rc: 1,
    error: null,
  });

  assert.equal(res.ok, true);
  assert.equal(res.ports.length, 1);
  assert.equal(res.ports[0].port, 2223);
  assert.equal(res.dockerError, "Could not read Docker");
  assert.deepEqual(res.containers, []);
});

test("buildMachineModels keeps remote build-server distinct from local workstation sharing same host and attaches containers + port classification", () => {
  const machinesList = [
    { name: null, host: "workstation", layout: "ready" },
    { name: "build-server", host: "workstation", layout: "ready" },
  ];

  const localEntry = {
    machine: null,
    at: 1700000000000,
    result: {
      system: { hostname: "WORKSTATION", os: "Microsoft Windows 11 Pro" },
      tailscale: {
        tailnet: "example-tailnet.ts.net",
        self: { name: "workstation", ip: "100.64.0.10", os: "windows" },
        peers: [],
        serve: [{ port: 8443, target: "http://127.0.0.1:8080", funnel: true }],
      },
      ports: [
        { port: 6463, addr: "127.0.0.1", pid: 100, process: "Discord", access: "local" },
        { port: 2222, addr: "0.0.0.0", pid: 200, process: "sshd", access: "tailnet" },
        { port: 443, addr: "100.64.0.10", pid: 300, process: "tailscaled", access: "tailnet" },
        { port: 8080, addr: "127.0.0.1", pid: 400, process: "herdr", access: "public" },
      ],
      remote: {
        "build-server": {
          ss: [
            "LISTEN 0 1000 10.255.255.254:53 0.0.0.0:*",
            "LISTEN 0 4096 127.0.0.1:2223 0.0.0.0:*",
            "LISTEN 0 4096 127.0.0.1:18081 0.0.0.0:*",
            "LISTEN 0 4096 127.0.0.1:18082 0.0.0.0:*",
            "LISTEN 0 4096 127.0.0.1:37189 0.0.0.0:*",
          ].join("\n"),
          ss_rc: 0,
          docker_ps: [
            '{"ID":"000000000001","Image":"nginx:alpine","Names":"demo-prod","Ports":"127.0.0.1:18082->80/tcp","State":"running","Status":"Up 4 minutes"}',
            '{"ID":"000000000002","Image":"nginx:alpine","Names":"demo-test","Ports":"127.0.0.1:18081->80/tcp","State":"running","Status":"Up 4 minutes"}',
          ].join("\n"),
          docker_ps_rc: 0,
          docker_stats: [
            '{"ID":"000000000001","Name":"demo-prod","CPUPerc":"0.00%","MemUsage":"4.5MiB / 64MiB","MemPerc":"7.03%"}',
            '{"ID":"000000000002","Name":"demo-test","CPUPerc":"0.00%","MemUsage":"4.5MiB / 64MiB","MemPerc":"7.06%"}',
          ].join("\n"),
          docker_stats_rc: 0,
          error: null,
        },
      },
    },
  };

  const buildServerEntry = {
    machine: "build-server",
    at: 1700000001000,
    result: {
      system: { hostname: "workstation", os: "Ubuntu 24.04.5 LTS" },
      tailscale: null,
      ports: [
        { port: 2223, addr: "127.0.0.1", pid: 0, process: "", access: "local" },
        { port: 18081, addr: "127.0.0.1", pid: 0, process: "", access: "local" },
        { port: 18082, addr: "127.0.0.1", pid: 0, process: "", access: "local" },
        { port: 37189, addr: "127.0.0.1", pid: 0, process: "", access: "local" },
      ],
      remote: null,
    },
  };

  const { models } = buildMachineModels({
    machinesList,
    agentsList: [],
    spacesList: [],
    collectEntries: [localEntry, buildServerEntry],
    localEntry,
    limitsMap: {},
  });

  assert.equal(models.length, 2);

  const localModel = models.find((m) => m.key === "local");
  const buildServer = models.find((m) => m.key === "build-server");

  assert.ok(localModel);
  assert.ok(buildServer);

  assert.equal(localModel.isLocal, true);
  assert.equal(localModel.remote, null);

  assert.equal(buildServer.isLocal, false);
  assert.equal(buildServer.isHerdrMachine, true);
  assert.equal(buildServer.herdrName, "build-server");
  assert.equal(buildServer.system?.os, "Ubuntu 24.04.5 LTS");

  assert.ok(buildServer.remote);
  assert.equal(buildServer.remote.ok, true);
  assert.deepEqual(
    buildServer.remote.containers.map((c) => c.name),
    ["demo-prod", "demo-test"],
  );
  assert.equal(Boolean(buildServer.remote || (!buildServer.isLocal && buildServer.isHerdrMachine)), true);

  // Machine card ports use the same address + bindLabel classification as the Ports screen.
  const p2223 = buildServer.ports.find((p) => p.port === 2223);
  assert.equal(p2223.addr, "127.0.0.1");
  assert.equal(p2223.bindScope, "local");
  assert.equal(p2223.bindLabel, "this machine only");

  const local2222 = localModel.ports.find((p) => p.port === 2222);
  assert.equal(local2222.addr, "0.0.0.0");
  assert.equal(local2222.bindScope, "all");
  assert.equal(local2222.bindLabel, "all interfaces");

  const local443 = localModel.ports.find((p) => p.port === 443);
  assert.equal(local443.addr, "100.64.0.10");
  assert.equal(local443.bindLabel, null);

  const local8080 = localModel.ports.find((p) => p.port === 8080);
  assert.equal(local8080.addr, "127.0.0.1");
  assert.equal(local8080.access, "public");
  assert.equal(local8080.bindLabel, null);
  assert.equal(local8080.funnelPort, 8443);
});

test("summarizePorts matches Ports classification for all-interfaces, loopback, tailnet, and public ports", () => {
  const rows = summarizePorts(
    [
      { port: 2223, addr: "127.0.0.1", pid: 1, process: "sshd", access: "local" },
      { port: 80, addr: "0.0.0.0", pid: 2, process: "nginx", access: "tailnet" },
      { port: 8443, addr: "100.64.0.10", pid: 3, process: "tailscaled", access: "tailnet" },
      { port: 8080, addr: "127.0.0.1", pid: 4, process: "web", access: "public" },
    ],
    [{ port: 8443, target: "http://127.0.0.1:8080", funnel: true }],
  );

  assert.equal(rows.length, 4);
  assert.equal(rows.find((r) => r.port === 2223).bindLabel, "this machine only");
  assert.equal(rows.find((r) => r.port === 80).bindLabel, "all interfaces");
  assert.equal(rows.find((r) => r.port === 8443).bindLabel, null);
  assert.equal(rows.find((r) => r.port === 8080).bindLabel, null);
  assert.equal(rows.find((r) => r.port === 8080).funnelPort, 8443);
});

test("parseDockerNetIo handles SI/IEC units, zero, whitespace, missing, and malformed inputs", () => {
  assert.deepEqual(parseDockerNetIo("1.2kB / 648B"), {
    ok: true,
    rx: "1.2kB",
    tx: "648B",
    rxBytes: 1200,
    txBytes: 648,
    summary: "↓ 1.2kB · ↑ 648B",
  });

  assert.deepEqual(parseDockerNetIo("807B / 1.68kB"), {
    ok: true,
    rx: "807B",
    tx: "1.68kB",
    rxBytes: 807,
    txBytes: 1680,
    summary: "↓ 807B · ↑ 1.68kB",
  });

  assert.deepEqual(parseDockerNetIo("0B / 0B"), {
    ok: true,
    rx: "0B",
    tx: "0B",
    rxBytes: 0,
    txBytes: 0,
    summary: "↓ 0B · ↑ 0B",
  });

  const iec = parseDockerNetIo("12.5MiB / 4kiB");
  assert.equal(iec.ok, true);
  assert.equal(iec.rx, "12.5MiB");
  assert.equal(iec.tx, "4kiB");
  assert.equal(iec.rxBytes, Math.round(12.5 * 1024 * 1024));
  assert.equal(iec.txBytes, 4 * 1024);

  const gb = parseDockerNetIo("2.5GB / 1.5GiB");
  assert.equal(gb.ok, true);
  assert.equal(gb.rx, "2.5GB");
  assert.equal(gb.tx, "1.5GiB");
  assert.equal(gb.rxBytes, 2_500_000_000);
  assert.equal(gb.txBytes, Math.round(1.5 * 1024 ** 3));

  const mb = parseDockerNetIo(" 340 MB / 12.4 kB ");
  assert.equal(mb.ok, true);
  assert.equal(mb.rx, "340MB");
  assert.equal(mb.tx, "12.4kB");

  for (const bad of [
    null,
    undefined,
    "",
    "   ",
    42,
    "—",
    "N/A",
    "-- / --",
    "1.2kB",
    "1.2kB / ",
    " / 648B",
    "1.2kB / 648B / 10B",
    "-5B / 10B",
    "1.2XB / 10B",
    "abc / def",
  ]) {
    const res = parseDockerNetIo(bad);
    assert.deepEqual(res, {
      ok: false,
      rx: "—",
      tx: "—",
      rxBytes: null,
      txBytes: null,
      summary: "—",
    });
  }
});

test("parseDockerStatsOutput and mergeDockerContainers propagate NetIO", () => {
  const ps = parseDockerPsOutput(
    [
      '{"ID":"000000000001","Image":"nginx:alpine","Names":"demo-prod","Ports":"127.0.0.1:18082->80/tcp","State":"running","Status":"Up 35 minutes"}',
      '{"ID":"000000000002","Image":"nginx:alpine","Names":"demo-test","Ports":"127.0.0.1:18081->80/tcp","State":"running","Status":"Up 35 minutes"}',
    ].join("\n"),
  );
  const stats = parseDockerStatsOutput(
    [
      '{"ID":"000000000001","Name":"demo-prod","CPUPerc":"0.00%","MemUsage":"4.535MiB / 64MiB","MemPerc":"7.09%","NetIO":"807B / 1.68kB"}',
      '{"ID":"000000000002","Name":"demo-test","CPUPerc":"0.00%","MemUsage":"4.52MiB / 64MiB","MemPerc":"7.06%","NetIO":"bad-netio"}',
    ].join("\n"),
  );

  const merged = mergeDockerContainers(ps, stats);
  const prod = merged.find((c) => c.name === "demo-prod");
  assert.equal(prod.hasNetIo, true);
  assert.equal(prod.netRx, "807B");
  assert.equal(prod.netTx, "1.68kB");
  assert.equal(prod.netSummary, "↓ 807B · ↑ 1.68kB");

  const testC = merged.find((c) => c.name === "demo-test");
  assert.equal(testC.hasNetIo, false);
  assert.equal(testC.netRx, "—");
  assert.equal(testC.netTx, "—");
  assert.equal(testC.netSummary, "—");
});

test("Docker joins exact IDs, names and shortened IDs in the original priority order", () => {
  const ps = [
    { id: "abc", name: "old-name" }, { id: "abc123", name: "old-name" },
    { id: "abc12345", name: "matching-name" }, { id: "abc123456", name: "old-name" },
  ];
  const stats = [
    { id: "abc123", cpuPerc: "1%" },
    { containerId: "abc123456789", cpuPerc: "2%" },
    { name: "matching-name", cpuPerc: "3%" },
  ];
  assert.deepEqual(Object.fromEntries(mergeDockerContainers(ps, stats).map((row) => [row.id, row.cpuPerc])), {
    abc: "1%", abc123: "1%", abc12345: "3%", abc123456: "1%",
  });
  assert.equal(mergeDockerContainers([ps[3]], [stats[1]])[0].cpuPerc, "2%");
});

test("container names start alphanumeric and Docker logs separates the name from options", () => {
  for (const valid of ["demo-prod", "demo_test.1", "worker.01-alpha", "A1_b.2-c"]) {
    assert.equal(isValidDockerContainerName(valid), true);
    const spec = buildDockerLogsTabSpec(valid);
    assert.deepEqual(spec, {
      ok: true,
      error: null,
      tabName: `log · ${valid}`,
      argv: ["docker", "logs", "-f", "--tail", "200", "--", valid],
    });
  }

  for (const invalid of [
    "",
    "   ",
    null,
    undefined,
    ".",
    "..",
    "-option",
    "_worker",
    ".worker",
    "worker\n",
    "x".repeat(256),
    "demo prod",
    "demo;rm -rf /",
    "demo$(whoami)",
    "demo$HOME",
    "demo'quote",
    'demo"quote',
    "demo`id`",
    "demo/prod",
    "demo\nprod",
    "demo|cat",
    "demo&id",
  ]) {
    assert.equal(isValidDockerContainerName(invalid), false);
    const spec = buildDockerLogsTabSpec(invalid);
    assert.equal(spec.ok, false);
    assert.equal(spec.tabName, null);
    assert.equal(spec.argv, null);
    assert.ok(spec.error);
  }
});

test("buildMachineModels folds a Tailscale peer into the Herdr machine named by SSH alias", () => {
  const winSelf = { name: "workstation", ip: "100.64.0.10", os: "windows" };
  const localEntry = {
    machine: null,
    at: 1700000000000,
    result: {
      system: { hostname: "laptop.local", os: "macOS 27.2.1" },
      tailscale: {
        tailnet: "example-tailnet.ts.net",
        self: { name: "laptop", ip: "100.64.0.11", os: "macOS" },
        peers: [
          { ...winSelf, online: true, ping_ms: 8 },
          { name: "phone", ip: "100.64.0.12", os: "iOS", online: true, ping_ms: 93 },
        ],
        serve: [],
      },
      ports: [],
      remote: {},
    },
  };
  const windowsEntry = {
    machine: "windows",
    at: 1700000001000,
    result: {
      system: { hostname: "WORKSTATION", os: "Microsoft Windows 11 Pro" },
      tailscale: { tailnet: "example-tailnet.ts.net", self: winSelf, peers: [], serve: [] },
      ports: [],
      remote: null,
    },
  };
  // WSL on the same Windows host: same address, but no Tailscale of its own.
  const buildServerEntry = {
    machine: "build-server",
    at: 1700000001000,
    result: { system: { hostname: "workstation", os: "Ubuntu 24.04.5 LTS" }, tailscale: null, ports: [], remote: null },
  };

  const { models } = buildMachineModels({
    machinesList: [
      { name: null, layout: "ready" },
      { name: "windows", layout: "ready" },
      { name: "build-server", layout: "ready" },
    ],
    agentsList: [],
    spacesList: [],
    collectEntries: [localEntry, windowsEntry, buildServerEntry],
    localEntry,
    limitsMap: {},
  });

  assert.deepEqual(models.map((m) => m.key).sort(), ["build-server", "local", "phone", "windows"]);
  const summary = buildShellSummary({
    machinesList: [
      { name: null, layout: "ready" },
      { name: "windows", layout: "ready" },
      { name: "build-server", layout: "ready" },
    ],
    spacesList: [],
    agentsList: [],
    terminalsList: [],
    panesList: [],
    collectEntries: [localEntry, windowsEntry, buildServerEntry],
    localEntry,
  });
  assert.equal(summary.totalMachines, models.length);
  assert.equal(summary.onlineMachines, models.filter((m) => m.online).length);

  const win = models.find((m) => m.key === "windows");
  assert.equal(win.herdrName, "windows");
  assert.equal(win.inTailscale, true);
  assert.equal(win.pingMs, 8);
  assert.equal(models.find((m) => m.key === "build-server").inTailscale, false);
});
