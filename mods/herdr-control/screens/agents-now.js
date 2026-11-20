// Screen 5, Sub-tab 1: Agents · Now (Live agents, quotas, unused CLIs, 14-day heatmap).

import { dashboardNow } from "../demo-mode.js";
import { maskProgram, maskTitle } from "../mask.js";
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { setDashboardAgentOrder } from "../source.js";
import { buildUsageRows, countLabel, rowTokens } from "../data.js";

const BACKSLASH = String.fromCharCode(92);

function lastPathSegment(p) {
  if (!p || typeof p !== "string") return "";
  const parts = p
    .split("/")
    .flatMap((seg) => seg.split(BACKSLASH))
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

function buildHeroSection({
  ui,
  palette,
  jump,
  maskHost,
  maskPath,
  agentsList,
  spacesList,
  machinesList,
  collectEntries,
  bgLiveList,
  helpers,
  narrow,
}) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const list = agentsList ?? [];
  const todayStr = helpers.localIsoDate();
  const nowMs = dashboardNow().getTime();

  let hasUsage = false;
  let todayActiveS = 0;
  for (const entry of collectEntries) {
    const days = entry?.result?.usage?.days;
    if (Array.isArray(days)) {
      hasUsage = true;
      for (const d of days) {
        if (d && d.date === todayStr && d.provider !== "antigravity") {
          todayActiveS += Number(d.active_s) || 0;
        }
      }
    }
  }

  const tabById = new Map();
  for (const sp of spacesList ?? []) {
    for (const tab of sp?.tabs ?? []) {
      if (tab?.id) tabById.set(tab.id, tab);
    }
  }

  let workingCount = 0;
  let blockedCount = 0;
  let doneCount = 0;
  let idleCount = 0;
  const progCounts = new Map();
  const machineKeys = new Set();

  for (const a of list) {
    if (!a) continue;
    if (a.status === "working") workingCount += 1;
    else if (a.status === "blocked") blockedCount += 1;
    else if (a.status === "done") doneCount += 1;
    else idleCount += 1;
    const pname = a.program?.name || a.app || "Agent";
    progCounts.set(pname, (progCounts.get(pname) ?? 0) + 1);
    machineKeys.add(helpers.machineFromAddress(a.address) ?? "__local__");
  }

  const bgEntries = [];
  for (const { entryMachine, item } of bgLiveList ?? []) {
    if (!item || !item.provider) continue;
    workingCount += 1;
    const def = helpers.PROVIDER_DEFS.find((d) => d.id === item.provider);
    const pname = def ? def.label : item.provider;
    progCounts.set(pname, (progCounts.get(pname) ?? 0) + 1);
    machineKeys.add(entryMachine ?? "__local__");
    bgEntries.push({ entryMachine, item, pname });
  }

  const activeMachinesCount =
    machineKeys.size > 0
      ? machineKeys.size
      : (machinesList ?? []).filter((m) => m && m.layout === "ready").length;

  const progSeen = new Map();
  const herdrRows = list.map((a) => {
    const baseName = a.program?.name || a.app || "Agent";
    const totalOfProg = progCounts.get(baseName) ?? 1;
    const idx = (progSeen.get(baseName) ?? 0) + 1;
    progSeen.set(baseName, idx);
    const displayName = totalOfProg > 1 ? `${baseName} #${idx}` : baseName;

    const rawMachine = helpers.machineFromAddress(a.address);
    const machineLabel = maskHost(helpers.resolveMachineName(rawMachine, collectEntries));
    const machineObj = (machinesList ?? []).find((m) => (m?.name ?? null) === rawMachine);
    const machineOnline = machineObj ? machineObj.layout === "ready" : true;

    const tab = tabById.get(a.tab);
    const sinceMs = tab?.working_since ?? null;
    const durationLabel =
      (a.status === "working" || a.status === "blocked") && typeof sinceMs === "number" && sinceMs > 0
        ? helpers.formatDurationMs(nowMs - sinceMs)
        : "—";

    const modelLabel = helpers.extractModelFromTitle(maskTitle(a.title));

    return {
      isBackground: false,
      rowId: `now-agent-${a.address}`,
      address: a.address,
      program: a.program,
      displayName,
      badgeLabel: modelLabel,
      badgeMuted: modelLabel === "—",
      spaceLabel: maskPath(a.space_name || "—"),
      machineLabel,
      machineOnline,
      status: a.status,
      statusLabel: null,
      durationLabel,
      contextLabel: "—",
    };
  });

  const bgRows = bgEntries.map(({ entryMachine, item, pname }, i) => {
    const totalOfProg = progCounts.get(pname) ?? 1;
    const idx = (progSeen.get(pname) ?? 0) + 1;
    progSeen.set(pname, idx);
    const displayName = totalOfProg > 1 ? `${pname} #${idx}` : pname;

    const machineLabel = maskHost(helpers.resolveMachineName(entryMachine, collectEntries));
    const machineObj = (machinesList ?? []).find((m) => (m?.name ?? null) === entryMachine);
    const machineOnline = machineObj ? machineObj.layout === "ready" : true;

    const sinceMs = typeof item.since === "number" ? item.since : Date.parse(item.since || "");
    const durationLabel =
      Number.isFinite(sinceMs) && sinceMs > 0
        ? helpers.formatDurationMs(Math.max(0, nowMs - sinceMs))
        : "—";

    const folderSeg = lastPathSegment(item.folder);

    return {
      isBackground: true,
      rowId: `now-bg-${item.provider}-${i}`,
      address: null,
      program: null,
      displayName,
      badgeLabel: "outside Herdr · background",
      badgeMuted: false,
      spaceLabel: folderSeg ? maskPath(folderSeg) : "background",
      machineLabel,
      machineOnline,
      status: "working",
      statusLabel: "Working in background",
      durationLabel,
      contextLabel: "—",
    };
  });

  const rows = [...herdrRows, ...bgRows];

  if (herdrRows.length > 0) {
    try {
      setDashboardAgentOrder(herdrRows.map((r) => r.address));
    } catch {}
  }

  const pulseDot = div()
    .size(8)
    .flex_none()
    .rounded(8)
    .bg(workingCount > 0 ? PALETTE.heroGreen : PALETTE.heroMuted)
    .when(workingCount > 0, (el) => el.loop("opacity", { from: 0.4, to: 1, period: 1400 }));

  const summaryBlock = v_flex()
    .when(!narrow, (el) =>
      el
        .w(224)
        .flex_none()
        .justify_between()
        .pr(16)
        .gap(12)
        .border_r(1)
        .border_color(PALETTE.heroLine),
    )
    .when(narrow, (el) =>
      el
        .w_full()
        .pb(12)
        .gap(10)
        .border_b(1)
        .border_color(PALETTE.heroLine),
    )
    .child(
      h_flex()
        .items_center()
        .gap(8)
        .child(pulseDot)
        .child(
          div()
            .text_size(SIZES.xs)
            .font_bold()
            .text_color(PALETTE.heroMuted)
            .child("RUNNING NOW"),
        ),
    )
    .child(
      v_flex()
        .gap(12)
        .child(
          h_flex()
            .items_baseline()
            .gap(10)
            .child(
              div()
                .text_size(SIZES.hero)
                .font_bold()
                .font_family(monoFont())
                .text_color(PALETTE.heroText)
                .child(String(rows.length)),
            )
            .child(
              div()
                .text_size(SIZES.lg)
                .font_bold()
                .text_color(PALETTE.heroMuted)
                .child("sessions"),
            ),
        )
        .child(
          v_flex()
            .gap(6)
            .text_size(SIZES.sm)
            .font_semibold()
            .text_color(PALETTE.heroText)
            .child(
              h_flex()
                .items_center()
                .gap(8)
                .child(div().size(8).rounded(8).bg(PALETTE.heroGreen))
                .child(`${workingCount} working`),
            )
            .child(
              h_flex()
                .items_center()
                .gap(8)
                .child(div().size(8).rounded(8).bg(PALETTE.heroWarn))
                .child(`${blockedCount} awaiting approval`),
            )
            .child(
              h_flex()
                .items_center()
                .gap(8)
                .child(div().size(8).rounded(8).bg(PALETTE.offline))
                .child(`${doneCount} done`),
            )
            .when(idleCount > 0, (el) =>
              el.child(
                h_flex()
                  .items_center()
                  .gap(8)
                  .child(div().size(8).rounded(8).border(1.5).border_color(PALETTE.offline))
                  .child(`${idleCount} idle`),
              ),
            ),
        ),
    )
    .child(
      div()
        .pt(8)
        .border_t(1)
        .border_color(PALETTE.heroLine)
        .text_size(SIZES.xs)
        .font_family(monoFont())
        .font_semibold()
        .text_color(PALETTE.heroMuted)
        .child(
          `Today ${hasUsage ? `${helpers.formatHours(todayActiveS)} h` : "—"} · ${countLabel(activeMachinesCount, "machine")}`,
        ),
    );

  const tableHeader = h_flex()
    .w_full()
    .px(10)
    .pb(6)
    .gap(8)
    .border_b(1)
    .border_color(PALETTE.lineStrong)
    .text_size(SIZES.xs)
    .font_bold()
    .text_color(PALETTE.muted)
    .child(div().flex_1().min_w(180).child("Agent"))
    .child(div().w(narrow ? 96 : 150).flex_none().child("Space"))
    .child(div().w(narrow ? 96 : 132).flex_none().child("Machine"))
    .child(div().w(narrow ? 124 : 156).flex_none().child("Status"))
    .child(div().w(72).flex_none().text_right().child("Duration"))
    .when(!narrow, (el) => el.child(div().w(64).flex_none().text_right().child("Context")));

  const tableRows = rows.map((r) => {
    const isBlocked = r.status === "blocked";
    const isDone = r.status === "done";
    const pic = ui.programIcon(r.program, 14, PALETTE.text);

    return h_flex()
      .id(r.rowId)
      .w_full()
      .px(10)
      .py(7)
      .gap(8)
      .items_center()
      .rounded(RADII.chip)
      .bg(isBlocked ? PALETTE.warnSoft : isDone ? PALETTE.surfaceDark : PALETTE.rowBg)
      .border(1)
      .border_color(isBlocked ? PALETTE.warnBorder : PALETTE.line)
      .when(!r.isBackground && Boolean(r.address), (el) =>
        el
          .cursor_pointer()
          .hover((s) =>
            s
              .bg(isBlocked ? PALETTE.warnHover : PALETTE.rowHover)
              .border_color(isBlocked ? PALETTE.warn : PALETTE.lineStrong),
          )
          .on_click(() => jump("agent.focus", { terminal: r.address })),
      )
      .child(
        h_flex()
          .flex_1()
          .min_w(180)
          .flex_wrap()
          .items_center()
          .gap(7)
          .when(Boolean(pic), (el) => el.child(pic))
          .when(r.isBackground, (el) => el.child(ui.iconOf("agents", 14, PALETTE.ok)))
          .child(
            div()
              .flex_none()
              .whitespace_nowrap()
              .text_size(SIZES.sm)
              .font_bold()
              .text_color(PALETTE.text)
              .child(maskProgram(r.displayName)),
          )
          .child(
            div()
              .flex_none()
              .px(6)
              .py(1)
              .rounded(5)
              .bg(PALETTE.rowBg)
              .border(1)
              .border_color(PALETTE.line)
              .text_size(SIZES.xs)
              .font_family(monoFont())
              .text_color(r.badgeMuted ? PALETTE.muted : PALETTE.mono)
              .child(r.badgeLabel),
          ),
      )
      .child(
        h_flex()
          .w(narrow ? 96 : 150)
          .flex_none()
          .child(
            div()
              .max_w(narrow ? 94 : 148)
              .px(7)
              .py(2)
              .rounded(6)
              .bg(PALETTE.rowBg)
              .border(1)
              .border_color(PALETTE.line)
              .truncate()
              .text_size(SIZES.xs)
              .font_family(monoFont())
              .font_semibold()
              .text_color(PALETTE.text)
              .child(r.spaceLabel),
          ),
      )
      .child(
        h_flex()
          .w(narrow ? 96 : 132)
          .flex_none()
          .items_center()
          .gap(6)
          .child(
            div()
              .size(7)
              .flex_none()
              .rounded(7)
              .bg(r.machineOnline ? PALETTE.ok : PALETTE.offline),
          )
          .child(
            div()
              .min_w(0)
              .truncate()
              .text_size(SIZES.xs)
              .font_family(monoFont())
              .font_semibold()
              .text_color(PALETTE.mono)
              .child(r.machineLabel),
          ),
      )
      .child(
        h_flex()
          .w(narrow ? 124 : 156)
          .flex_none()
          .child(
            h_flex()
              .px(7)
              .py(2)
              .rounded(RADII.pill)
              .bg(isBlocked ? PALETTE.warnSoft : r.status === "working" ? PALETTE.okSoft : PALETTE.offlineSoft)
              .border(1)
              .border_color(
                isBlocked ? PALETTE.warnBorder : r.status === "working" ? PALETTE.okBorder : PALETTE.offlineBorder,
              )
              .child(
                r.statusLabel
                  ? h_flex()
                      .flex_none()
                      .items_center()
                      .gap(6)
                      .text_size(SIZES.xs)
                      .font_semibold()
                      .text_color(PALETTE.ok)
                      .child(ui.statusDot("working", 7))
                      .child(div().whitespace_nowrap().child(r.statusLabel))
                  : ui.statusWithWord(r.status),
              ),
          ),
      )
      .child(
        div()
          .w(72)
          .flex_none()
          .text_right()
          .text_size(SIZES.xs)
          .font_family(monoFont())
          .font_semibold()
          .text_color(PALETTE.mono)
          .whitespace_nowrap()
          .child(r.durationLabel),
      )
      .when(!narrow, (el) =>
        el.child(
          div()
            .w(64)
            .flex_none()
            .text_right()
            .text_size(SIZES.xs)
            .font_family(monoFont())
            .text_color(PALETTE.muted)
            .child(r.contextLabel),
        ),
      );
  });

  const sessionsPanel = v_flex()
    .flex_1()
    .min_w(0)
    .p(12)
    .gap(6)
    .rounded(RADII.inner)
    .bg(PALETTE.surface)
    .border(1)
    .border_color(PALETTE.heroLine)
    .child(
      rows.length === 0
        ? v_flex()
            .w_full()
            .flex_1()
            .items_center()
            .justify_center()
            .gap(6)
            .py(28)
            .child(ui.iconOf("agents", 20, PALETTE.muted))
            .child(
              div()
                .text_size(SIZES.md)
                .font_bold()
                .text_color(PALETTE.text)
                .text_center()
                .child("No agents running"),
            )
            .child(
              div()
                .max_w(420)
                .text_size(SIZES.xs)
                .text_color(PALETTE.muted)
                .text_center()
                .child("Claude, OpenCode, Codex, and Antigravity appear here when started in a terminal."),
            )
        : v_flex()
            .w_full()
            .gap(4)
            .child(tableHeader)
            .children(tableRows),
    );

  return ui.heroCard({
    id: "agents-now-hero",
    padding: 18,
    gap: 14,
    children: [
      narrow
        ? v_flex().w_full().gap(12).child(summaryBlock).child(sessionsPanel)
        : h_flex().w_full().items_stretch().gap(18).child(summaryBlock).child(sessionsPanel),
    ],
  });
}

