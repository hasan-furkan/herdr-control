// Herdr Control — root view, shell (sidebar + top bar), and screen routing.
//
// Screenshot commands use `herdr-app do herdr-control.<command>`. See CONTRACT.md.
// Legacy tab props "goto", "agentsTab", "view", "machine", and "stream" still support
// redirecting the layout. Close the redirect tab after use.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, Switch } from "gpui-base";
import {
  props,
  shared,
  setShared,
  run,
  exec,
  keys,
  layout,
  nextCommand,
  theme,
  checking,
  window as hostWindow,
} from "herdr";
import * as palette from "./palette.js";
import {
  SCREEN_KEY,
  VIEW_KEY,
  RANGE_KEY,
  AGENTS_TAB_KEY,
  MACHINE_KEY,
  inControlLayout,
  showView,
  jump,
  currentView,
  startView,
} from "./nav.js";
import { startCollector } from "./collector.js";
import { dashboardFocus, dashboardSpaces, readDashboard } from "./source.js";
import { dashboardNow, isDemo, setDemo } from "./demo-mode.js";
import { TOGGLE_DEMO_COMMAND } from "./demo.js";
import {
  STREAM_KEY,
  isStreaming,
  maskBranch,
  maskHost,
  maskIp,
  maskUser,
  maskTailnet,
  maskAvatar,
  maskPath,
  maskContainer,
  maskError,
  maskTitle,
} from "./mask.js";
import { PRICES } from "./prices.js";
import { CATALOG, loadCatalog } from "./catalog.js";
import * as dataModule from "./data.js";
import * as uiModule from "./ui.js";
import { renderOverview } from "./screens/overview.js";
import { renderSpaces } from "./screens/spaces.js";
import { renderMachines } from "./screens/machines.js";
import { renderPorts } from "./screens/ports.js";
import { renderAgents, AGENTS_TABS } from "./screens/agents.js";
import { renderApprovals } from "./screens/approvals.js";
import { renderAside } from "./screens/aside.js";

const { PALETTE, SIZES, RADII, monoFont, textFont, monoTheme } = palette;
const { SCREENS, SCREEN_TITLES, RANGE_OPTIONS, formatClock, buildShellSummary } = dataModule;
const { iconOf, chip } = uiModule;

const SCREEN_STORAGE_KEY = "herdr-control.screen";
const STREAM_STORAGE_KEY = "herdr-control.stream";
const USAGE_COLLAPSED_KEY = "herdr-control.usageCollapsed";
const DEMO_MACHINE_KEY = "herdr-control.demoMachine";
const LEGACY_STATUS_KEY = "herdr-control.demoHiddenStatus";
const NAV_TERMINAL_CONTROLS = {
  topPadding: 10,
  borderWidth: 1,
  gap: 6,
  headingHeight: 20,
  buttonHeight: 24,
  errorHeight: 28,
};

function renderSidebarUsage(rows, narrow, autoCollapsed) {
  const collapsed = shared(USAGE_COLLAPSED_KEY);
  const percentLabel = (label, value) => `${label} ${value === null ? "—" : `${value}%`}`;
  const summary = dataModule.summarizeUsageCard(rows);
  const summaryColor = rows.some((row) => row.limitNotice) ? PALETTE.danger : PALETTE.muted;
  const formatWindow = (win) => {
    const pct = percentLabel(win.label, win.remaining);
    return win.countdown && win.countdown !== "—" ? `${pct} · ${win.countdown}` : pct;
  };
  const details = () => rows.map((row) => {
    const limit = row.id === "opencode" ? row.limitNotice ?? "—"
      : row.hint ?? (row.windows?.length
        ? row.windows.map(formatWindow).join(" · ")
        : `${percentLabel("5h", row.five)} · ${percentLabel("week", row.week)}`);
    return `${row.label} · ${limit} · today ${row.tokens}`;
  }).join("\n");
  const card = v_flex()
    .id("sidebar-usage")
    .w_full()
    .p(narrow ? 6 : 10)
    .gap(6)
    .rounded(RADII.inner)
    .bg(PALETTE.raised)
    .border(1)
    .border_color(PALETTE.line);
  if (autoCollapsed && typeof collapsed !== "boolean") {
    const label = narrow ? dataModule.summarizeUsageCard(rows, { compact: true }) : summary;
    return card.tooltip(details()).child(
      div().w_full().truncate().text_size(SIZES.xs).text_color(summaryColor)
        .child(`Usage · ${label}`),
    );
  }

  const toggleCard = card.child(
    h_flex().id("sidebar-usage-toggle").w_full().justify_between().gap(3)
      .cursor_pointer().text_size(SIZES.xs).font_bold().text_color(PALETTE.text)
      .role("button")
      .accessibility_label(collapsed ? "Expand usage" : "Collapse usage")
      .on_click(() => setShared(USAGE_COLLAPSED_KEY, !collapsed))
      .child("Usage")
      .child(collapsed ? "›" : "⌄"),
  );
  if (narrow) {
    return toggleCard.tooltip(collapsed ? summary : details())
      .when(collapsed, (el) => el.child(div().truncate().text_size(SIZES.xs).text_color(summaryColor)
        .child(dataModule.summarizeUsageCard(rows, { compact: true }))));
  }
  if (collapsed) {
    return toggleCard.tooltip(summary).child(div().truncate().text_size(SIZES.xs).text_color(summaryColor).child(summary));
  }
  const percent = (label, value) =>
    div().flex_none().whitespace_nowrap()
      .text_color(value === null ? PALETTE.muted : value < 15 ? PALETTE.danger : value < 30 ? PALETTE.warn : PALETTE.ok)
      .child(percentLabel(label, value));
  const windowLine = (win) =>
    h_flex().w_full().justify_between().gap(4).font_family(monoFont())
      .child(percent(win.label, win.remaining))
      .when(win.countdown && win.countdown !== "—", (el) =>
        el.child(div().flex_none().whitespace_nowrap().text_color(PALETTE.muted)
          .tooltip(`${win.label} window reset`).child(`· ${win.countdown}`)));
  return toggleCard.children(rows.map((row) => {
    const isOpenCode = row.id === "opencode";
    const windows = row.windows?.length ? row.windows : null;
    return v_flex()
      .id(`sidebar-usage-${row.id}`)
      .w_full()
      .gap(2)
      .pt(5)
      .border_t(1)
      .border_color(PALETTE.line)
      .text_size(SIZES.xs)
      .child(
        h_flex().w_full().justify_between().gap(4)
          .child(
            h_flex().items_baseline().gap(4)
              .child(div().font_semibold().text_color(PALETTE.text).child(row.label))
              .when(Boolean(row.staleAge), (el) =>
                el.child(div().text_size(SIZES.xs).font_family(monoFont()).text_color(PALETTE.muted).child(row.staleAge))),
          )
          .child(div().flex_none().whitespace_nowrap().font_family(monoFont()).text_color(PALETTE.muted)
            .tooltip(row.id === "antigravity" ? "Today's tokens (estimated)" : "Today's tokens")
            .child(row.tokens)),
      )
      .when(isOpenCode || Boolean(row.hint), (el) =>
        el.child(
          div().font_family(monoFont()).text_color(row.limitNotice ? PALETTE.danger : PALETTE.muted)
            .child(row.limitNotice ?? row.hint ?? "—"),
        ))
      .when(!isOpenCode && !row.hint && Boolean(windows), (el) =>
        el.children(windows.map(windowLine)))
      .when(!isOpenCode && !row.hint && !windows, (el) =>
        el.child(
          h_flex().w_full().gap(8).font_family(monoFont())
            .child(percent("5h", row.five))
            .child(percent("week", row.week)),
        ));
  }));
}

