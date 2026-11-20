// Screen 2: Spaces — master-detail over Herdr spaces, activity, terminals, agents, ports & Git commits.

import { dashboardNow, isDemo } from "../demo-mode.js";
import { dashboardCommands } from "../source.js";
import { maskBranch, maskError, maskProgram, maskText, maskTitle } from "../mask.js";
import { countLabel, extractTargetPort, tailscaleRoutes } from "../data.js";
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { openOverlay } from "herdr";
import { renderInlineConfirm } from "./approvals.js";

const BACKSLASH = String.fromCharCode(92);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function localIsoDate(d = dashboardNow()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoDateDaysAgo(daysAgo) {
  const d = dashboardNow();
  d.setDate(d.getDate() - daysAgo);
  return localIsoDate(d);
}

function formatShortDate(isoDate) {
  if (!isoDate || typeof isoDate !== "string") return "—";
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const mon = MONTHS[Number(parts[1]) - 1];
  const day = Number(parts[2]);
  if (!mon || !Number.isFinite(day)) return isoDate;
  return `${day} ${mon}`;
}

function formatHours(seconds) {
  const hrs = (Number(seconds) || 0) / 3600;
  return hrs.toFixed(1);
}

function formatLastChange(ts) {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) {
    return { label: "—", isNow: false };
  }
  const diffMin = Math.max(0, Math.floor((dashboardNow().getTime() - ts) / 60000));
  if (diffMin < 1) return { label: "now", isNow: true };
  if (diffMin < 60) return { label: `${diffMin} min ago`, isNow: false };
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return { label: `${diffHours} h ago`, isNow: false };
  return { label: `${Math.floor(diffHours / 24)} d ago`, isNow: false };
}

export function formatDurationMs(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return "<1 min";
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
}

function formatGitRelTime(raw) {
  if (!raw || typeof raw !== "string") return "—";
  const s = raw.trim();
  const lower = s.toLowerCase();
  if (lower === "just now" || lower.includes("second")) return "now";
  if (lower === "yesterday") return "yesterday";
  const match = lower.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/);
  if (!match) return s;
  const n = match[1];
  switch (match[2]) {
    case "minute":
      return `${n} min`;
    case "hour":
      return `${n} h`;
    case "day":
      return n === "1" ? "yesterday" : `${n} d`;
    case "week":
      return `${n} wk`;
    case "month":
      return `${n} mo`;
    case "year":
      return `${n} yr`;
    default:
      return s;
  }
}

function normalizePath(p) {
  if (!p || typeof p !== "string") return "";
  return p.split(BACKSLASH).join("/").replace(/\/+$/, "").toLowerCase();
}