function buildQuotasCard({ ui, palette, collectEntries, narrow }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const rows = buildUsageRows(collectEntries, dashboardNow()).filter((row) => row.five !== null || row.week !== null);
  const container = narrow
    ? v_flex().w_full().gap(10)
    : h_flex().w_full().items_stretch().gap(10);

  const boxes = rows.map((row) =>
    v_flex()
      .id(`quota-${row.id}`)
      .flex_1()
      .min_w(0)
      .p(12)
      .gap(7)
      .rounded(RADII.inner)
      .bg(PALETTE.rowBg)
      .border(1)
      .border_color(PALETTE.line)
      .child(div().text_size(SIZES.sm).font_bold().text_color(PALETTE.text).child(row.label))
      .children([["5h", row.five], ["week", row.week]].map(([label, value]) =>
        value === null
          ? div().text_size(SIZES.xs).font_family(monoFont()).text_color(PALETTE.muted).child(`${label} · —`)
          : ui.progressBar({
              label,
              valueLabel: `${value}%`,
              ratio: value / 100,
              height: 7,
              color: value < 15 ? PALETTE.danger : value < 30 ? PALETTE.warn : PALETTE.ok,
            }),
      ))
      .when(row.countdown !== "—", (el) => el.child(
        div().text_size(SIZES.xs).text_color(PALETTE.muted).child(`5h window resets in ${row.countdown}`),
      )),
  );

  return ui.card({
    id: "agents-quotas",
    padding: 16,
    gap: 12,
    children: [
      ui.cardTitleRow({ icon: "monitor", title: "Provider Quotas", meta: "% remaining" }),
      boxes.length > 0 ? container.children(boxes) : ui.emptyState({
        icon: "monitor",
        title: "No quota data",
        description: "Provider limits appear when a usage source is available.",
      }),
    ],
  }).when(!narrow, (el) => el.flex_1().min_w(0));
}