export default class HerdrControl extends View {
  init(initProps, cx) {
    const p = { ...(initProps ?? {}), ...(props() ?? {}) };
    if (p.part === "status") {
      this.part = "status";
      return;
    }
    const hasGoto = typeof p?.goto === "string" && p.goto.length > 0;
    const isTerminalView = p?.view === "terminal";

    if ((hasGoto || isTerminalView) && p?.part == null) {
      this.gotoMode = true;
      const targetScreen = SCREENS.includes(p?.goto) ? p.goto : null;
      const targetView = isTerminalView ? "terminal" : "screen";
      this.gotoTarget =
        targetView === "terminal" && !targetScreen ? "terminal" : (targetScreen ?? "overview");

      if (!checking()) {
        if (targetScreen) {
          setShared(SCREEN_KEY, targetScreen);
          try {
            localStorage.setItem(SCREEN_STORAGE_KEY, targetScreen);
          } catch {}
        }
        if (AGENTS_TABS.includes(p?.agentsTab)) {
          setShared(AGENTS_TAB_KEY, p.agentsTab);
        }
        if (typeof p?.machine === "string" || p?.machine === null) {
          setShared(isDemo() ? DEMO_MACHINE_KEY : MACHINE_KEY, p.machine?.toLowerCase() ?? null);
        }
        if (p?.stream === true || p?.stream === false) {
          this.setStreaming(p.stream, null);
        }
        showView(targetView);
      }
      return;
    }

    this.gotoMode = false;
    this.embeddedPanel = p.part === "panel";
    const requested = p?.screen;
    if (SCREENS.includes(requested)) {
      this.screen = requested;
    } else {
      let saved = null;
      try {
        saved = localStorage.getItem(SCREEN_STORAGE_KEY);
      } catch {}
      this.screen = SCREENS.includes(saved) ? saved : "overview";
    }

    this.agentsTab = AGENTS_TABS.includes(p?.agentsTab) ? p.agentsTab : "now";
    this.agentsMachineFilter = "all";
    this.portsAccessFilter = "all";
    this.portsMachineFilter = "all";
    this.portsMachineMenuOpen = false;
    this.portsCollapsed = new Set();
    this.selectedMachine = typeof p?.machine === "string" ? p.machine.toLowerCase() : null;
    this.selectedDemoMachine = this.selectedMachine;
    this.selectedSpace = null;
    this.spaceCommits = new Map();
    this.spaceCommitsInFlight = new Set();
    this.pingHistory = new Map();
    this.pingLastAt = new Map();
    this.healthChecks = {};
    this.catalog = CATALOG;
    this.width = null;
    this.height = null;
    this.navHeights = { header: null, footer: null };
    this.blockedSince = new Map();
    this.confirmingApproval = null;
    this.sendingApproval = null;
    this.approvalError = null;
    this.confirmingTabClose = null;
    this.spacesError = null;
    this.navTerminalError = null;
    this.dockerLogError = null;

    // The panel and full tab both own their dashboard navigation and use the same collector path.
    this.part =
      p?.part === "nav" || p?.part === "content" || p?.part === "aside" ? p.part : null;
    if (this.part === "nav") {
      setShared(SCREEN_KEY, "overview");
      setShared(VIEW_KEY, startView());
      setShared(MACHINE_KEY, null);
      setShared(DEMO_MACHINE_KEY, null);
      if (!AGENTS_TABS.includes(shared(AGENTS_TAB_KEY))) {
        setShared(AGENTS_TAB_KEY, "now");
      }
    } else if (this.part && AGENTS_TABS.includes(p?.agentsTab)) {
      setShared(AGENTS_TAB_KEY, p.agentsTab);
    }

    if (p?.stream === true) {
      this.setStreaming(true, null);
    } else if (p?.stream === false) {
      this.setStreaming(false, null);
    } else if (typeof shared(STREAM_KEY) !== "boolean") {
      let savedStream = false;
      try {
        savedStream = localStorage.getItem(STREAM_STORAGE_KEY) === "1";
      } catch {}
      setShared(STREAM_KEY, savedStream);
    }

    const savedRange = shared(RANGE_KEY);
    if (!RANGE_OPTIONS.includes(savedRange)) {
      setShared(RANGE_KEY, RANGE_OPTIONS[0]);
    }

    if (!checking()) {
      cx.timer.every(30000, (tickCx) => tickCx.notify());
      this.collector = startCollector(this.part, cx);
      if (this.part === "nav" || this.part === null) {
        if (isDemo()) {
          this.prepareDemoLayout();
          setDemo(true);
        } else if (this.part === "nav") {
          this.restoreLegacyStatus();
        }
        cx.spawn(async (taskCx) => {
          for (;;) {
            const command = await nextCommand();
            if (this.part === "nav" || !inControlLayout()) this.handleCommand(command, taskCx);
          }
        });
      }
      if ((this.part === "content" || this.part === null) && this.currentScreen() === "spaces") {
        this.ensureSelectedSpaceCommits(dashboardSpaces(), cx);
      }
    }
  }

  handleCommand(command, cx) {
    if (command === TOGGLE_DEMO_COMMAND) {
      const enableDemo = !isDemo();
      if (enableDemo) this.prepareDemoLayout();
      setDemo(enableDemo);
      if (!enableDemo) {
        this.restoreLegacyStatus();
        this.collector?.trigger(cx);
      }
      cx.notify();
    } else if (command === "stream-on" || command === "stream-off") {
      this.setStreaming(command === "stream-on", cx);
    } else if (command === "usage-expand" || command === "usage-collapse") {
      setShared(USAGE_COLLAPSED_KEY, command === "usage-collapse");
      cx.notify();
    } else if (typeof command === "string" && command.startsWith("goto-")) {
      const target = command.slice(5);
      const tab = target.startsWith("agents-") ? target.slice(7) : null;
      if (AGENTS_TABS.includes(tab)) {
        this.setAgentsTab(tab);
        this.selectScreen("agents", cx);
      } else if (target !== "agents") {
        this.selectScreen(target, cx);
      }
    }
  }

  prepareDemoLayout() {
    if (!inControlLayout()) return;
    showView("screen");
    // Existing layouts may still use Herdr's live status bar.
    const status = layout()?.children?.find((node) => node.id === "work")
      ?.children?.find((node) => node.id === "status");
    if (status?.content?.mod === "workspace-status" && !status.hidden) {
      run("layout.hide", { id: "status" });
      setShared(LEGACY_STATUS_KEY + "." + shared("layout"), true);
    }
  }

  restoreLegacyStatus() {
    const key = LEGACY_STATUS_KEY + "." + shared("layout");
    if (shared(key) !== true || !inControlLayout()) return;
    run("layout.show", { id: "status" });
    setShared(key, null);
  }

  currentAgentsTab() {
    if (this.part) {
      const t = shared(AGENTS_TAB_KEY);
      if (AGENTS_TABS.includes(t)) return t;
    }
    return this.agentsTab;
  }

  setAgentsTab(tab) {
    this.agentsTab = tab;
    if (this.part) setShared(AGENTS_TAB_KEY, tab);
  }

  currentScreen() {
    if (this.part) {
      const s = shared(SCREEN_KEY);
      if (SCREENS.includes(s)) return s;
    }
    return this.screen;
  }

  isActive(id) {
    if (this.part !== "nav") return this.currentScreen() === id;
    return currentView() === "screen" && this.currentScreen() === id;
  }

  selectScreen(screen, cx) {
    if (!SCREENS.includes(screen)) return;
    if (this.part) {
      setShared(SCREEN_KEY, screen);
      showView("screen");
    }
    this.screen = screen;
    try {
      localStorage.setItem(SCREEN_STORAGE_KEY, screen);
    } catch {}
    if (screen === "spaces") {
      this.ensureSelectedSpaceCommits(dashboardSpaces(), cx);
    }
    cx.notify();
  }

  setStreaming(next, cx) {
    const val = Boolean(next);
    try {
      localStorage.setItem(STREAM_STORAGE_KEY, val ? "1" : "0");
    } catch {}
    setShared(STREAM_KEY, val);
    cx?.notify?.();
  }

  shortErrorReason(err) {
    const raw = String(err?.message ?? err ?? "command failed").trim();
    const first = raw.split(/\r?\n/)[0]?.trim() || "command failed";
    return first.length > 90 ? `${first.slice(0, 87)}...` : first;
  }

  setActionError(target, message, cx) {
    if (target === "nav") {
      this.navTerminalError = message;
    } else if (target === "approvals") {
      this.approvalError = message;
    } else {
      this.spacesError = message ? { scope: target, message } : null;
    }
    cx?.notify?.();
  }

  returnToTerminal() {
    if (isDemo() || this.embeddedPanel) return;
    if (this.part === "nav" || inControlLayout()) {
      showView("terminal");
      return;
    }
    const termAddr = dashboardFocus()?.terminal;
    if (termAddr) {
      run("terminal.show", { terminal: termAddr });
    }
  }

  createSpaceFromUi(target, cx) {
    if (isDemo()) return;
    this.setActionError(target, null, null);
    try {
      run("space.new", { machine: "" });
      this.returnToTerminal();
    } catch (err) {
      this.setActionError(target, `Could not open space: ${this.shortErrorReason(err)}`, cx);
    }
  }