function lastPathSegment(p) {
  if (!p || typeof p !== "string") return "";
  const parts = p
    .split("/")
    .flatMap((seg) => seg.split(BACKSLASH))
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

export function machineFromAddress(address) {
  if (!address || typeof address !== "string") return null;
  const slash = address.indexOf("/");
  return slash === -1 ? null : address.slice(0, slash);
}

function stripMachinePrefix(id) {
  if (!id || typeof id !== "string") return "";
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}

function maskAddress(address, maskHost) {
  if (!address || typeof address !== "string") return "—";
  const slash = address.indexOf("/");
  if (slash === -1) return maskText(address);
  return `${maskHost(address.slice(0, slash))}/${maskText(address.slice(slash + 1))}`;
}

function findAgentPickerCommand() {
  try {
    const list = dashboardCommands() ?? [];
    return (
      list.find(
        (c) =>
          c &&
          typeof c.name === "string" &&
          (c.name === "agent.picker" || c.name === "agent.new" || c.name.includes("picker")),
      ) ?? null
    );
  } catch {
    return null;
  }
}

function spaceChipStyle(PALETTE, status) {
  switch (status) {
    case "working":
      return { color: PALETTE.ok, bg: PALETTE.okSoft, borderColor: PALETTE.okBorder };
    case "blocked":
      return { color: PALETTE.warn, bg: PALETTE.warnSoft, borderColor: PALETTE.warnBorder };
    case "done":
      return { color: PALETTE.muted, bg: PALETTE.rowBg, borderColor: PALETTE.line };
    case "idle":
    default:
      return { color: PALETTE.muted, bg: PALETTE.rowBg, borderColor: PALETTE.line };
  }
}

function cardHead({
  ui,
  palette,
  icon,
  iconTone = "normal",
  title,
  chipLabel = null,
  chipTone = "normal",
  rightExtra = null,
}) {
  const { PALETTE, SIZES, RADII } = palette;
  const iconBg =
    iconTone === "danger"
      ? PALETTE.dangerSoft
      : iconTone === "ok"
        ? PALETTE.okSoft
        : PALETTE.raised;
  const iconColor =
    iconTone === "danger"
      ? PALETTE.danger
      : iconTone === "ok"
        ? PALETTE.ok
        : PALETTE.text;
  const iconBorder =
    iconTone === "danger"
      ? PALETTE.dangerBorder
      : iconTone === "ok"
        ? PALETTE.okBorder
        : PALETTE.lineStrong;

  const chipColor =
    chipTone === "danger"
      ? PALETTE.danger
      : chipTone === "warn"
        ? PALETTE.warn
        : chipTone === "ok"
          ? PALETTE.ok
          : PALETTE.mono;
  const chipBg =
    chipTone === "danger"
      ? PALETTE.dangerSoft
      : chipTone === "warn"
        ? PALETTE.warnSoft
        : chipTone === "ok"
          ? PALETTE.okSoft
          : PALETTE.rowBg;
  const chipBorder =
    chipTone === "danger"
      ? PALETTE.dangerBorder
      : chipTone === "warn"
        ? PALETTE.warnBorder
        : chipTone === "ok"
          ? PALETTE.okBorder
          : PALETTE.line;

  return h_flex()
    .w_full()
    .flex_wrap()
    .items_center()
    .justify_between()
    .gap(6)
    .child(
      h_flex()
        .flex_none()
        .items_center()
        .gap(7)
        .child(
          h_flex()
            .size(26)
            .flex_none()
            .rounded(RADII.chip)
            .bg(iconBg)
            .border(1)
            .border_color(iconBorder)
            .items_center()
            .justify_center()
            .child(ui.iconOf(icon, 14, iconColor)),
        )
        .child(
          div()
            .whitespace_nowrap()
            .text_size(SIZES.title)
            .font_bold()
            .text_color(PALETTE.text)
            .child(String(title ?? "")),
        ),
    )
    .child(
      h_flex()
        .flex_none()
        .items_center()
        .gap(6)
        .when(chipLabel !== null && chipLabel !== undefined && chipLabel !== "", (el) =>
          el.child(
            ui.chip({
              label: String(chipLabel),
              mono: true,
              color: chipColor,
              bg: chipBg,
              borderColor: chipBorder,
              h: 22,
              px: 8,
            }),
          ),
        )
        .when(Boolean(rightExtra), (el) => el.child(rightExtra)),
    );
}

function cardEmpty({ ui, palette, icon, title, description }) {
  const { PALETTE, SIZES, RADII } = palette;
  return v_flex()
    .w_full()
    .flex_1()
    .items_center()
    .justify_center()
    .gap(5)
    .px(14)
    .py(14)
    .rounded(RADII.inner)
    .bg(PALETTE.rowBg)
    .border(1)
    .border_color(PALETTE.line)
    .child(ui.iconOf(icon, 18, PALETTE.muted))
    .child(
      div()
        .text_size(SIZES.sm)
        .font_bold()
        .text_color(PALETTE.text)
        .text_center()
        .child(title),
    )
    .child(
      div()
        .text_size(SIZES.xs)
        .text_color(PALETTE.muted)
        .text_center()
        .child(description),
    );
}

function collectSpaceTerminals({ space, panesList, terminalsList, localHostname }) {
  const tabById = new Map();
  for (const tab of space.tabs ?? []) {
    if (tab?.id) tabById.set(tab.id, tab);
  }

  const paneByTerminal = new Map();
  const paneAddrs = new Set();
  for (const p of panesList ?? []) {
    if (!p || !p.tab || !tabById.has(p.tab)) continue;
    if (p.terminal) {
      paneAddrs.add(p.terminal);
      paneByTerminal.set(p.terminal, p);
    }
  }

  const localSpaceId = stripMachinePrefix(space.id);
  const spaceMachine = space.machine ?? null;
  const seen = new Set();
  const result = [];

  for (const t of terminalsList ?? []) {
    if (!t || !t.address) continue;
    const isPaneTerm = paneAddrs.has(t.address);
    const tMachine = machineFromAddress(t.address);
    const labelSpace = t.labels?.["herdr.space"] ?? null;
    const isLabelMatch =
      t.state === "live" &&
      !t.hidden &&
      tMachine === spaceMachine &&
      labelSpace === localSpaceId;

    if (!isPaneTerm && !isLabelMatch) continue;
    if (seen.has(t.address)) continue;
    seen.add(t.address);

    const pane = paneByTerminal.get(t.address) ?? null;
    const labelTabId = t.labels?.["herdr.tab"]
      ? (spaceMachine ? `${spaceMachine}/${t.labels["herdr.tab"]}` : t.labels["herdr.tab"])
      : null;
    const tab = (pane?.tab ? tabById.get(pane.tab) : null) ?? (labelTabId ? tabById.get(labelTabId) : null);
    const progName = pane?.program?.name || t.program?.name || t.agent || t.name || "Terminal";
    const status = pane?.status || t.status || null;
    const rawTitle = pane?.title || t.title || tab?.name || progName;
    const title = rawTitle === t.address ? progName : rawTitle;
    const stateLabel = status
      ? null
      : t.state === "live"
        ? "Live"
        : (t.state || "—");

    const rawCmd = Array.isArray(t.argv) && t.argv.length > 0 ? t.argv.join(" ") : null;
    const machineName = spaceMachine ?? (localHostname || "This computer");

    result.push({
      address: t.address,
      tabId: tab?.id ?? null,
      machineName,
      title,
      progName,
      program: pane?.program || t.program || null,
      cwd: pane?.cwd || t.cwd || null,
      cmd: rawCmd,
      status,
      stateLabel,
      focused: Boolean(pane?.focused),
    });
  }

  for (const [addr, pane] of paneByTerminal.entries()) {
    if (seen.has(addr)) continue;
    const tab = tabById.get(pane.tab);
    const progName = pane.program?.name || pane.app || "Terminal";
    const machineName = spaceMachine ?? (localHostname || "This computer");
    result.push({
      address: addr,
      tabId: tab?.id ?? pane.tab ?? null,
      machineName,
      title: pane.title || tab?.name || progName,
      progName,
      program: pane.program || null,
      cwd: pane.cwd || null,
      cmd: null,
      status: pane.status || null,
      stateLabel: pane.status ? null : "Live",
      focused: Boolean(pane.focused),
    });
  }

  return result;
}

export function collectSpacePorts({ space, collectEntries, localHostname }) {
  const spaceMachine = space.machine ?? null;
  const entry = (collectEntries ?? []).find((e) => (e?.machine ?? null) === spaceMachine) ?? null;
  const res = entry?.result ?? null;
  const rawPorts = Array.isArray(res?.ports) ? res.ports : null;
  if (!rawPorts) return { known: false, ports: [] };

  const folderNorm = normalizePath(space.folder);
  if (!folderNorm) return { known: true, ports: [] };

  const serveList = tailscaleRoutes(res?.tailscale);
  const funnelTargetMap = new Map();
  const serveTargetMap = new Map();
  for (const s of serveList) {
    if (!s) continue;
    const tPort = extractTargetPort(s.target);
    if (s.funnel && tPort !== null) funnelTargetMap.set(tPort, s.port);
    else if (!s.funnel && tPort !== null) serveTargetMap.set(tPort, s.port);
  }

  const ACCESS_RANK = { public: 0, tailnet: 1, local: 2 };
  const deduped = new Map();

  for (const p of rawPorts) {
    if (!p || typeof p.port !== "number") continue;
    const cwdNorm = normalizePath(p.cwd);
    if (!cwdNorm) continue;
    const inside = cwdNorm === folderNorm || cwdNorm.startsWith(`${folderNorm}/`);
    if (!inside) continue;

    const access = p.access ?? "unknown";
    const proc = p.process || "—";
    const key = `${p.port}|${proc}|${p.pid ?? 0}`;
    const prev = deduped.get(key);
    if (!prev || (ACCESS_RANK[access] ?? 9) < (ACCESS_RANK[prev.access] ?? 9)) {
      deduped.set(key, {
        id: `${p.port}-${p.pid ?? 0}-${access}`,
        port: p.port,
        process: proc,
        access,
        machineName: spaceMachine ?? (res?.system?.hostname || localHostname || "This computer"),
        funnelPort: funnelTargetMap.get(p.port) ?? null,
        servePort: serveTargetMap.get(p.port) ?? null,
      });
    }
  }

  const ports = Array.from(deduped.values());
  ports.sort(
    (a, b) =>
      (ACCESS_RANK[a.access] ?? 9) - (ACCESS_RANK[b.access] ?? 9) ||
      a.port - b.port ||
      a.process.localeCompare(b.process),
  );
  return { known: true, ports };
}

function computeSpaceActivity({ space, collectEntries }) {
  const spaceMachine = space.machine ?? null;
  const entry = (collectEntries ?? []).find((e) => (e?.machine ?? null) === spaceMachine) ?? null;
  const days = entry?.result?.usage?.days;
  const hasUsage = Array.isArray(days);
  const projectKey = lastPathSegment(space.folder).toLowerCase();

  const windowDates = [];
  for (let i = 13; i >= 0; i -= 1) {
    windowDates.push(isoDateDaysAgo(i));
  }
  const byDate = new Map(windowDates.map((d) => [d, 0]));

  if (hasUsage && projectKey) {
    for (const row of days) {
      if (!row || row.provider === "antigravity" || !row.date || !byDate.has(row.date)) continue;
      if (String(row.project || "").trim().toLowerCase() !== projectKey) continue;
      byDate.set(row.date, byDate.get(row.date) + (Number(row.active_s) || 0));
    }
  }

  const daily = windowDates.map((date, idx) => ({
    date,
    activeS: byDate.get(date) ?? 0,
    isToday: idx === windowDates.length - 1,
  }));

  const total14S = daily.reduce((sum, d) => sum + d.activeS, 0);
  const todayS = daily[daily.length - 1]?.activeS ?? 0;
  const avgDailyS = total14S / 14;
  const maxDayS = Math.max(3600, ...daily.map((d) => d.activeS));

  return {
    hasUsage,
    hasProject: Boolean(projectKey),
    total14S,
    todayS,
    avgDailyS,
    maxDayS,
    daily,
  };
}

function renderCardError(palette, message) {
  if (!message) return null;
  const { PALETTE, SIZES, RADII } = palette;
  return div()
    .w_full()
    .px(10)
    .py(7)
    .rounded(RADII.chip)
    .bg(PALETTE.dangerSoft)
    .border(1)
    .border_color(PALETTE.dangerBorder)
    .text_size(SIZES.xs)
    .font_semibold()
    .text_color(PALETTE.danger)
    .child(maskError(message));
}

function buildSpaceListPanel({
  ui,
  palette,
  maskHost,
  maskPath,
  spaceModels,
  selectedId,
  activeSpaceId,
  onSelectSpace,
  onCreateSpace,
  onCreateTerminal,
  listError,
  narrow,
}) {
  const { PALETTE, SIZES, RADII, monoFont, statusWord } = palette;

  const totalTerminals = spaceModels.reduce((sum, m) => sum + m.terminals.length, 0);
  const totalAgents = spaceModels.reduce((sum, m) => sum + m.agents.length, 0);

  const items =
    spaceModels.length === 0
      ? [
          cardEmpty({
            ui,
            palette,
            icon: "spaces",
            title: "No open spaces",
            description: "Spaces you open in Herdr appear here.",
          }),
        ]
      : spaceModels.map((m) => {
          const sp = m.space;
          const isSelected = sp.id === selectedId;
          const st = m.status ?? "idle";
          const isBlocked = st === "blocked";
          const chipStyle = spaceChipStyle(PALETTE, st);

          const bg = isSelected
            ? PALETTE.accentSoft
            : isBlocked
              ? PALETTE.warnSoft
              : PALETTE.rowBg;
          const border = isSelected
            ? PALETTE.accentBorder
            : isBlocked
              ? PALETTE.warnBorder
              : PALETTE.line;
          const changeInfo = formatLastChange(m.lastChangedAt);

          return v_flex()
            .id(`space-list-item-${sp.id}`)
            .w_full()
            .px(12)
            .py(10)
            .gap(6)
            .rounded(RADII.inner)
            .bg(bg)
            .border(1)
            .when(isSelected, (el) => el.border_l(3))
            .border_color(border)
            .cursor_pointer()
            .hover((s) =>
              s
                .bg(isSelected ? PALETTE.accentSoft : isBlocked ? PALETTE.warnHover : PALETTE.rowHover)
                .border_color(isSelected ? PALETTE.accentBorder : PALETTE.lineStrong),
            )
            .on_click((_e, cx) => onSelectSpace(sp.id, cx))
            .child(
              h_flex()
                .w_full()
                .items_center()
                .justify_between()
                .gap(8)
                .child(
                  div()
                    .flex_1()
                    .min_w(0)
                    .truncate()
                    .text_size(SIZES.md)
                    .font_bold()
                    .text_color(PALETTE.text)
                    .child(maskPath(sp.name || "—")),
                )
                .child(
                  ui.chip({
                    label: statusWord(st),
                    dotStatus: st,
                    color: chipStyle.color,
                    bg: chipStyle.bg,
                    borderColor: chipStyle.borderColor,
                    h: 22,
                    px: 8,
                  }),
                ),
            )
            .child(
              h_flex()
                .w_full()
                .items_center()
                .justify_between()
                .gap(6)
                .child(
                  sp.branch
                    ? h_flex()
                        .flex_1()
                        .min_w(0)
                        .items_center()
                        .gap(5)
                        .px(7)
                        .py(2)
                        .rounded(RADII.chip)
                        .bg(PALETTE.rowBg)
                        .border(1)
                        .border_color(PALETTE.line)
                        .child(ui.iconOf("branch", 12, PALETTE.mono))
                        .child(
                          div()
                            .min_w(0)
                            .truncate()
                            .font_family(monoFont())
                            .text_size(SIZES.xs)
                            .text_color(PALETTE.mono)
                            .child(maskBranch(sp.branch)),
                        )
                    : div()
                        .font_family(monoFont())
                        .text_size(SIZES.xs)
                        .text_color(PALETTE.muted)
                        .child("—"),
                )
                .when(sp.machine !== null, (el) =>
                  el.child(
                    div()
                      .flex_none()
                      .font_family(monoFont())
                      .text_size(SIZES.xs)
                      .text_color(PALETTE.muted)
                      .whitespace_nowrap()
                      .child(maskHost(sp.machine)),
                  ),
                ),
            )
            .child(
              h_flex()
                .w_full()
                .items_center()
                .justify_between()
                .gap(8)
                .font_family(monoFont())
                .text_size(SIZES.xs)
                .child(
                  div()
                    .text_color(PALETTE.mono)
                    .whitespace_nowrap()
                    .child(`${countLabel(m.terminals.length, "terminal")} · ${countLabel(m.agents.length, "agent")}`),
                )
                .child(
                  div()
                    .flex_none()
                    .whitespace_nowrap()
                    .font_weight(changeInfo.isNow ? 700 : 400)
                    .text_color(changeInfo.isNow ? PALETTE.ok : PALETTE.muted)
                    .child(changeInfo.label),
                ),
            );
        });

  const headerActions = h_flex()
    .w_full()
    .items_center()
    .gap(6)
    .child(
      h_flex()
        .id("spaces-list-new-space")
        .flex_1()
        .h(28)
        .px(8)
        .rounded(RADII.chip)
        .bg(PALETTE.raised)
        .border(1)
        .border_color(PALETTE.lineStrong)
        .items_center()
        .justify_center()
        .cursor_pointer()
        .text_size(SIZES.xs)
        .font_bold()
        .text_color(PALETTE.text)
        .hover((s) => s.bg(PALETTE.raisedHover).border_color(PALETTE.accent))
        .on_click((_e, cx) => onCreateSpace(cx))
        .child("+ New space"),
    )
    .child(
      h_flex()
        .id("spaces-list-new-terminal")
        .flex_1()
        .h(28)
        .px(8)
        .rounded(RADII.chip)
        .bg(PALETTE.raised)
        .border(1)
        .border_color(PALETTE.lineStrong)
        .items_center()
        .justify_center()
        .cursor_pointer()
        .text_size(SIZES.xs)
        .font_bold()
        .text_color(PALETTE.text)
        .hover((s) => s.bg(PALETTE.raisedHover).border_color(PALETTE.accent))
        .on_click((_e, cx) => onCreateTerminal(activeSpaceId ?? null, cx))
        .child("+ Terminal"),
    );

  const errEl = renderCardError(palette, listError);

  const panel = ui.card({
    id: "spaces-list-panel",
    padding: 14,
    gap: 10,
    children: [
      cardHead({
        ui,
        palette,
        icon: "spaces",
        title: "Project Spaces",
        chipLabel: countLabel(spaceModels.length, "space"),
      }),
      headerActions,
      ...(errEl ? [errEl] : []),
      v_flex().w_full().gap(8).children(items),
      div()
        .w_full()
        .pt(8)
        .border_t(1)
        .border_color(PALETTE.line)
        .font_family(monoFont())
        .text_size(SIZES.xs)
        .text_color(PALETTE.muted)
        .truncate()
        .child(`Total: ${countLabel(totalTerminals, "terminal")} · ${countLabel(totalAgents, "agent")}`),
    ],
  });

  return narrow ? panel.w_full() : panel.w(286).flex_none();
}

function buildHeroSection({
  ui,
  palette,
  jump,
  maskHost,
  maskPath,
  model,
  localHostname,
  onCreateSpace,
  onCreateTerminal,
  heroError,
  narrow,
}) {
  const { PALETTE, SIZES, RADII, monoFont, statusWord } = palette;
  const sp = model.space;
  const st = model.status ?? "idle";
  const activity = model.activity;
  const pickerCmd = findAgentPickerCommand();

  const machineLabel = sp.machine ?? (localHostname || "This computer");
  const folderDisplay = sp.folder ? maskPath(sp.folder) : "—";
  const heroDotColor =
    st === "working"
      ? PALETTE.heroGreen
      : st === "blocked"
        ? PALETTE.heroWarn
        : PALETTE.offline;

  const statusPill = h_flex()
    .flex_none()
    .items_center()
    .gap(6)
    .px(9)
    .py(2)
    .rounded(RADII.pill)
    .bg(PALETTE.onAccentSoft)
    .border(1)
    .border_color(PALETTE.onAccentBorder)
    .child(div().size(7).flex_none().rounded(7).bg(heroDotColor))
    .child(
      div()
        .text_size(SIZES.xs)
        .font_bold()
        .text_color(PALETTE.heroText)
        .whitespace_nowrap()
        .child(statusWord(st)),
    );

  const actions = h_flex()
    .flex_none()
    .flex_wrap()
    .items_center()
    .gap(8)
    .child(
      h_flex()
        .id("space-open-terminals")
        .h(34)
        .px(14)
        .gap(7)
        .rounded(RADII.chip)
        .bg(PALETTE.heroText)
        .items_center()
        .justify_center()
        .cursor_pointer()
        .hover((s) => s.bg(PALETTE.raisedHover))
        .on_click(() => jump("space.select", { id: sp.id }))
        .child(ui.iconOf("terminals", 14, PALETTE.heroBg))
        .child(
          div()
            .text_size(SIZES.xs)
            .font_bold()
            .text_color(PALETTE.heroBg)
            .whitespace_nowrap()
            .child("Open terminals"),
        ),
    )
    .child(
      h_flex()
        .id("space-hero-new-terminal")
        .h(34)
        .px(12)
        .rounded(RADII.chip)
        .bg(PALETTE.onAccentSoft)
        .border(1)
        .border_color(PALETTE.onAccentBorder)
        .items_center()
        .justify_center()
        .cursor_pointer()
        .on_click((_e, cx) => onCreateTerminal(sp.id, cx))
        .child(
          div()
            .text_size(SIZES.xs)
            .font_bold()
            .text_color(PALETTE.heroText)
            .whitespace_nowrap()
            .child("+ Terminal"),
        ),
    )
    .child(
      h_flex()
        .id("space-hero-new-space")
        .h(34)
        .px(12)
        .rounded(RADII.chip)
        .bg(PALETTE.onAccentSoft)
        .border(1)
        .border_color(PALETTE.onAccentBorder)
        .items_center()
        .justify_center()
        .cursor_pointer()
        .on_click((_e, cx) => onCreateSpace(cx))
        .child(
          div()
            .text_size(SIZES.xs)
            .font_bold()
            .text_color(PALETTE.heroText)
            .whitespace_nowrap()
            .child("+ New space"),
        ),
    )
    .when(Boolean(pickerCmd), (el) =>
      el.child(
        h_flex()
          .id("space-new-agent")
          .h(34)
          .px(12)
          .gap(7)
          .rounded(RADII.chip)
          .bg(PALETTE.onAccentSoft)
          .border(1)
          .border_color(PALETTE.onAccentBorder)
          .items_center()
          .justify_center()
          .cursor_pointer()
          .on_click(() => { if (!isDemo()) openOverlay({ mod: pickerCmd.name, kind: "dialog", props: { space: sp.id } }); })
          .child(ui.iconOf("agents", 14, PALETTE.heroText))
          .child(
            div()
              .text_size(SIZES.xs)
              .font_bold()
              .text_color(PALETTE.heroText)
              .whitespace_nowrap()
              .child("Start new agent"),
          ),
      ),
    );

  const topRow = h_flex()
    .w_full()
    .flex_wrap()
    .items_start()
    .justify_between()
    .gap(12)
    .child(
      v_flex()
        .flex_1()
        .min_w(200)
        .gap(6)
        .child(
          h_flex()
            .items_center()
            .gap(8)
            .child(
              div()
                .text_size(SIZES.xs)
                .font_bold()
                .text_color(PALETTE.heroMuted)
                .child("SELECTED SPACE"),
            )
            .child(statusPill),
        )
        .child(
          h_flex()
            .w_full()
            .flex_wrap()
            .items_center()
            .gap(10)
            .child(
              div()
                .text_size(SIZES.stat)
                .font_extrabold()
                .text_color(PALETTE.heroText)
                .child(maskPath(sp.name || "—")),
            )
            .when(Boolean(sp.branch), (el) =>
              el.child(
                h_flex()
                  .items_center()
                  .gap(6)
                  .px(9)
                  .py(4)
                  .rounded(RADII.chip)
                  .bg(PALETTE.onAccentSoft)
                  .border(1)
                  .border_color(PALETTE.onAccentBorder)
                  .child(ui.iconOf("branch", 13, PALETTE.heroText))
                  .child(
                    div()
                      .font_family(monoFont())
                      .text_size(SIZES.xs)
                      .font_semibold()
                      .text_color(PALETTE.heroText)
                      .child(maskBranch(sp.branch)),
                  ),
              ),
            ),
        )
        .child(
          h_flex()
            .w_full()
            .flex_wrap()
            .items_center()
            .gap(6)
            .child(ui.iconOf("spaces", 13, PALETTE.heroMuted))
            .child(
              div()
                .min_w(0)
                .truncate()
                .font_family(monoFont())
                .text_size(SIZES.xs)
                .text_color(PALETTE.heroMuted)
                .child(folderDisplay),
            )
            .child(
              div()
                .flex_none()
                .font_family(monoFont())
                .text_size(SIZES.xs)
                .text_color(PALETTE.heroMuted)
                .whitespace_nowrap()
                .child(`· ${maskHost(machineLabel)}`),
            ),
        ),
    )
    .child(actions);

  const hasData = activity.hasUsage && activity.hasProject;
  const totalLabel = hasData ? formatHours(activity.total14S) : "—";
  const todayLabel = hasData ? formatHours(activity.todayS) : "—";
  const avgLabel = hasData ? formatHours(activity.avgDailyS) : "—";
  const subText = hasData
    ? `Today ${todayLabel} h · avg. ${avgLabel} h/d`
    : "No usage data for this space";

  const metricCol = v_flex()
    .when(!narrow, (el) =>
      el
        .w(224)
        .flex_none()
        .pr(14)
        .border_r(1)
        .border_color(PALETTE.heroLine),
    )
    .when(narrow, (el) =>
      el
        .w_full()
        .pb(10)
        .border_b(1)
        .border_color(PALETTE.heroLine),
    )
    .justify_between()
    .gap(6)
    .child(
      div()
        .text_size(SIZES.xs)
        .font_bold()
        .text_color(PALETTE.heroMuted)
        .child("ACTIVITY IN THE LAST 14 DAYS"),
    )
    .child(
      h_flex()
        .items_baseline()
        .gap(7)
        .child(
          div()
            .text_size(40)
            .font_bold()
            .font_family(monoFont())
            .text_color(PALETTE.heroText)
            .child(totalLabel),
        )
        .when(hasData, (el) =>
          el.child(
            div()
              .text_size(SIZES.md)
              .font_semibold()
              .text_color(PALETTE.heroMuted)
              .child("h"),
          ),
        ),
    )
    .child(
      div()
        .font_family(monoFont())
        .text_size(SIZES.xs)
        .text_color(PALETTE.heroMuted)
        .whitespace_nowrap()
        .child(subText),
    );

  const CHART_H = 52;
  const stripCol = v_flex()
    .flex_1()
    .min_w(0)
    .justify_between()
    .gap(6)
    .child(
      h_flex()
        .w_full()
        .flex_wrap()
        .items_center()
        .justify_between()
        .gap(6)
        .child(
          div()
            .text_size(SIZES.sm)
            .font_bold()
            .text_color(PALETTE.heroText)
            .child("Daily activity · 14 days"),
        )
        .child(
          div()
            .px(9)
            .py(2)
            .rounded(RADII.pill)
            .bg(PALETTE.heroText)
            .font_family(monoFont())
            .text_size(SIZES.xs)
            .font_bold()
            .text_color(PALETTE.heroBg)
            .whitespace_nowrap()
            .child(`Today: ${todayLabel} h`),
        ),
    )
    .child(
      h_flex()
        .id("space-activity-bars")
        .w_full()
        .h(CHART_H)
        .pt(6)
        .items_end()
        .gap(4)
        .border_b(1)
        .border_color(PALETTE.heroLine)
        .children(
          activity.daily.map((d) => {
            const ratio = d.activeS > 0 ? Math.max(0.08, d.activeS / activity.maxDayS) : 0;
            const barH = d.activeS > 0 ? Math.max(4, Math.round(ratio * (CHART_H - 8))) : 2;
            const barColor =
              d.activeS === 0
                ? PALETTE.heroLine
                : d.isToday
                  ? PALETTE.heroText
                  : PALETTE.heroMuted;
            return div()
              .id(`space-act-day-${d.date}`)
              .flex_1()
              .h(barH)
              .rounded_t(3)
              .bg(barColor)
              .tooltip(`${formatShortDate(d.date)}: ${formatHours(d.activeS)} h`);
          }),
        ),
    )
    .child(
      h_flex()
        .w_full()
        .items_center()
        .justify_between()
        .font_family(monoFont())
        .text_size(SIZES.xs)
        .text_color(PALETTE.heroMuted)
        .child("14 d ago")
        .child("7 d ago")
        .child("Today"),
    );

  const bottomRow = narrow
    ? v_flex().w_full().pt(12).border_t(1).border_color(PALETTE.heroLine).gap(12).child(metricCol).child(stripCol.w_full())
    : h_flex().w_full().pt(12).border_t(1).border_color(PALETTE.heroLine).items_stretch().gap(16).child(metricCol).child(stripCol);

  const heroErrEl = renderCardError(palette, heroError);

  return ui.heroCard({
    id: "space-detail-hero",
    padding: 15,
    gap: 12,
    children: [topRow, ...(heroErrEl ? [heroErrEl] : []), bottomRow],
  });
}

function buildApprovalBanner({ palette, jump, maskPath, model, blockedSinceMap }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const blocked = model.agents.filter((a) => a.status === "blocked");
  if (blocked.length === 0) return null;

  return v_flex()
    .w_full()
    .gap(8)
    .children(
      blocked.map((a) => {
        const progName = a.program?.name || a.app || "Agent";
        const tabChanged = model.tabChangedAt.get(a.tab) ?? null;
        const sinceTs = blockedSinceMap?.get(a.address) ?? tabChanged;
        const sinceInfo = formatLastChange(sinceTs);
        const title = maskTitle(a.title || a.tab_name || maskPath(model.space.name || "—"));

        return h_flex()
          .id(`space-approval-${a.address}`)
          .w_full()
          .flex_wrap()
          .items_center()
          .justify_between()
          .gap(10)
          .px(14)
          .py(10)
          .rounded(RADII.inner)
          .bg(PALETTE.warnSoft)
          .border(1)
          .border_color(PALETTE.warnBorder)
          .child(
            h_flex()
              .flex_1()
              .min_w(180)
              .items_center()
              .gap(8)
              .child(div().size(8).flex_none().rounded(8).bg(PALETTE.warn))
              .child(
                div()
                  .flex_none()
                  .text_size(SIZES.xs)
                  .font_bold()
                  .text_color(PALETTE.warn)
                  .child("Pending approval:"),
              )
              .child(
                div()
                  .min_w(0)
                  .truncate()
                  .text_size(SIZES.sm)
                  .font_bold()
                  .text_color(PALETTE.text)
                  .child(title),
              )
              .child(
                div()
                  .min_w(0)
                  .truncate()
                  .font_family(monoFont())
                  .text_size(SIZES.xs)
                  .text_color(PALETTE.mono)
                  .child(`${maskProgram(progName)} · ${sinceInfo.label}`),
              ),
          )
          .child(
            h_flex()
              .id(`space-approval-review-${a.address}`)
              .flex_none()
              .h(30)
              .px(12)
              .rounded(RADII.chip)
              .bg(PALETTE.accent)
              .items_center()
              .justify_center()
              .cursor_pointer()
              .hover((s) => s.bg(PALETTE.accentHover))
              .on_click(() => jump("agent.focus", { terminal: a.address }))
              .child(
                div()
                  .text_size(SIZES.xs)
                  .font_bold()
                  .text_color(PALETTE.onAccent)
                  .whitespace_nowrap()
                  .child("Inspect"),
              ),
          );
      }),
    );
}

function buildTerminalsCard({
  ui,
  palette,
  jump,
  maskHost,
  maskPath,
  model,
  confirmingTabClose,
  onSetConfirmTabClose,
  onClearConfirmTabClose,
  onCloseTab,
  terminalsError,
}) {
  const { PALETTE, SIZES, RADII, monoFont, statusWord } = palette;
  const list = model.terminals;

  const body =
    list.length === 0
      ? cardEmpty({
          ui,
          palette,
          icon: "terminals",
          title: "No open terminals",
          description: "There are no live terminals in this space.",
        })
      : v_flex()
          .w_full()
          .gap(8)
          .children(
            list.map((t) => {
              const dotColor =
                t.status === "blocked"
                  ? PALETTE.warn
                  : t.status === "idle" || t.status === "done"
                    ? PALETTE.offline
                    : PALETTE.ok;
              const subText = t.cmd ? maskText(t.cmd) : t.cwd ? maskPath(t.cwd) : maskProgram(t.progName);
              const addrDisplay = maskAddress(t.address, maskHost);
              const machDisplay = maskHost(t.machineName);
              const isConfirming =
                confirmingTabClose &&
                confirmingTabClose.address === t.address &&
                confirmingTabClose.tabId === t.tabId;

              const stateChip = t.status
                ? ui.chip({
                    label: statusWord(t.status),
                    dotStatus: t.status,
                    ...spaceChipStyle(PALETTE, t.status),
                    h: 22,
                    px: 8,
                  })
                : ui.chip({
                    label: t.stateLabel || "Live",
                    dotColor: PALETTE.ok,
                    color: PALETTE.ok,
                    bg: PALETTE.okSoft,
                    borderColor: PALETTE.okBorder,
                    h: 22,
                    px: 8,
                  });

              return v_flex()
                .id(`space-term-${t.address}`)
                .w_full()
                .px(11)
                .py(9)
                .gap(5)
                .rounded(RADII.inner)
                .bg(PALETTE.rowBg)
                .border(1)
                .border_color(t.focused ? PALETTE.lineStrong : PALETTE.line)
                .cursor_pointer()
                .hover((s) => s.bg(PALETTE.rowHover).border_color(PALETTE.lineStrong))
                .on_click(() => jump("terminal.show", { terminal: t.address }))
                .child(
                  h_flex()
                    .w_full()
                    .items_center()
                    .justify_between()
                    .gap(8)
                    .child(
                      h_flex()
                        .flex_1()
                        .min_w(0)
                        .items_center()
                        .gap(7)
                        .child(div().size(7).flex_none().rounded(7).bg(dotColor))
                        .child(
                          div()
                            .flex_none()
                            .font_family(monoFont())
                            .text_size(SIZES.xs)
                            .font_bold()
                            .text_color(PALETTE.mono)
                            .child(addrDisplay),
                        )
                        .child(
                          div()
                            .flex_1()
                            .min_w(0)
                            .truncate()
                            .text_size(SIZES.xs)
                            .font_bold()
                            .text_color(PALETTE.text)
                            .child(maskTitle(t.title)),
                        ),
                    )
                    .child(
                      div()
                        .flex_none()
                        .font_family(monoFont())
                        .text_size(SIZES.xs)
                        .text_color(PALETTE.muted)
                        .whitespace_nowrap()
                        .child(machDisplay),
                    ),
                )
                .child(
                  h_flex()
                    .w_full()
                    .items_center()
                    .justify_between()
                    .gap(8)
                    .pl(14)
                    .child(
                      div()
                        .flex_1()
                        .min_w(0)
                        .truncate()
                        .font_family(monoFont())
                        .text_size(SIZES.xs)
                        .text_color(PALETTE.muted)
                        .child(subText),
                    )
                    .child(
                      h_flex()
                        .flex_none()
                        .items_center()
                        .gap(6)
                        .child(stateChip)
                        .when(Boolean(t.tabId) && !isConfirming, (el) =>
                          el.child(
                            h_flex()
                              .id(`space-term-close-${t.address}`)
                              .h(22)
                              .px(8)
                              .rounded(RADII.chip)
                              .bg(PALETTE.dangerSoft)
                              .border(1)
                              .border_color(PALETTE.dangerBorder)
                              .items_center()
                              .justify_center()
                              .cursor_pointer()
                              .text_size(SIZES.xs)
                              .font_semibold()
                              .text_color(PALETTE.danger)
                              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                              .on_click((_e, cx) => {
                                cx.stop_propagation();
                                onSetConfirmTabClose({ tabId: t.tabId, address: t.address }, cx);
                              })
                              .child("close"),
                          ),
                        ),
                    ),
                )
                .when(isConfirming, (el) =>
                  el.child(
                    renderInlineConfirm({
                      palette,
                      idPrefix: `space-term-confirm-${t.address}`,
                      text: "Are you sure?",
                      confirmDanger: true,
                      compact: false,
                      onConfirm: (_e, cx) => onCloseTab(t.tabId, cx),
                      onCancel: (_e, cx) => onClearConfirmTabClose(cx),
                    }),
                  ),
                );
            }),
          );

  const errEl = renderCardError(palette, terminalsError);

  return ui.card({
    id: "space-terminals-card",
    padding: 14,
    gap: 10,
    children: [
      cardHead({
        ui,
        palette,
        icon: "terminals",
        title: "Open Terminals",
        chipLabel: `${list.length} open`,
      }),
      ...(errEl ? [errEl] : []),
      body,
    ],
  });
}

function buildAgentsCard({ ui, palette, jump, maskHost, model, localHostname }) {
  const { PALETTE, SIZES, RADII, monoFont, statusWord } = palette;
  const list = model.agents;
  const workingCount = list.filter((a) => a.status === "working").length;
  const blockedCount = list.filter((a) => a.status === "blocked").length;

  const headerChip =
    blockedCount > 0
      ? `${blockedCount} awaiting approval`
      : workingCount > 0
        ? `${workingCount} working`
        : countLabel(list.length, "agent");
  const chipTone = blockedCount > 0 ? "warn" : workingCount > 0 ? "ok" : "normal";

  const progTotals = new Map();
  for (const a of list) {
    const pname = a.program?.name || a.app || "Agent";
    progTotals.set(pname, (progTotals.get(pname) ?? 0) + 1);
  }
  const progSeen = new Map();

  const body =
    list.length === 0
      ? cardEmpty({
          ui,
          palette,
          icon: "agents",
          title: "No agents in this space",
          description: "This space has no agents working or waiting.",
        })
      : v_flex()
          .w_full()
          .gap(8)
          .children(
            list.map((a) => {
              const pname = a.program?.name || a.app || "Agent";
              const idx = (progSeen.get(pname) ?? 0) + 1;
              progSeen.set(pname, idx);
              const displayName = (progTotals.get(pname) ?? 0) > 1 ? `${pname} #${idx}` : pname;

              const isWorking = a.status === "working";
              const isBlocked = a.status === "blocked";
              const boxBg = isBlocked
                ? PALETTE.warnSoft
                : isWorking
                  ? PALETTE.okSoft
                  : PALETTE.rowBg;
              const boxBorder = isBlocked
                ? PALETTE.warnBorder
                : isWorking
                  ? PALETTE.okBorder
                  : PALETTE.line;
              const chipStyle = spaceChipStyle(PALETTE, a.status);

              const machName = maskHost(
                machineFromAddress(a.address) ?? (localHostname || "This computer"),
              );
              const sinceMs = model.tabWorkingSince.get(a.tab) ?? null;
              const durLabel =
                (isWorking || isBlocked) && typeof sinceMs === "number" && sinceMs > 0
                  ? formatDurationMs(dashboardNow().getTime() - sinceMs)
                  : "—";

              const pic = ui.programIcon(a.program, 15, PALETTE.text);

              return v_flex()
                .id(`space-agent-${a.address}`)
                .w_full()
                .px(12)
                .py(10)
                .gap(7)
                .rounded(RADII.inner)
                .bg(boxBg)
                .border(1)
                .border_color(boxBorder)
                .cursor_pointer()
                .hover((s) => s.border_color(PALETTE.lineStrong))
                .on_click(() => jump("agent.focus", { terminal: a.address }))
                .child(
                  h_flex()
                    .w_full()
                    .items_center()
                    .justify_between()
                    .gap(8)
                    .child(
                      h_flex()
                        .flex_1()
                        .min_w(0)
                        .items_center()
                        .gap(7)
                        .when(Boolean(pic), (el) => el.child(pic))
                        .child(
                          div()
                            .truncate()
                            .text_size(SIZES.sm)
                            .font_bold()
                            .text_color(PALETTE.text)
                            .child(maskProgram(displayName)),
                        )
                        .child(
                          div()
                            .flex_none()
                            .font_family(monoFont())
                            .text_size(SIZES.xs)
                            .text_color(PALETTE.muted)
                            .whitespace_nowrap()
                            .child(machName),
                        ),
                    )
                    .child(
                      ui.chip({
                        label: statusWord(a.status),
                        dotStatus: a.status,
                        color: chipStyle.color,
                        bg: chipStyle.bg,
                        borderColor: chipStyle.borderColor,
                        h: 22,
                        px: 8,
                      }),
                    ),
                )
                .when(Boolean(a.title && a.title !== pname), (el) =>
                  el.child(
                    div()
                      .w_full()
                      .truncate()
                      .text_size(SIZES.xs)
                      .text_color(PALETTE.text)
                      .child(maskTitle(a.title)),
                  ),
                )
                .child(
                  h_flex()
                    .w_full()
                    .items_center()
                    .justify_between()
                    .gap(8)
                    .font_family(monoFont())
                    .text_size(SIZES.xs)
                    .text_color(PALETTE.mono)
                    .child(`Duration: ${durLabel}`)
                    .child(
                      div()
                        .text_color(PALETTE.muted)
                        .child(maskAddress(a.address, maskHost)),
                    ),
                );
            }),
          );

  return ui.card({
    id: "space-agents-card",
    padding: 14,
    gap: 10,
    children: [
      cardHead({
        ui,
        palette,
        icon: "agents",
        title: "Agents in This Space",
        chipLabel: headerChip,
        chipTone,
      }),
      body,
    ],
  });
}

function buildPortsCard({ ui, palette, maskHost, model }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const { known, ports } = model.portsInfo;
  const publicCount = ports.filter((p) => p.access === "public").length;

  const headerChip = !known
    ? "—"
    : publicCount > 0
      ? `${publicCount} public`
      : `${ports.length} port`;

  let body;
  if (!known) {
    body = cardEmpty({
      ui,
      palette,
      icon: "ports",
      title: "No port data",
      description: "No listening port data from this machine yet.",
    });
  } else if (ports.length === 0) {
    body = cardEmpty({
      ui,
      palette,
      icon: "ports",
      title: "No open ports",
      description: "No processes in this space's folder are listening on ports.",
    });
  } else {
    body = v_flex()
      .w_full()
      .gap(8)
      .children(
        ports.map((p) => {
          const isPublic = p.access === "public";
          const isTailnet = p.access === "tailnet";
          const chipLabel = p.access;
          const chipColor = isPublic
            ? PALETTE.danger
            : isTailnet
              ? PALETTE.mono
              : PALETTE.muted;
          const chipBg = isPublic
            ? PALETTE.dangerSoft
            : isTailnet
              ? PALETTE.raised
              : PALETTE.rowBg;
          const chipBorder = isPublic
            ? PALETTE.dangerBorder
            : isTailnet
              ? PALETTE.lineStrong
              : PALETTE.line;

          const metaParts = [maskHost(p.machineName)];
          if (p.funnelPort !== null) metaParts.push(`Funnel :${p.funnelPort}`);
          else if (p.servePort !== null) metaParts.push(`Serve :${p.servePort}`);

          return ui.miniRow({
            id: `space-port-${p.id}`,
            danger: isPublic,
            px: 10,
            py: 8,
            gap: 10,
            children: [
              isPublic
                ? ui.iconOf("alert", 15, PALETTE.danger)
                : div()
                    .size(7)
                    .flex_none()
                    .rounded(7)
                    .bg(isTailnet ? PALETTE.ok : PALETTE.offline),
              v_flex()
                .flex_1()
                .min_w(0)
                .gap(2)
                .child(
                  h_flex()
                    .items_center()
                    .gap(7)
                    .child(
                      div()
                        .font_family(monoFont())
                        .text_size(SIZES.md)
                        .font_bold()
                        .text_color(isPublic ? PALETTE.danger : PALETTE.text)
                        .child(`:${p.port}`),
                    )
                    .child(
                      div()
                        .min_w(0)
                        .truncate()
                        .text_size(SIZES.sm)
                        .font_semibold()
                        .text_color(PALETTE.text)
                        .child(maskText(p.process)),
                    ),
                )
                .child(
                  div()
                    .truncate()
                    .font_family(monoFont())
                    .text_size(SIZES.xs)
                    .text_color(PALETTE.mono)
                    .child(metaParts.join(" · ")),
                ),
              ui.chip({
                label: chipLabel,
                color: chipColor,
                bg: chipBg,
                borderColor: chipBorder,
                h: 22,
                px: 8,
              }),
            ],
          });
        }),
      );
  }

  return ui.card({
    id: "space-ports-card",
    padding: 14,
    gap: 10,
    children: [
      cardHead({
        ui,
        palette,
        icon: "ports",
        iconTone: publicCount > 0 ? "danger" : "normal",
        title: "Ports in Use",
        chipLabel: headerChip,
        chipTone: publicCount > 0 ? "danger" : "normal",
      }),
      body,
    ],
  });
}

function buildCommitsCard({ ui, palette, space, commitState, onRefreshCommits }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const commits = commitState?.commits ?? [];
  const isLoading = Boolean(commitState?.loading) && commits.length === 0;
  const errorKind = commitState?.errorKind ?? null;

  let body;
  if (!space.folder) {
    body = cardEmpty({
      ui,
      palette,
      icon: "branch",
      title: "No folder information",
      description: "No folder path was reported for this space.",
    });
  } else if (isLoading) {
    body = cardEmpty({
      ui,
      palette,
      icon: "branch",
      title: "Loading commit history",
      description: "Reading the last 4 commits from Git.",
    });
  } else if (errorKind === "not-git") {
    body = cardEmpty({
      ui,
      palette,
      icon: "branch",
      title: "No Git repository",
      description: "No Git repository was found in this folder.",
    });
  } else if (errorKind === "failed") {
    body = cardEmpty({
      ui,
      palette,
      icon: "branch",
      title: "Could not read commits",
      description: maskError(commitState?.error) || "Machine unreachable or could not run Git.",
    });
  } else if (commits.length === 0) {
    body = cardEmpty({
      ui,
      palette,
      icon: "branch",
      title: "No commits found",
      description: "This branch has no commits yet.",
    });
  } else {
    body = v_flex()
      .w_full()
      .gap(6)
      .children(
        commits.map((c, idx) =>
          h_flex()
            .id(`space-commit-${idx}-${c.hash}`)
            .w_full()
            .items_center()
            .gap(8)
            .px(10)
            .py(7)
            .rounded(RADII.chip)
            .bg(PALETTE.rowBg)
            .border(1)
            .border_color(PALETTE.line)
            .child(
              div()
                .w(64)
                .flex_none()
                .px(5)
                .py(2)
                .rounded(5)
                .bg(PALETTE.accentSoft)
                .border(1)
                .border_color(PALETTE.lineStrong)
                .font_family(monoFont())
                .text_size(SIZES.xs)
                .font_bold()
                .text_color(PALETTE.mono)
                .text_center()
                .child(maskText(c.hash)),
            )
            .child(
              div()
                .flex_1()
                .min_w(0)
                .truncate()
                .text_size(SIZES.xs)
                .font_semibold()
                .text_color(PALETTE.text)
                .child(maskText(c.subject)),
            )
            .child(
              div()
                .flex_none()
                .font_family(monoFont())
                .text_size(SIZES.xs)
                .text_color(PALETTE.muted)
                .whitespace_nowrap()
                .child(maskText(formatGitRelTime(c.relTime))),
            ),
        ),
      );
  }

  const refreshBtn = div()
    .id("space-commits-refresh")
    .px(7)
    .py(3)
    .rounded(RADII.chip)
    .bg(PALETTE.rowBg)
    .border(1)
    .border_color(PALETTE.line)
    .text_size(SIZES.xs)
    .font_semibold()
    .text_color(PALETTE.muted)
    .cursor_pointer()
    .hover((s) => s.text_color(PALETTE.text).bg(PALETTE.raised))
    .on_click((_e, cx) => onRefreshCommits(space, cx))
    .child("Refresh");

  return ui.card({
    id: "space-commits-card",
    padding: 14,
    gap: 10,
    children: [
      cardHead({
        ui,
        palette,
        icon: "branch",
        title: "Last 4 Commits",
        chipLabel: maskBranch(space.branch || "—"),
        rightExtra: space.folder ? refreshBtn : null,
      }),
      body,
    ],
  });
}

export function renderSpaces({
  ui,
  data,
  palette,
  jump,
  maskHost,
  maskPath,
  collectEntries = [],
  localEntry = null,
  spacesList = [],
  agentsList = [],
  terminalsList = [],
  panesList = [],
  selectedSpace = null,
  onSelectSpace = () => {},
  spaceCommits = null,
  onRefreshCommits = () => {},
  blockedSinceMap = null,
  confirmingTabClose = null,
  onSetConfirmTabClose = () => {},
  onClearConfirmTabClose = () => {},
  onCreateSpace = () => {},
  onCreateTerminal = () => {},
  onCloseTab = () => {},
  spacesError = null,
  narrow = false,
}) {
  const localHostname = localEntry?.result?.system?.hostname || null;

  const spaceModels = (spacesList ?? []).map((sp) => {
    const spaceAgents = (agentsList ?? []).filter((a) => a && a.space === sp.id);
    const spaceTerminals = collectSpaceTerminals({
      space: sp,
      panesList,
      terminalsList,
      localHostname,
    });
    const tabChangedAt = new Map();
    const tabWorkingSince = new Map();
    let lastChangedAt = null;

    for (const tab of sp.tabs ?? []) {
      if (tab?.id && typeof tab.changed_at === "number") {
        tabChangedAt.set(tab.id, tab.changed_at);
        if (lastChangedAt === null || tab.changed_at > lastChangedAt) {
          lastChangedAt = tab.changed_at;
        }
      }
      if (tab?.id && typeof tab.working_since === "number") {
        tabWorkingSince.set(tab.id, tab.working_since);
      }
    }

    return {
      space: sp,
      status: data.deriveSpaceStatus(sp, spaceAgents),
      agents: spaceAgents,
      terminals: spaceTerminals,
      tabChangedAt,
      tabWorkingSince,
      lastChangedAt,
      portsInfo: collectSpacePorts({ space: sp, collectEntries, localHostname }),
      activity: computeSpaceActivity({ space: sp, collectEntries }),
    };
  });

  const activeSpace =
    spaceModels.find((m) => m.space.active)?.space ?? spaceModels[0]?.space ?? null;

  const selectedModel =
    spaceModels.find((m) => m.space.id === selectedSpace) ??
    spaceModels.find((m) => m.space.active) ??
    spaceModels[0] ??
    null;

  const listPanel = buildSpaceListPanel({
    ui,
    palette,
    maskHost,
    maskPath,
    spaceModels,
    selectedId: selectedModel?.space?.id ?? null,
    activeSpaceId: activeSpace?.id ?? null,
    onSelectSpace,
    onCreateSpace,
    onCreateTerminal,
    listError: spacesError?.scope === "list" ? spacesError.message : null,
    narrow,
  });

  if (!selectedModel) {
    const emptyDetail = ui.emptyState({
      icon: "spaces",
      title: "No space selected",
      description: "Details for spaces you open in Herdr appear here.",
    });
    return narrow
      ? v_flex().w_full().gap(14).child(listPanel).child(emptyDetail)
      : h_flex().w_full().items_start().gap(14).child(listPanel).child(emptyDetail.flex_1().min_w(0));
  }

  const sp = selectedModel.space;
  const commitKey = `${sp.id}|${sp.machine ?? "local"}|${sp.folder ?? ""}`;
  const commitState = spaceCommits?.get(commitKey) ?? null;

  const hero = buildHeroSection({
    ui,
    palette,
    jump,
    maskHost,
    maskPath,
    model: selectedModel,
    localHostname,
    onCreateSpace,
    onCreateTerminal,
    heroError: spacesError?.scope === "hero" ? spacesError.message : null,
    narrow,
  });

  const approvalBanner = buildApprovalBanner({
    palette,
    jump,
    maskPath,
    model: selectedModel,
    blockedSinceMap,
  });

  const terminalsCard = buildTerminalsCard({
    ui,
    palette,
    jump,
    maskHost,
    maskPath,
    model: selectedModel,
    confirmingTabClose,
    onSetConfirmTabClose,
    onClearConfirmTabClose,
    onCloseTab,
    terminalsError: spacesError?.scope === "terminals" ? spacesError.message : null,
  });

  const agentsCard = buildAgentsCard({
    ui,
    palette,
    jump,
    maskHost,
    model: selectedModel,
    localHostname,
  });

  const portsCard = buildPortsCard({
    ui,
    palette,
    maskHost,
    model: selectedModel,
  });

  const commitsCard = buildCommitsCard({
    ui,
    palette,
    space: sp,
    commitState,
    onRefreshCommits,
  });

  const bentoRow1 = narrow
    ? v_flex().w_full().gap(12).child(terminalsCard.w_full()).child(agentsCard.w_full())
    : h_flex()
        .w_full()
        .items_stretch()
        .gap(12)
        .child(terminalsCard.flex_1().min_w(0))
        .child(agentsCard.flex_1().min_w(0));

  const bentoRow2 = narrow
    ? v_flex().w_full().gap(12).child(portsCard.w_full()).child(commitsCard.w_full())
    : h_flex()
        .w_full()
        .items_stretch()
        .gap(12)
        .child(portsCard.flex_1().min_w(0))
        .child(commitsCard.flex_1().min_w(0));

  const detailCol = v_flex()
    .id("space-detail-panel")
    .flex_1()
    .min_w(0)
    .gap(12)
    .child(hero)
    .when(Boolean(approvalBanner), (el) => el.child(approvalBanner))
    .child(bentoRow1)
    .child(bentoRow2);

  return narrow
    ? v_flex().w_full().gap(14).child(listPanel).child(detailCol.w_full())
    : h_flex().w_full().items_start().gap(14).child(listPanel).child(detailCol);
}