function buildUnusedCard({ ui, palette, collectEntries, agentsList, bgLiveList, helpers, narrow }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const cutoff14 = helpers.isoDateDaysAgo(13);
  const todayStr = helpers.localIsoDate();

  let hasInstalled = false;
  const installedMap = new Map();
  const sessionsByProvider = new Map();

  for (const entry of collectEntries) {
    const res = entry?.result;
    if (!res) continue;

    if (res.installed && typeof res.installed === "object") {
      hasInstalled = true;
      for (const def of helpers.PROVIDER_DEFS) {
        if (res.installed[def.installedKey] === true) {
          installedMap.set(def.id, true);
        } else if (!installedMap.has(def.id) && res.installed[def.installedKey] === false) {
          installedMap.set(def.id, false);
        }
      }
    }

    const days = res.usage?.days;
    if (Array.isArray(days)) {
      for (const row of days) {
        if (!row || !row.date || row.date < cutoff14 || row.date > todayStr) continue;
        const p = row.provider || "";
        const sess = Number(row.sessions) || 0;
        const act = Number(row.active_s) || 0;
        const tok = rowTokens(row);
        if (p === "antigravity" && tok === 0) continue;
        if (sess > 0 || act > 0 || tok > 0) {
          sessionsByProvider.set(p, (sessionsByProvider.get(p) ?? 0) + Math.max(1, sess));
        }
      }
    }
  }

  // Also treat a currently running agent (including background live sessions) as active.
  const runningKeys = new Set(
    (agentsList ?? []).map((a) => String(a?.program?.key || a?.app || "").toLowerCase()),
  );
  for (const { item } of bgLiveList ?? []) {
    if (item?.provider) runningKeys.add(String(item.provider).toLowerCase());
  }

  const unused = [];
  for (const def of helpers.PROVIDER_DEFS) {
    if (installedMap.get(def.id) !== true) continue;
    const sessCount = sessionsByProvider.get(def.id) ?? 0;
    const isRunning = runningKeys.has(def.installedKey) || runningKeys.has(def.id);
    if (sessCount === 0 && !isRunning) {
      unused.push(def);
    }
  }

  let body;
  if (!hasInstalled) {
    body = ui.emptyState({
      icon: "agents",
      title: "Waiting for installation data",
      description: "Installed CLI tools appear here after the collector runs.",
    });
  } else if (unused.length === 0) {
    body = v_flex()
      .w_full()
      .flex_1()
      .justify_center()
      .gap(6)
      .p(12)
      .rounded(RADII.inner)
      .bg(PALETTE.okSoft)
      .border(1)
      .border_color(PALETTE.okBorder)
      .child(
        div()
          .text_size(SIZES.sm)
          .font_bold()
          .text_color(PALETTE.ok)
          .child("All installed agents were used in the last 14 days"),
      )
      .child(
        div()
          .text_size(SIZES.xs)
          .text_color(PALETTE.muted)
          .child("Every installed agent had a session in the last 14 days."),
      );
  } else {
    const names = unused.map((u) => u.label).join(", ");
    body = v_flex()
      .w_full()
      .gap(8)
      .child(
        div()
          .w_full()
          .px(12)
          .py(8)
          .rounded(RADII.inner)
          .bg(PALETTE.warnSoft)
          .border(1)
          .border_color(PALETTE.warnBorder)
          .text_size(SIZES.sm)
          .font_bold()
          .text_color(PALETTE.warn)
          .child(`${names}: no recorded sessions in the last 14 days.`),
      )
      .children(
        unused.map((u) =>
          h_flex()
            .id(`unused-${u.id}`)
            .w_full()
            .px(11)
            .py(8)
            .gap(8)
            .items_center()
            .justify_between()
            .rounded(RADII.chip)
            .bg(PALETTE.rowBg)
            .border(1)
            .border_dashed()
            .border_color(PALETTE.offlineBorder)
            .child(
              h_flex()
                .items_center()
                .gap(8)
                .min_w(0)
                .child(div().size(7).flex_none().rounded(7).border(1.5).border_color(PALETTE.offline))
                .child(
                  div()
                    .truncate()
                    .text_size(SIZES.sm)
                    .font_bold()
                    .text_color(PALETTE.text)
                    .child(u.label),
                ),
            )
            .child(
              div()
                .flex_none()
                .text_size(SIZES.xs)
                .font_family(monoFont())
                .font_semibold()
                .text_color(PALETTE.muted)
                .child(u.id === "antigravity" ? "no records · installed" : "never used"),
            ),
        ),
      );
  }

  return ui.card({
    id: "agents-unused",
    padding: 16,
    gap: 12,
    children: [
      h_flex()
        .w_full()
        .items_center()
        .justify_between()
        .flex_wrap()
        .gap(8)
        .child(
          h_flex()
            .items_center()
            .gap(9)
            .child(
              h_flex()
                .size(28)
                .flex_none()
                .rounded(RADII.chip)
                .bg(unused.length > 0 ? PALETTE.warnSoft : PALETTE.raised)
                .border(1)
                .border_color(unused.length > 0 ? PALETTE.warnBorder : PALETTE.lineStrong)
                .items_center()
                .justify_center()
                .child(ui.iconOf("alert", 15, unused.length > 0 ? PALETTE.warn : PALETTE.text)),
            )
            .child(
              div()
                .text_size(SIZES.title)
                .font_bold()
                .text_color(PALETTE.text)
                .child("Unused Agents"),
            ),
        )
        .child(
          ui.chip({
            label: hasInstalled ? `${unused.length} installed · 0 h` : "—",
            mono: true,
            color: unused.length > 0 ? PALETTE.warn : PALETTE.muted,
            bg: unused.length > 0 ? PALETTE.warnSoft : PALETTE.rowBg,
            borderColor: unused.length > 0 ? PALETTE.warnBorder : PALETTE.line,
          }),
        ),
      body,
    ],
  }).when(!narrow, (el) => el.w(340).flex_none());
}