  createTerminalFromUi(spaceId, target, cx) {
    if (isDemo()) return;
    this.setActionError(target, null, null);
    try {
      if (!spaceId) {
        run("space.new", { machine: "" });
      } else {
        run("tab.new", { space: spaceId });
      }
      this.returnToTerminal();
    } catch (err) {
      this.setActionError(target, `Could not open terminal: ${this.shortErrorReason(err)}`, cx);
    }
  }

  selectSpaceAndTab(spaceId, tabId, cx) {
    if (isDemo()) return;
    this.navTerminalError = null;
    try {
      run("space.select", { id: spaceId });
      run("tab.select", { id: tabId });
      this.returnToTerminal();
    } catch (err) {
      this.navTerminalError = `Could not select terminal: ${this.shortErrorReason(err)}`;
      cx?.notify?.();
    }
  }

  closeTabFromSpaces(tabId, cx) {
    if (isDemo()) return;
    this.spacesError = null;
    try {
      run("tab.close", { id: tabId, confirmed: true });
      this.confirmingTabClose = null;
      cx?.notify?.();
    } catch (err) {
      this.confirmingTabClose = null;
      this.spacesError = {
        scope: "terminals",
        message: `Could not close terminal: ${this.shortErrorReason(err)}`,
      };
      cx?.notify?.();
    }
  }

  openContainerLogs(machine, container, spacesList, containerKey, cx) {
    if (isDemo() || isStreaming()) return;
    const spec = dataModule.buildDockerLogsTabSpec(container?.name);
    if (!spec.ok) {
      this.dockerLogError = {
        machineKey: machine?.key ?? null,
        containerKey,
        message: spec.error,
      };
      cx?.notify?.();
      return;
    }
    if (!machine?.isHerdrMachine || !machine?.herdrName) {
      this.dockerLogError = {
        machineKey: machine?.key ?? null,
        containerKey,
        message: "Could not open a tab for this machine",
      };
      cx?.notify?.();
      return;
    }
    try {
      const list = spacesList ?? dashboardSpaces() ?? [];
      const targetSpace =
        list.find((s) => s && s.machine === machine.herdrName && s.active) ??
        list.find((s) => s && s.machine === machine.herdrName) ??
        null;
      if (targetSpace) {
        const args = {
          space: targetSpace.id,
          name: spec.tabName,
          argv: spec.argv,
        };
        if (targetSpace.folder) args.folder = targetSpace.folder;
        jump("tab.new", args);
      } else {
        jump("space.new", {
          machine: machine.herdrName,
          tab: spec.tabName,
          argv: spec.argv,
        });
      }
      this.dockerLogError = null;
      cx?.notify?.();
    } catch (err) {
      this.dockerLogError = {
        machineKey: machine?.key ?? null,
        containerKey,
        message: `Could not open logs: ${this.shortErrorReason(err)}`,
      };
      cx?.notify?.();
    }
  }

  trackBlockedSince(agentsList) {
    const now = Date.now();
    const activeBlocked = new Set();
    for (const a of agentsList ?? []) {
      if (a && a.status === "blocked") {
        activeBlocked.add(a.address);
        if (!this.blockedSince.has(a.address)) {
          this.blockedSince.set(a.address, now);
        }
      }
    }
    for (const key of this.blockedSince.keys()) {
      if (!activeBlocked.has(key)) {
        this.blockedSince.delete(key);
      }
    }
    if (this.confirmingApproval && !activeBlocked.has(this.confirmingApproval.address)) {
      this.confirmingApproval = null;
    }
  }

  recordPingSamples(collectEntries) {
    if (!this.pingHistory) this.pingHistory = new Map();
    if (!this.pingLastAt) this.pingLastAt = new Map();

    const entries = collectEntries ?? [];
    const localEntry = entries.find((e) => e && e.machine === null);
    const localRes = localEntry?.result ?? null;
    const selfNames = new Set(
      [localRes?.tailscale?.self?.name, localRes?.system?.hostname]
        .filter(Boolean)
        .map((n) => String(n).toLowerCase()),
    );

    const pushSample = (key, ts, ms) => {
      if (!key || typeof ms !== "number" || !Number.isFinite(ms)) return;
      const arr = this.pingHistory.get(key) ?? [];
      arr.push({ ts, ms });
      if (arr.length > 60) arr.splice(0, arr.length - 60);
      this.pingHistory.set(key, arr);
    };

    for (const entry of entries) {
      if (!entry || typeof entry.at !== "number" || !entry.result) continue;
      const sourceKey = entry.machine === null ? "local" : String(entry.machine).toLowerCase();
      if (this.pingLastAt.get(sourceKey) === entry.at) continue;
      this.pingLastAt.set(sourceKey, entry.at);

      const peers = entry.result?.tailscale?.peers ?? [];
      if (entry.machine === null) {
        for (const peer of peers) {
          if (peer?.name && peer.online && typeof peer.ping_ms === "number") {
            pushSample(String(peer.name).toLowerCase(), entry.at, peer.ping_ms);
          }
        }
      } else {
        let bestLocalPing = null;
        for (const peer of peers) {
          if (
            peer?.name &&
            selfNames.has(String(peer.name).toLowerCase()) &&
            typeof peer.ping_ms === "number"
          ) {
            bestLocalPing =
              bestLocalPing === null ? peer.ping_ms : Math.min(bestLocalPing, peer.ping_ms);
          }
        }
        if (bestLocalPing !== null) {
          pushSample("local", entry.at, bestLocalPing);
        }
      }
    }
  }

  resolveSelectedSpace(spacesList) {
    const list = spacesList ?? [];
    return (
      list.find((s) => s && s.id === this.selectedSpace) ??
      list.find((s) => s && s.active) ??
      list[0] ??
      null
    );
  }

  ensureSelectedSpaceCommits(spacesList, cx, opts = {}) {
    const sel = this.resolveSelectedSpace(spacesList);
    if (sel) this.ensureSpaceCommits(sel, cx, opts);
  }

  ensureSpaceCommits(space, cx, { force = false } = {}) {
    if (isDemo() || checking() || !space || !space.folder || !cx) return;
    if (!this.spaceCommits) this.spaceCommits = new Map();
    if (!this.spaceCommitsInFlight) this.spaceCommitsInFlight = new Set();

    const key = `${space.id}|${space.machine ?? "local"}|${space.folder}`;
    if (this.spaceCommitsInFlight.has(key)) return;

    const prev = this.spaceCommits.get(key);
    if (!force && prev && !prev.loading && typeof prev.at === "number" && Date.now() - prev.at < 30000) {
      return;
    }

    this.spaceCommitsInFlight.add(key);
    this.spaceCommits.set(key, {
      commits: prev?.commits ?? [],
      errorKind: prev?.errorKind ?? null,
      error: prev?.error ?? null,
      loading: true,
      at: prev?.at ?? 0,
    });

    cx.spawn(async (asyncCx) => {
      if (isDemo()) {
        this.spaceCommits.delete(key);
        this.spaceCommitsInFlight.delete(key);
        return;
      }
      try {
        const opts = space.machine ? { on: space.machine, timeout: 10000 } : { timeout: 10000 };
        const res = await exec(
          "git",
          ["-C", space.folder, "log", "-4", "--format=%h%x09%s%x09%cr"],
          opts,
        );
        if (res && res.code === 0) {
          const commits = String(res.stdout || "")
            .split(/\r?\n/)
            .map((line) => line.trimEnd())
            .filter(Boolean)
            .map((line) => {
              const [hash = "", subject = "", relTime = ""] = line.split("\t");
              return { hash, subject, relTime };
            })
            .filter((c) => c.hash);
          this.spaceCommits.set(key, {
            commits,
            errorKind: null,
            error: null,
            loading: false,
            at: Date.now(),
          });
        } else {
          const rawErr = String(res?.stderr || res?.stdout || "").trim();
          const firstLine = (rawErr.split(/\r?\n/)[0] || "").trim();
          const notGit = firstLine.toLowerCase().includes("not a git repository");
          this.spaceCommits.set(key, {
            commits: [],
            errorKind: notGit ? "not-git" : "failed",
            error: firstLine || `exit code ${res?.code ?? "?"}`,
            loading: false,
            at: Date.now(),
          });
        }
      } catch (err) {
        const msg = String(err?.message ?? err ?? "").split(/\r?\n/)[0].trim();
        const notGit = msg.toLowerCase().includes("not a git repository");
        this.spaceCommits.set(key, {
          commits: [],
          errorKind: notGit ? "not-git" : "failed",
          error: msg || "could not run git",
          loading: false,
          at: Date.now(),
        });
      } finally {
        this.spaceCommitsInFlight.delete(key);
        asyncCx.notify();
      }
    });
  }