function heatCellStyle(PALETTE, hours, activeS, isToday) {
  if (activeS <= 0) {
    return {
      bg: PALETTE.bg,
      border: isToday ? PALETTE.okBorder : PALETTE.line,
      text: PALETTE.muted,
      label: "0",
    };
  }
  const formatted = hours < 0.05 ? "<0.1" : hours.toFixed(1);
  if (hours < 2) {
    return {
      bg: PALETTE.raised,
      border: isToday ? PALETTE.ok : PALETTE.lineStrong,
      text: PALETTE.text,
      label: formatted,
    };
  }
  if (hours < 4) {
    return {
      bg: PALETTE.offline,
      border: isToday ? PALETTE.ok : PALETTE.offline,
      text: PALETTE.onAccent,
      label: formatted,
    };
  }
  if (hours < 6) {
    return {
      bg: PALETTE.muted,
      border: isToday ? PALETTE.ok : PALETTE.muted,
      text: PALETTE.onAccent,
      label: formatted,
    };
  }
  return {
    bg: PALETTE.accent,
    border: isToday ? PALETTE.ok : PALETTE.accent,
    text: PALETTE.onAccent,
    label: formatted,
  };
}

function buildHeatmapCard({ ui, palette, collectEntries, helpers }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const days = helpers.dateRangeDays(14);
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const daySet = new Set(days);

  let hasUsage = false;
  let hasInstalled = false;
  const installedMap = new Map();
  const byProvDay = new Map();

  for (const entry of collectEntries) {
    const res = entry?.result;
    if (!res) continue;

    if (res.installed && typeof res.installed === "object") {
      hasInstalled = true;
      for (const def of helpers.PROVIDER_DEFS) {
        if (res.installed[def.installedKey] === true) {
          installedMap.set(def.id, true);
        }
      }
    }

    if (Array.isArray(res.usage?.days)) {
      hasUsage = true;
      for (const row of res.usage.days) {
        if (!row || row.provider === "antigravity" || !daySet.has(row.date)) continue;
        const p = row.provider || "other";
        if (!byProvDay.has(p)) byProvDay.set(p, new Map());
        const dMap = byProvDay.get(p);
        dMap.set(row.date, (dMap.get(row.date) ?? 0) + (Number(row.active_s) || 0));
      }
    }
  }

  const rows = [];
  const seen = new Set();
  for (let i = 0; i < helpers.PROVIDER_DEFS.length; i++) {
    const def = helpers.PROVIDER_DEFS[i];
    if (def.id === "antigravity") continue;
    seen.add(def.id);
    const dMap = byProvDay.get(def.id);
    let totalS = 0;
    if (dMap) {
      for (const v of dMap.values()) totalS += v;
    }
    const isInstalled = installedMap.get(def.id) === true;
    if (totalS > 0 || isInstalled) {
      rows.push({
        id: def.id,
        label: def.label,
        dMap: dMap ?? new Map(),
        totalS,
        order: i,
      });
    }
  }

  for (const [prov, dMap] of byProvDay.entries()) {
    if (seen.has(prov)) continue;
    let totalS = 0;
    for (const v of dMap.values()) totalS += v;
    if (totalS > 0) {
      rows.push({ id: prov, label: prov, dMap, totalS, order: 99 });
    }
  }

  rows.sort((a, b) => b.totalS - a.totalS || a.order - b.order);
  const grandTotalS = rows.reduce((s, r) => s + r.totalS, 0);

  const legendItems = [
    { label: "0 h", bg: PALETTE.bg, border: PALETTE.lineStrong },
    { label: "0.5–2 h", bg: PALETTE.raised, border: PALETTE.lineStrong },
    { label: "2–4 h", bg: PALETTE.offline, border: PALETTE.offline },
    { label: "4–6 h", bg: PALETTE.muted, border: PALETTE.muted },
    { label: "6+ h", bg: PALETTE.accent, border: PALETTE.accent },
  ];

  const headerRow = h_flex()
    .w_full()
    .items_center()
    .justify_between()
    .flex_wrap()
    .gap(10)
    .child(
      h_flex()
        .items_center()
        .flex_wrap()
        .gap(9)
        .child(
          h_flex()
            .size(28)
            .flex_none()
            .rounded(RADII.chip)
            .bg(PALETTE.raised)
            .border(1)
            .border_color(PALETTE.lineStrong)
            .items_center()
            .justify_center()
            .child(ui.iconOf("overview", 15, PALETTE.text)),
        )
        .child(
          div()
            .text_size(SIZES.title)
            .font_bold()
            .text_color(PALETTE.text)
            .child("14-Day Usage Heatmap"),
        )
        .child(
          div()
            .pl(8)
            .border_l(1)
            .border_color(PALETTE.lineStrong)
            .text_size(SIZES.xs)
            .font_family(monoFont())
            .text_color(PALETTE.mono)
            .child(`${helpers.formatShortDate(firstDay)} – ${helpers.formatShortDate(lastDay)} · hours of activity`),
        ),
    )
    .child(
      h_flex()
        .items_center()
        .flex_wrap()
        .gap(10)
        .children(
          legendItems.map((it) =>
            h_flex()
              .items_center()
              .gap(5)
              .text_size(SIZES.xs)
              .font_semibold()
              .text_color(PALETTE.muted)
              .child(
                div()
                  .size(10)
                  .rounded(3)
                  .bg(it.bg)
                  .border(1)
                  .border_color(it.border),
              )
              .child(it.label),
          ),
        )
        .child(
          ui.chip({
            label: hasUsage ? `${helpers.formatHours(grandTotalS)} h total` : "—",
            mono: true,
            color: PALETTE.mono,
          }),
        ),
    );

  let body;
  if (!hasUsage && !hasInstalled) {
    body = ui.emptyState({
      icon: "agents",
      title: "Waiting for usage data",
      description: "Activity over the last 14 days appears after the collector runs.",
    });
  } else if (rows.length === 0) {
    body = ui.emptyState({
      icon: "agents",
      title: "No recorded usage",
      description: "No agent sessions recorded in the last 14 days.",
    });
  } else {
    const colHeaders = h_flex()
      .w_full()
      .items_center()
      .gap(6)
      .child(div().w(146).flex_none())
      .children(
        days.map((d, idx) => {
          const isToday = idx === days.length - 1;
          return div()
            .flex_1()
            .min_w(44)
            .text_center()
            .text_size(SIZES.xs)
            .font_family(monoFont())
            .when(isToday, (el) => el.font_bold().text_color(PALETTE.ok))
            .when(!isToday, (el) => el.text_color(PALETTE.muted))
            .child(helpers.formatShortDate(d));
        }),
      )
      .child(
        div()
          .w(68)
          .flex_none()
          .text_right()
          .text_size(SIZES.xs)
          .font_family(monoFont())
          .font_semibold()
          .text_color(PALETTE.mono)
          .child("14 Days"),
      );

    const gridRows = rows.map((r) => {
      const isZeroAll = r.totalS <= 0;
      return h_flex()
        .id(`heat-row-${r.id}`)
        .w_full()
        .items_center()
        .gap(6)
        .child(
          div()
            .w(146)
            .flex_none()
            .truncate()
            .text_size(SIZES.sm)
            .font_bold()
            .text_color(isZeroAll ? PALETTE.muted : PALETTE.text)
            .child(r.label),
        )
        .when(isZeroAll, (el) =>
          el.child(
            h_flex()
              .flex_1()
              .h(26)
              .items_center()
              .justify_center()
              .rounded(6)
              .bg(PALETTE.bg)
              .border(1)
              .border_dashed()
              .border_color(PALETTE.offlineBorder)
              .text_size(SIZES.xs)
              .font_family(monoFont())
              .text_color(PALETTE.muted)
              .child("never used · installed"),
          ),
        )
        .when(!isZeroAll, (el) =>
          el.children(
            days.map((d, idx) => {
              const isToday = idx === days.length - 1;
              const activeS = r.dMap.get(d) ?? 0;
              const hours = activeS / 3600;
              const st = heatCellStyle(PALETTE, hours, activeS, isToday);
              return h_flex()
                .flex_1()
                .min_w(44)
                .h(26)
                .items_center()
                .justify_center()
                .rounded(5)
                .bg(st.bg)
                .border(1)
                .border_color(st.border)
                .text_size(SIZES.xs)
                .font_family(monoFont())
                .when(hours >= 4, (b) => b.font_bold())
                .text_color(st.text)
                .tooltip(`${r.label} · ${helpers.formatShortDate(d)}: ${helpers.formatHours(activeS)} h`)
                .child(st.label);
            }),
          ),
        )
        .child(
          div()
            .w(68)
            .flex_none()
            .text_right()
            .text_size(SIZES.xs)
            .font_family(monoFont())
            .font_bold()
            .text_color(isZeroAll ? PALETTE.muted : PALETTE.text)
            .child(`${helpers.formatHours(r.totalS)} h`),
        );
    });

    body = div()
      .id("agents-heatmap-scroll")
      .w_full()
      .overflow_x_scrollbar()
      .child(
        v_flex()
          .w_full()
          .min_w(820)
          .gap(6)
          .child(colHeaders)
          .children(gridRows),
      );
  }

  return ui.card({
    id: "agents-heatmap",
    padding: 16,
    gap: 12,
    children: [headerRow, body],
  });
}

export function renderAgentsNow({
  data,
  ui,
  palette,
  jump,
  maskHost,
  maskPath,
  collectEntries,
  machinesList,
  spacesList,
  agentsList,
  terminalsList,
  panesList,
  helpers,
  narrow,
}) {
  const bgLiveList = data.dedupeBackgroundLive({
    collectEntries,
    agentsList,
    spacesList,
    terminalsList,
    panesList,
  });

  const row2 = narrow
    ? v_flex()
        .w_full()
        .gap(12)
        .child(buildQuotasCard({ ui, palette, collectEntries, narrow }))
        .child(buildUnusedCard({ ui, palette, collectEntries, agentsList, bgLiveList, helpers, narrow }))
    : h_flex()
        .w_full()
        .items_stretch()
        .gap(12)
        .child(buildQuotasCard({ ui, palette, collectEntries, narrow }))
        .child(buildUnusedCard({ ui, palette, collectEntries, agentsList, bgLiveList, helpers, narrow }));

  return v_flex()
    .w_full()
    .gap(14)
    .child(
      buildHeroSection({
        ui,
        palette,
        jump,
        maskHost,
        maskPath,
        agentsList,
        spacesList,
        machinesList,
        collectEntries,
        bgLiveList,
        helpers,
        narrow,
      }),
    )
    .child(row2)
    .child(buildHeatmapCard({ ui, palette, collectEntries, helpers }));
}