  ensureCatalog(cx) {
    if (this.catalogRequested || isDemo() || checking()) return;
    this.catalogRequested = true;
    cx.spawn(async (taskCx) => {
      if (isDemo()) {
        this.catalogRequested = false;
        return;
      }
      this.catalog = await loadCatalog();
      taskCx.notify();
    });
  }

  runAgentHealthChecks(targets, cx) {
    if (isDemo()) return;
    const valid = (targets ?? []).filter((t) => t && t.id && t.cmd);
    if (valid.length === 0 || checking()) return;

    const next = { ...this.healthChecks };
    for (const t of valid) {
      next[t.id] = { running: true, ok: null, version: null, error: null, at: null };
    }
    this.healthChecks = next;
    cx.notify();

    cx.spawn(async (asyncCx) => {
      await Promise.allSettled(
        valid.map(async (t) => {
          if (isDemo()) {
            delete this.healthChecks[t.id];
            return;
          }
          try {
            const res = await exec(t.cmd, ["--version"], { timeout: 10000 });
            const raw = String(res?.stdout || res?.stderr || "").trim();
            const firstLine = (raw.split(/\r?\n/)[0] || "").trim().slice(0, 80);
            if (res && res.code === 0) {
              this.healthChecks = {
                ...this.healthChecks,
                [t.id]: {
                  running: false,
                  ok: true,
                  version: firstLine || "ok",
                  error: null,
                  at: Date.now(),
                },
              };
            } else {
              this.healthChecks = {
                ...this.healthChecks,
                [t.id]: {
                  running: false,
                  ok: false,
                  version: null,
                  error: firstLine || `exit code ${res?.code ?? "?"}`,
                  at: Date.now(),
                },
              };
            }
          } catch (err) {
            const msg = String(err?.message ?? err ?? "could not run").split(/\r?\n/)[0].trim().slice(0, 80);
            this.healthChecks = {
              ...this.healthChecks,
              [t.id]: {
                running: false,
                ok: false,
                version: null,
                error: msg || "could not run",
                at: Date.now(),
              },
            };
          }
        }),
      );
      asyncCx.notify();
    });
  }

  renderNavBadge(item, active) {
    if (item.badge === null || item.badge === undefined) return null;
    const isDanger = item.tone === "danger" && !active;
    const isWarn = item.tone === "warn" && !active;
    const bg = active
      ? PALETTE.onAccentSoft
      : isDanger
        ? PALETTE.dangerSoft
        : isWarn
          ? PALETTE.warnSoft
          : PALETTE.raised;
    const border = active
      ? PALETTE.onAccentBorder
      : isDanger
        ? PALETTE.dangerBorder
        : isWarn
          ? PALETTE.warnBorder
          : PALETTE.line;
    const color = active
      ? PALETTE.onAccent
      : isDanger
        ? PALETTE.danger
        : isWarn
          ? PALETTE.warn
          : PALETTE.mono;

    return div()
      .flex_none()
      .px(7)
      .py(2)
      .rounded(RADII.pill)
      .bg(bg)
      .border(1)
      .border_color(border)
      .text_size(SIZES.xs)
      .font_family(monoFont())
      .font_semibold()
      .text_color(color)
      .whitespace_nowrap()
      .child(String(item.badge));
  }

  renderNavTerminals(spacesList, panesList, listHeight, error) {
    const spacesAll = spacesList ?? [];
    const panesAll = panesList ?? [];
    const activeSpace = spacesAll.find((s) => s && s.active) ?? spacesAll[0] ?? null;
    const { headerHeight, tabHeight, tabGap, groupGap, moreHeight } =
      dataModule.SIDEBAR_TERMINAL_METRICS;
    const { groups, totalTabs, hiddenTabs } = dataModule.sidebarTerminalPreview(
      spacesAll, listHeight,
    );
    const { topPadding, borderWidth, gap, headingHeight, buttonHeight, errorHeight } = NAV_TERMINAL_CONTROLS;

    const smallBtn = (id, label, onClick) =>
      h_flex()
        .id(id)
        .flex_1()
        .h(buttonHeight)
        .px(6)
        .rounded(RADII.chip)
        .bg(PALETTE.raised)
        .border(1)
        .border_color(PALETTE.lineStrong)
        .items_center()
        .justify_center()
        .cursor_pointer()
        .text_size(SIZES.xs)
        .font_semibold()
        .text_color(PALETTE.text)
        .hover((s) => s.bg(PALETTE.raisedHover).border_color(PALETTE.accent))
        .on_click(onClick)
        .child(label);

    const listBody = v_flex()
      .w_full()
      .flex_none()
      .gap(groupGap)
      .when(totalTabs === 0, (el) => el.child(
        h_flex().h(tabHeight).items_center().px(6).text_size(SIZES.xs)
          .text_color(PALETTE.muted).child(spacesAll.length ? "No open terminals" : "No open spaces"),
      ))
      .children(
        groups.map(({ space: sp, tabs }) => {
          const spaceName = maskPath(sp.name || "—");
          return v_flex()
            .id(`nav-space-${sp.id}`)
            .w_full()
            .flex_none()
            .gap(tabGap)
            .child(
              h_flex()
                .w_full()
                .h(headerHeight)
                .flex_none()
                .items_center()
                .justify_between()
                .gap(4)
                .px(4)
                .child(
                  div()
                    .flex_1()
                    .min_w(0)
                    .truncate()
                    .text_size(SIZES.xs)
                    .font_bold()
                    .text_color(sp.active ? PALETTE.text : PALETTE.muted)
                    .child(spaceName),
                )
                .when(Boolean(sp.machine), (el) =>
                  el.child(
                    div()
                      .flex_none()
                      .max_w("55%")
                      .truncate()
                      .font_family(monoFont())
                      .text_size(SIZES.xs)
                      .text_color(PALETTE.muted)
                      .child(maskHost(sp.machine)),
                  ),
                ),
            )
            .children(
              tabs.map((tab) => {
                const lead =
                  panesAll.find((p) => p.tab === tab.id && p.program?.agent) ??
                  panesAll.find((p) => p.tab === tab.id);
                const rawLabel = tab.named
                  ? tab.name
                  : lead?.program?.name || tab.name || "Terminal";
                const tabLabel = maskTitle(rawLabel);
                const isCurrent = Boolean(sp.active && tab.active);

                return h_flex()
                  .id(`nav-tab-${tab.id}`)
                  .w_full()
                  .h(tabHeight)
                  .flex_none()
                  .px(8)
                  .gap(7)
                  .rounded(RADII.chip)
                  .items_center()
                  .cursor_pointer()
                  .bg(isCurrent ? PALETTE.raised : PALETTE.transparent)
                  .border(1)
                  .border_color(isCurrent ? PALETTE.lineStrong : PALETTE.transparent)
                  .hover((s) => s.bg(PALETTE.raisedHover).border_color(PALETTE.line))
                  .on_click((_e, cx) => this.selectSpaceAndTab(sp.id, tab.id, cx))
                  .child(uiModule.statusDot(tab.status ?? "idle", 7))
                  .child(
                    div()
                      .flex_1()
                      .min_w(0)
                      .truncate()
                      .text_size(SIZES.xs)
                      .font_semibold()
                      .text_color(isCurrent ? PALETTE.text : PALETTE.muted)
                      .child(tabLabel),
                  );
              }),
            );
        }),
      )
      .when(hiddenTabs > 0, (el) => el.child(
        h_flex().id("nav-terminals-more").w_full().h(moreHeight).flex_none().px(8)
          .rounded(RADII.chip).items_center().cursor_pointer().role("button")
          .text_size(SIZES.xs).font_semibold().text_color(PALETTE.muted)
          .hover((s) => s.bg(PALETTE.raisedHover).text_color(PALETTE.text))
          .tooltip("Show terminals in Spaces")
          .on_click((_e, cx) => this.selectScreen("spaces", cx))
          .child(`+ ${hiddenTabs} more`),
      ));

    return v_flex()
      .id("nav-terminals-section")
      .w_full()
      .flex_none()
      .pt(topPadding)
      .border_t(borderWidth)
      .border_color(PALETTE.line)
      .gap(gap)
      .child(
        v_flex()
          .w_full()
          .flex_none()
          .gap(gap)
          .child(
            h_flex()
              .w_full()
              .h(headingHeight)
              .px(4)
              .items_center()
              .justify_between()
              .child(
                div()
                  .text_size(SIZES.xs)
                  .font_bold()
                  .text_color(PALETTE.muted)
                  .child("Terminals"),
              )
              .child(
                div()
                  .font_family(monoFont())
                  .text_size(SIZES.xs)
                  .text_color(PALETTE.muted)
                  .child(String(totalTabs)),
              ),
          )
          .child(
            h_flex()
              .w_full()
              .gap(5)
              .child(smallBtn("nav-new-space", "+ New space", (_e, cx) => this.createSpaceFromUi("nav", cx)))
              .child(
                smallBtn("nav-new-terminal", "+ Terminal", (_e, cx) =>
                  this.createTerminalFromUi(activeSpace?.id ?? null, "nav", cx),
                ),
              ),
          ),
      )
      .when(Boolean(error), (el) =>
        el.child(
          div()
            .flex_none()
            .w_full()
            .h(errorHeight)
            .px(7)
            .py(5)
            .rounded(RADII.chip)
            .bg(PALETTE.dangerSoft)
            .border(1)
            .border_color(PALETTE.dangerBorder)
            .text_size(SIZES.xs)
            .line_height(16)
            .text_color(PALETTE.danger)
            .truncate()
            .tooltip(error)
            .child(error),
        ),
      )
      .child(
        v_flex()
          .id("nav-terminals-preview")
          .w_full()
          .h(listHeight)
          .flex_none()
          .overflow_hidden()
          .child(listBody),
      );
  }

  renderNav(summary, narrow, live = {}) {
    const streaming = isStreaming();
    const showReturn = !this.embeddedPanel
      && (this.part === "nav" || inControlLayout() || Boolean(live.focusedInfo?.terminal));
    const height = this.height ?? viewportHeight();
    const { usageCollapsed, tailnetCompact } = dataModule.sidebarLayout(height);
    const usageRows = dataModule.buildUsageRows(live.collectEntries ?? [], dashboardNow());
    const userHostText = summary.hostname ? maskUser(summary.userLine) : "—";

    const items = [
      { id: "overview", label: "Overview", shortLabel: "Overview", icon: "overview", badge: null, tone: "normal" },
      { id: "spaces", label: "Spaces", shortLabel: "Space", icon: "spaces", badge: summary.spacesCount, tone: "normal" },
      {
        id: "machines",
        label: "Machines",
        shortLabel: "Machine",
        icon: "machines",
        badge: `${summary.onlineMachines}/${summary.totalMachines}`,
        tone: "normal",
      },
      {
        id: "ports",
        label: "Ports",
        shortLabel: "Port",
        icon: "ports",
        badge: summary.publicPorts !== null ? `${summary.publicPorts} public` : null,
        tone: summary.publicPorts > 0 ? "danger" : "normal",
      },
      { id: "agents", label: "Agents", shortLabel: "Agent", icon: "agents", badge: summary.agentsCount, tone: "normal" },
      {
        id: "approvals",
        label: "Approvals",
        shortLabel: "Approval",
        icon: "approvals",
        badge: summary.blockedAgents,
        tone: summary.blockedAgents > 0 ? "warn" : "normal",
      },
    ];

    if (narrow) {
      return v_flex()
        .id("nav")
        .when(this.part === "nav", (el) => el.w_full())
        .when(this.part !== "nav", (el) => el.w(72))
        .h_full()
        .min_h(0)
        .flex_none()
        .overflow_y_scrollbar()
        .bg(PALETTE.surface)
        .border_r(1)
        .border_color(PALETTE.line)
        .px(6)
        .py(12)
        .items_center()
        .child(
          v_flex()
            .w_full()
            .flex_none()
            .items_center()
            .gap(10)
            .child(
              h_flex()
                .size(32)
                .rounded(RADII.chip)
                .bg(PALETTE.accent)
                .items_center()
                .justify_center()
                .tooltip(`Herdr Control · ${userHostText}`)
                .child(iconOf("terminals", 16, PALETTE.onAccent)),
            )
            .child(
              v_flex()
                .w_full()
                .gap(4)
                .children(
                  items.map((item) => {
                    const active = this.isActive(item.id);
                    const tip = item.badge !== null ? `${item.label} (${item.badge})` : item.label;
                    return v_flex()
                      .id(`nav-${item.id}`)
                      .w_full()
                      .py(7)
                      .px(4)
                      .gap(3)
                      .rounded(RADII.inner)
                      .items_center()
                      .justify_center()
                      .cursor_pointer()
                      .tooltip(tip)
                      .bg(active ? PALETTE.accent : PALETTE.surface)
                      .text_color(active ? PALETTE.onAccent : PALETTE.muted)
                      .when(!active, (el) => el.hover((s) => s.bg(PALETTE.raised).text_color(PALETTE.text)))
                      .on_click((_e, cx) => this.selectScreen(item.id, cx))
                      .child(iconOf(item.icon, 16, active ? PALETTE.onAccent : PALETTE.muted))
                      .child(
                        div()
                          .w_full()
                          .text_center()
                          .text_size(SIZES.xs)
                          .font_semibold()
                          .truncate()
                          .child(item.shortLabel),
                      );
                  }),
                ),
            ),
        )
        .child(div().flex_1().min_h(10))
        .child(
          v_flex()
            .w_full()
            .flex_none()
            .gap(6)
            .items_center()
            .when(usageRows.length > 0, (el) => el.child(renderSidebarUsage(usageRows, true, usageCollapsed)))
            .child(
              h_flex()
                .id("stream-switch-narrow-row")
                .w_full()
                .py(6)
                .rounded(RADII.chip)
                .items_center()
                .justify_center()
                .bg(streaming ? PALETTE.warnSoft : PALETTE.raised)
                .border(1)
                .border_color(streaming ? PALETTE.warnBorder : PALETTE.line)
                .text_color(streaming ? PALETTE.warn : PALETTE.muted)
                .hover((s) =>
                  s
                    .bg(streaming ? PALETTE.warnHover : PALETTE.raisedHover)
                    .border_color(streaming ? PALETTE.warn : PALETTE.lineStrong)
                    .text_color(streaming ? PALETTE.warn : PALETTE.text),
                )
                .child(
                  Switch.new("stream-switch-narrow")
                    .w_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_size(SIZES.xs)
                    .font_bold()
                    .cursor_pointer()
                    .tooltip(streaming ? "Streaming mode on" : "Turn on streaming mode")
                    .checked(streaming)
                    .on_change((next, cx) => this.setStreaming(next, cx))
                    .child(streaming ? "Stream" : "Hide"),
                ),
            )
            .when(showReturn, (el) => el.child(
              h_flex()
                .id("return-terminal-narrow")
                .w_full()
                .h(34)
                .rounded(RADII.chip)
                .bg(PALETTE.raised)
                .border(1)
                .border_color(PALETTE.lineStrong)
                .items_center()
                .justify_center()
                .cursor_pointer()
                .tooltip("Back to terminal")
                .hover((s) => s.bg(PALETTE.raisedHover).border_color(PALETTE.accent))
                .on_click(() => this.returnToTerminal())
                .child(iconOf("terminals", 16, PALETTE.text)),
            )),
        );
    }

    // macOS draws its traffic lights over a titlebar-less layout; keep the header below them.
    const topPadding = !this.embeddedPanel && trafficLightsOverNav() ? 38 : 14;
    const bottomPadding = 14;
    const navGap = 10;
    const error = !isDemo() && this.navTerminalError ? maskError(this.navTerminalError) : null;
    const controls = NAV_TERMINAL_CONTROLS;
    const controlsHeight = controls.topPadding + controls.borderWidth + controls.headingHeight
      + controls.buttonHeight + 2 * controls.gap + (error ? controls.errorHeight + controls.gap : 0);
    const { tabHeight, moreHeight } = dataModule.SIDEBAR_TERMINAL_METRICS;
    const { listHeight, scroll } = dataModule.sidebarListBudget({
      height,
      headerHeight: this.navHeights.header,
      footerHeight: this.navHeights.footer,
      controlsHeight,
      insetHeight: topPadding + bottomPadding + 2 * navGap,
      minListHeight: live.spacesList?.some((space) => space?.tabs?.length) ? moreHeight : tabHeight,
    });
    const trackHeight = (part) => ({ height }, cx) => {
      if (this.navHeights[part] === height) return;
      this.navHeights[part] = height;
      cx.notify();
    };

    return v_flex()
      .id("nav")
      .when(this.part === "nav", (el) => el.size_full().min_h(0))
      .when(this.part !== "nav", (el) =>
        el.w(232).h_full().min_h(0).flex_none().border_r(1).border_color(PALETTE.line),
      )
      .bg(PALETTE.surface)
      .when(scroll, (el) => el.overflow_y_scrollbar())
      .px(10)
      .pt(topPadding)
      .pb(bottomPadding)
      .gap(navGap)
      .child(
        v_flex()
          .id("nav-header")
          .w_full()
          .flex_none()
          .on_size_change(trackHeight("header"))
          .gap(12)
          .child(
            h_flex()
              .w_full()
              .gap(9)
              .items_center()
              .px(4)
              .pb(12)
              .border_b(1)
              .border_color(PALETTE.line)
              .child(
                h_flex()
                  .size(32)
                  .flex_none()
                  .rounded(RADII.chip)
                  .bg(PALETTE.accent)
                  .items_center()
                  .justify_center()
                  .child(iconOf("terminals", 16, PALETTE.onAccent)),
              )
              .child(
                v_flex()
                  .flex_1()
                  .min_w(0)
                  .gap(1)
                  .child(
                    div()
                      .truncate()
                      .text_size(SIZES.md)
                      .font_bold()
                      .text_color(PALETTE.text)
                      .child("Herdr Control"),
                  )
                  .child(
                    div()
                      .truncate()
                      .text_size(SIZES.xs)
                      .font_family(monoFont())
                      .text_color(PALETTE.mono)
                      .child(userHostText),
                  ),
              ),
          )
          .child(
            v_flex()
              .w_full()
              .gap(4)
              .children(
                items.map((item) => {
                  const active = this.isActive(item.id);
                  const badgeEl = this.renderNavBadge(item, active);
                  return h_flex()
                    .id(`nav-${item.id}`)
                    .w_full()
                    .h(36)
                    .px(10)
                    .gap(9)
                    .rounded(RADII.inner)
                    .items_center()
                    .cursor_pointer()
                    .bg(active ? PALETTE.accent : PALETTE.surface)
                    .text_color(active ? PALETTE.onAccent : PALETTE.muted)
                    .when(!active, (el) => el.hover((s) => s.bg(PALETTE.raised).text_color(PALETTE.text)))
                    .on_click((_e, cx) => this.selectScreen(item.id, cx))
                    .child(
                      h_flex()
                        .size(26)
                        .flex_none()
                        .rounded(RADII.chip)
                        .bg(active ? PALETTE.onAccentSoft : PALETTE.rowBg)
                        .items_center()
                        .justify_center()
                        .child(iconOf(item.icon, 15, active ? PALETTE.onAccent : PALETTE.muted)),
                    )
                    .child(
                      div()
                        .flex_1()
                        .min_w(0)
                        .truncate()
                        .text_size(SIZES.sm)
                        .font_semibold()
                        .child(item.label),
                    )
                    .when(Boolean(badgeEl), (el) => el.child(badgeEl));
                }),
              ),
          ),
      )
      .child(this.renderNavTerminals(live.spacesList, live.panesList, listHeight, error))
      .child(
        v_flex()
          .id("nav-footer")
          .w_full()
          .flex_none()
          .on_size_change(trackHeight("footer"))
          .gap(navGap)
          .when(usageRows.length > 0, (el) => el.child(renderSidebarUsage(usageRows, false, usageCollapsed)))
          .child(
            h_flex()
              .id("stream-switch-row")
              .w_full()
              .h(38)
              .px(10)
              .rounded(RADII.inner)
              .items_center()
              .bg(streaming ? PALETTE.warnSoft : PALETTE.raised)
              .border(1)
              .border_color(streaming ? PALETTE.warnBorder : PALETTE.line)
              .text_color(streaming ? PALETTE.warn : PALETTE.muted)
              .hover((s) =>
                s
                  .bg(streaming ? PALETTE.warnHover : PALETTE.raisedHover)
                  .border_color(streaming ? PALETTE.warn : PALETTE.lineStrong)
                  .text_color(streaming ? PALETTE.warn : PALETTE.text),
              )
              .child(
                Switch.new("stream-switch")
                  .w_full()
                  .h_full()
                  .flex()
                  .items_center()
                  .justify_between()
                  .gap(8)
                  .cursor_pointer()
                  .checked(streaming)
                  .on_change((next, cx) => this.setStreaming(next, cx))
                  .child(
                    div()
                      .min_w(0)
                      .truncate()
                      .text_size(SIZES.xs)
                      .font_bold()
                      .child(streaming ? "Streaming mode on" : "Streaming mode"),
                  )
                  .child(
                    h_flex()
                      .w(34)
                      .h(20)
                      .px(3)
                      .flex_none()
                      .rounded(RADII.pill)
                      .items_center()
                      .justify_end()
                      .when(!streaming, (el) => el.justify_start())
                      .bg(streaming ? PALETTE.warn : PALETTE.track)
                      .border(1)
                      .border_color(streaming ? PALETTE.warn : PALETTE.lineStrong)
                      .child(
                        div()
                          .size(14)
                          .rounded(14)
                          .bg(streaming ? PALETTE.onAccent : PALETTE.muted),
                      ),
                  ),
              ),
          )
          .child(this.renderNavTailnet(summary, tailnetCompact, showReturn)),
      );
  }

  renderNavTailnet(summary, compact, showReturn) {
    const tailnetLabel = summary.tailnetName ? `Tailnet · ${maskTailnet(summary.tailnetName)}` : "Tailnet · —";
    const pingLabel = summary.pingMs !== null ? `${summary.pingMs} ms` : "—";
    const terminalCount = dataModule.countLabel(summary.liveTerminals, "terminal");
    const funnel = summary.funnelPort !== null ? `Funnel :${summary.funnelPort} open` : null;
    const stale = summary.staleAgeMin !== null ? `data from ${summary.staleAgeMin} min ago` : null;
    const error = !stale && !summary.tailnetName && summary.collectError !== dataModule.INVALID_COLLECTOR_RESULT
      ? summary.collectError : null;
    const dotColor = stale ? PALETTE.warn : summary.tailnetName ? PALETTE.ok : PALETTE.offline;
    const dot = div().size(7).flex_none().rounded(7).bg(dotColor);
    const name = div().flex_1().min_w(0).truncate().text_size(SIZES.xs)
      .font_semibold().text_color(PALETTE.text).child(tailnetLabel);
    const terminalIcon = iconOf("terminals", 14, PALETTE.text);
    const footer = h_flex()
      .w_full()
      .h(34)
      .px(10)
      .gap(8)
      .rounded(compact ? RADII.inner : RADII.chip)
      .bg(compact ? PALETTE.raised : PALETTE.surface)
      .border(1)
      .border_color(PALETTE.lineStrong)
      .items_center()
      .id(showReturn ? "return-terminal" : "tailnet-summary")
      .when(showReturn, (el) => el
        .cursor_pointer()
        .hover((s) => s.bg(PALETTE.raisedHover).border_color(PALETTE.accent))
        .on_click(() => this.returnToTerminal()));
    if (compact) {
      const details = [tailnetLabel, `${pingLabel} · ${terminalCount}`, funnel, stale, error];
      if (showReturn) details.push("Back to terminal");
      return footer.tooltip(details.filter(Boolean).join("\n")).child(dot).child(name)
        .when(showReturn, (el) => el.role("button").accessibility_label("Back to terminal").child(terminalIcon));
    }

    const detail = (text, color) => div().w_full().truncate().text_size(SIZES.xs).text_color(color).child(text);
    return v_flex()
      .id("tailnet-card")
      .w_full()
      .p(10)
      .gap(6)
      .rounded(RADII.inner)
      .bg(PALETTE.raised)
      .border(1)
      .border_color(PALETTE.line)
      .child(h_flex().w_full().items_center().gap(6).child(dot).child(name.tooltip(tailnetLabel)))
      .child(
        h_flex().w_full().items_center().gap(5).text_size(SIZES.xs)
          .child(
            div().font_family(monoFont()).font_semibold()
              .text_color(summary.pingMs !== null ? PALETTE.ok : PALETTE.muted)
              .child(pingLabel),
          )
          .child(div().text_color(PALETTE.muted).child(`· ${terminalCount}`)),
      )
      .when(funnel, (el) => el.child(detail(funnel, PALETTE.mono).font_family(monoFont())))
      .when(stale, (el) => el.child(detail(stale, PALETTE.warn).font_semibold()))
      .when(error, (el) => el.child(detail(error, PALETTE.warn)))
      .when(showReturn, (el) => el.child(
        footer.child(terminalIcon).child(
          div().flex_1().min_w(0).truncate().text_size(SIZES.xs)
            .font_bold().text_color(PALETTE.text).child("Back to terminal"),
        ),
      ));
  }

  renderTopBar(summary, narrow) {
    const streaming = isStreaming();
    const screenTitle = SCREEN_TITLES[this.currentScreen()] ?? "Overview";
    const fullTitle = streaming ? screenTitle : `${screenTitle} · Herdr Control`;
    const clock = formatClock(dashboardNow());
    const activeRange = RANGE_OPTIONS.includes(shared(RANGE_KEY))
      ? shared(RANGE_KEY)
      : RANGE_OPTIONS[0];

    const rangeControl = h_flex()
      .flex_none()
      .items_center()
      .p(3)
      .gap(2)
      .rounded(RADII.pill)
      .bg(PALETTE.surface)
      .border(1)
      .border_color(PALETTE.line)
      .children(
        RANGE_OPTIONS.map((opt) => {
          const active = activeRange === opt;
          return h_flex()
            .id(`range-${opt}`)
            .h(28)
            .px(11)
            .rounded(RADII.pill)
            .items_center()
            .justify_center()
            .cursor_pointer()
            .text_size(SIZES.xs)
            .font_bold()
            .when(active, (el) =>
              el
                .bg(PALETTE.raised)
                .border(1)
                .border_color(PALETTE.lineStrong)
                .text_color(PALETTE.text),
            )
            .when(!active, (el) =>
              el
                .text_color(PALETTE.muted)
                .hover((s) => s.text_color(PALETTE.text)),
            )
            .on_click((_e, cx) => {
              setShared(RANGE_KEY, opt);
              cx.notify();
            })
            .child(opt);
        }),
      );

    const bellButton = div()
      .id("topbar-bell")
      .relative()
      .size(36)
      .flex_none()
      .rounded(36)
      .bg(PALETTE.surface)
      .border(1)
      .border_color(PALETTE.lineStrong)
      .flex()
      .items_center()
      .justify_center()
      .cursor_pointer()
      .tooltip(
        summary.blockedAgents > 0
          ? `${summary.blockedAgents} pending approvals`
          : "No pending approvals",
      )
      .hover((s) => s.bg(PALETTE.raised).border_color(PALETTE.lineHover))
      .on_click((_e, cx) => this.selectScreen("approvals", cx))
      .child(iconOf("bell", 16, PALETTE.text))
      .when(summary.blockedAgents > 0, (el) =>
        el.child(
          h_flex()
            .absolute()
            .top(-4)
            .right(-4)
            .min_w(18)
            .h(18)
            .px(4)
            .rounded(RADII.pill)
            .bg(PALETTE.warn)
            .border(2)
            .border_color(PALETTE.bg)
            .items_center()
            .justify_center()
            .text_size(SIZES.xs)
            .font_extrabold()
            .font_family(monoFont())
            .text_color(PALETTE.onAccent)
            .child(String(summary.blockedAgents)),
        ),
      );

    const avatar = h_flex()
      .id("topbar-avatar")
      .size(36)
      .flex_none()
      .rounded(36)
      .bg(PALETTE.accent)
      .items_center()
      .justify_center()
      .text_size(SIZES.xs)
      .font_extrabold()
      .text_color(PALETTE.onAccent)
      .tooltip(streaming ? "Streaming mode on" : "Herdr Control · Control Room")
      .child(maskAvatar("HC"));

    const titleBlock = v_flex()
      .flex_1()
      .min_w(0)
      .gap(2)
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .min_w(0)
          .child(
            div()
              .truncate()
              .text_size(SIZES.lg)
              .font_bold()
              .text_color(PALETTE.text)
              .child(fullTitle),
          )
          .when(streaming, (el) =>
            el.child(
              chip({
                label: "streaming mode",
                color: PALETTE.warn,
                bg: PALETTE.warnSoft,
                borderColor: PALETTE.warnBorder,
              }),
            ),
          )
          .when(isDemo(), (el) => el.child(chip({
            label: "DEMO DATA",
            color: PALETTE.warn,
            bg: PALETTE.warnSoft,
            borderColor: PALETTE.warnBorder,
          }))),
      )
      .child(
        div()
          .truncate()
          .text_size(SIZES.xs)
          .font_family(monoFont())
          .text_color(PALETTE.mono)
          .child(`${clock.day} · ${clock.hhmm}`),
      );

    if (narrow) {
      return v_flex()
        .id("topbar")
        .w_full()
        .flex_none()
        .gap(10)
        .child(
          h_flex()
            .w_full()
            .items_center()
            .justify_between()
            .gap(10)
            .child(titleBlock)
            .child(h_flex().flex_none().items_center().gap(10).child(bellButton).child(avatar)),
        )
        .child(h_flex().w_full().items_center().child(rangeControl));
    }

    return h_flex()
      .id("topbar")
      .w_full()
      .flex_none()
      .items_center()
      .justify_between()
      .gap(16)
      .child(titleBlock)
      .child(
        h_flex()
          .flex_none()
          .items_center()
          .gap(10)
          .child(rangeControl)
          .child(bellButton)
          .child(avatar),
      );
  }

  renderScreen(live, narrow) {
    const t = monoTheme();
    const onNavigate = (screen, cx) => this.selectScreen(screen, cx);
    const sharedCtx = { t, data: dataModule, ui: uiModule, narrow };
    switch (this.currentScreen()) {
      case "approvals":
        return renderApprovals({
          ui: uiModule,
          palette,
          jump,
          maskHost,
          maskPath,
          agentsList: live.agentsList,
          spacesList: live.spacesList,
          blockedSinceMap: live.blockedSince ?? this.blockedSince,
          confirming: live.demo ? null : this.confirmingApproval,
          sendingAddress: live.demo ? null : this.sendingApproval,
          actionError: live.demo ? null : this.approvalError,
          onSetConfirm: (val, cx) => {
            this.confirmingApproval = val;
            cx.notify();
          },
          onClearConfirm: (cx) => {
            this.confirmingApproval = null;
            cx.notify();
          },
          onSetSending: (addr, cx) => {
            this.sendingApproval = addr;
            cx.notify();
          },
          onSetError: (msg, cx) => {
            this.approvalError = msg;
            cx.notify();
          },
        });
      case "agents":
        return renderAgents({
          data: dataModule,
          ui: uiModule,
          palette,
          jump,
          maskHost,
          maskPath,
          prices: PRICES,
          catalog: live.catalog ?? this.catalog,
          activeRange: shared(RANGE_KEY),
          agentsTab: this.currentAgentsTab(),
          onAgentsTab: (nextTab, cx) => {
            if (AGENTS_TABS.includes(nextTab)) {
              this.setAgentsTab(nextTab);
              cx.notify();
            }
          },
          machineFilter: this.agentsMachineFilter,
          onMachineFilter: (nextMachine, cx) => {
            this.agentsMachineFilter = nextMachine;
            cx.notify();
          },
          healthChecks: live.demo ? {} : this.healthChecks,
          onRunHealth: (targets, cx) => this.runAgentHealthChecks(targets, cx),
          collectEntries: live.collectEntries,
          machinesList: live.machinesList,
          spacesList: live.spacesList,
          agentsList: live.agentsList,
          terminalsList: live.terminalsList,
          panesList: live.panesList,
          narrow,
          embeddedPanel: this.embeddedPanel,
        });
      case "machines": {
        const selectionKey = live.demo ? DEMO_MACHINE_KEY : MACHINE_KEY;
        const localSelection = live.demo ? this.selectedDemoMachine ?? "build-server" : this.selectedMachine;
        return renderMachines({
          ...sharedCtx,
          palette,
          jump,
          maskHost,
          maskIp,
          maskTailnet,
          maskPath,
          maskContainer,
          limits: live.limits,
          collectEntries: live.collectEntries,
          localEntry: live.localEntry,
          selectedMachine: (this.part ? shared(selectionKey) : null) ?? localSelection,
          onSelectMachine: (key, cx) => {
            if (live.demo) this.selectedDemoMachine = key;
            else this.selectedMachine = key;
            this.dockerLogError = null;
            if (this.part) setShared(selectionKey, key);
            cx.notify();
          },
          pingHistory: live.pingHistory ?? this.pingHistory,
          machinesList: live.machinesList,
          spacesList: live.spacesList,
          agentsList: live.agentsList,
          terminalsList: live.terminalsList,
          streaming: isStreaming(),
          dockerLogError: live.demo ? null : this.dockerLogError,
          onOpenContainerLogs: (machine, container, containerKey, clickCx) =>
            this.openContainerLogs(machine, container, live.spacesList, containerKey, clickCx),
        });
      }
      case "spaces":
        return renderSpaces({
          ...sharedCtx,
          palette,
          jump,
          maskHost,
          maskPath,
          collectEntries: live.collectEntries,
          localEntry: live.localEntry,
          spacesList: live.spacesList,
          agentsList: live.agentsList,
          terminalsList: live.terminalsList,
          panesList: live.panesList,
          selectedSpace: this.selectedSpace,
          onSelectSpace: (id, clickCx) => {
            this.selectedSpace = id;
            const sp = dashboardSpaces()?.find((s) => s.id === id);
            if (sp) this.ensureSpaceCommits(sp, clickCx);
            clickCx.notify();
          },
          spaceCommits: live.commits ?? this.spaceCommits,
          onRefreshCommits: (sp, clickCx) => {
            if (sp) this.ensureSpaceCommits(sp, clickCx, { force: true });
            clickCx.notify();
          },
          blockedSinceMap: live.blockedSince ?? this.blockedSince,
          confirmingTabClose: live.demo ? null : this.confirmingTabClose,
          onSetConfirmTabClose: (val, clickCx) => {
            this.confirmingTabClose = val;
            clickCx.notify();
          },
          onClearConfirmTabClose: (clickCx) => {
            this.confirmingTabClose = null;
            clickCx.notify();
          },
          onCreateSpace: (clickCx) => this.createSpaceFromUi("list", clickCx),
          onCreateTerminal: (spaceId, clickCx) =>
            this.createTerminalFromUi(spaceId, spaceId ? "hero" : "list", clickCx),
          onCloseTab: (tabId, clickCx) => this.closeTabFromSpaces(tabId, clickCx),
          spacesError: live.demo ? null : this.spacesError,
        });
      case "ports":
        return renderPorts({
          data: dataModule,
          ui: uiModule,
          palette,
          jump,
          maskHost,
          maskIp,
          maskPath,
          collectEntries: live.collectEntries,
          localEntry: live.localEntry,
          machinesList: live.machinesList,
          spacesList: live.spacesList,
          accessFilter: this.portsAccessFilter,
          onAccessFilter: (next, cx) => {
            this.portsAccessFilter = next;
            cx.notify();
          },
          machineFilter: this.portsMachineFilter,
          onMachineFilter: (next, cx) => {
            this.portsMachineFilter = next;
            this.portsMachineMenuOpen = false;
            cx.notify();
          },
          machineMenuOpen: this.portsMachineMenuOpen,
          onToggleMachineMenu: (cx) => {
            this.portsMachineMenuOpen = !this.portsMachineMenuOpen;
            cx.notify();
          },
          collapsedMachines: this.portsCollapsed,
          onToggleCollapse: (key, cx) => {
            if (this.portsCollapsed.has(key)) {
              this.portsCollapsed.delete(key);
            } else {
              this.portsCollapsed.add(key);
            }
            cx.notify();
          },
          narrow,
        });
      case "overview":
      default:
        return renderOverview({
          ...sharedCtx,
          palette,
          jump,
          maskHost,
          maskPath,
          activeRange: shared(RANGE_KEY),
          collectEntries: live.collectEntries,
          localEntry: live.localEntry,
          machinesList: live.machinesList,
          spacesList: live.spacesList,
          agentsList: live.agentsList,
          terminalsList: live.terminalsList,
          panesList: live.panesList,
          blockedSinceMap: live.blockedSince ?? this.blockedSince,
          onNavigate,
        });
    }
  }

  render(cx) {
    if (this.gotoMode) {
      return h_flex()
        .id("root-goto")
        .size_full()
        .items_center()
        .justify_center()
        .bg(PALETTE.bg)
        .font_family(monoFont())
        .text_size(SIZES.sm)
        .text_color(PALETTE.text)
        .child(`Redirected to: ${this.gotoTarget}`);
    }

    const live = readDashboard();
    if (this.part === "status") return renderStatus(live);
    const { spacesList, agentsList, panesList, collectEntries, localEntry } = live;
    if (!live.demo) {
      this.trackBlockedSince(agentsList);
      this.recordPingSamples(collectEntries);
    }
    if (this.part === "content" || this.part === null) this.ensureCatalog(cx);
    if ((this.part === "content" || this.part === null) && this.currentScreen() === "spaces") {
      this.ensureSelectedSpaceCommits(spacesList, cx);
    }

    const summary = buildShellSummary({ ...live, now: dashboardNow() });

    if (!live.demo && this.confirmingTabClose) {
      const stillOpen = (spacesList ?? []).some((sp) =>
        (sp?.tabs ?? []).some((t) => t && t.id === this.confirmingTabClose.tabId),
      );
      if (!stillOpen) this.confirmingTabClose = null;
    }

    const narrow = this.embeddedPanel || (this.width !== null && this.width < 900);
    const navData = { spacesList, panesList, collectEntries, focusedInfo: live.focusedInfo };
    const trackSize = (size, sizeCx) => {
      const width = Math.round(size.width);
      if (this.width !== width || this.height !== size.height) {
        this.width = width;
        this.height = size.height;
        sizeCx.notify();
      }
    };

    if (this.part === "nav") {
      return v_flex()
        .id("root-nav")
        .size_full()
        .min_h(0)
        .font_family(textFont())
        .bg(PALETTE.surface)
        .text_color(PALETTE.text)
        .on_size_change(trackSize)
        .child(this.renderNav(summary, this.width !== null && this.width < 160, navData));
    }

    if (this.part === "aside") {
      return renderAside({
        ui: uiModule,
        palette,
        jump,
        maskHost,
        maskPath,
        streaming: isStreaming(),
        collectEntries,
        localEntry,
        spacesList,
        agentsList,
        focusedInfo: live.focusedInfo,
        blockedSinceMap: live.blockedSince ?? this.blockedSince,
        confirming: live.demo ? null : this.confirmingApproval,
        sendingAddress: live.demo ? null : this.sendingApproval,
        actionError: live.demo ? null : this.approvalError,
        onSetConfirm: (val, clickCx) => {
          this.confirmingApproval = val;
          clickCx.notify();
        },
        onClearConfirm: (clickCx) => {
          this.confirmingApproval = null;
          clickCx.notify();
        },
        onSetSending: (addr, clickCx) => {
          this.sendingApproval = addr;
          clickCx.notify();
        },
        onSetError: (msg, clickCx) => {
          this.approvalError = msg;
          clickCx.notify();
        },
      });
    }

    return h_flex()
      .id("root")
      .size_full()
      .min_h(0)
      .font_family(textFont())
      .bg(PALETTE.bg)
      .text_color(PALETTE.text)
      .on_size_change(trackSize)
      .when(this.part !== "content", (el) =>
        el.child(this.renderNav(summary, narrow, navData)),
      )
      .child(
        v_flex()
          .id("content-wrap")
          .flex_1()
          .min_w(0)
          .h_full()
          .min_h(0)
          .bg(PALETTE.bg)
          .px(narrow ? 16 : 20)
          .pt(14)
          .pb(14)
          .gap(14)
          .child(this.renderTopBar(summary, narrow))
          .child(
            v_flex()
              .id(`screen-${this.currentScreen()}`)
              .flex_1()
              .w_full()
              .min_h(0)
              .overflow_y_scrollbar()
              .gap(16)
              .child(this.renderScreen(live, narrow)),
          ),
      );
  }
}

function renderStatus(live) {
  const t = theme();
  const space = live.spacesList?.find((item) => item.active);
  const list = live.agentsList ?? [];
  const needs = list.filter((agent) => agent.status === "blocked").length;
  const rows = [
    space?.machine ? maskHost(space.machine) : "This computer",
    space?.branch ? maskBranch(space.branch) : null,
    dataModule.countLabel(list.length, "agent"),
    needs ? needs + " need attention" : null,
  ].filter(Boolean);
  const binding = live.demo ? null : keys().find((key) => key.section === "global" && key.action === "app.palette");
  return h_flex().size_full().px(14).gap(16).items_center()
    .bg(t.chrome).border_t(1).border_color(t.border).text_size(SIZES.xs).text_color(t.muted)
    .child(div().flex_1().min_w(0).truncate().child(rows.join(" · ")))
    .when(!live.demo, (el) => el.child(div().id("status-palette").cursor_pointer()
      .on_click(() => { if (!isDemo()) run("app.palette"); })
      .child(binding ? binding.keys + " · Commands" : "Commands")));
}

function viewportHeight() {
  try {
    return window.viewport_size().height;
  } catch {
    return null;
  }
}

function trafficLightsOverNav() {
  try {
    const w = hostWindow();
    return w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen;
  } catch {
    return false;
  }
}
