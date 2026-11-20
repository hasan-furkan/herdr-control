// Screen 1: Overview — Mono bento layout.

import { dashboardNow } from "../demo-mode.js";
import { maskBranch, maskProgram, maskText, maskTitle } from "../mask.js";
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { readTodayDecisions } from "./approvals.js";
import { countLabel, extractTargetPort, formatTokens, summarizeUsageTokens, tailscaleRoutes } from "../data.js";

const TIMELINE_START_MIN = 8 * 60;
const TIMELINE_END_MIN = 20 * 60;
const TIMELINE_SPAN_MIN = TIMELINE_END_MIN - TIMELINE_START_MIN;
const TIMELINE_HOURS = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"];

const PROVIDER_DEFS = [
  { id: "claude", label: "Claude Code", installedKey: "claude" },
  { id: "opencode", label: "OpenCode", installedKey: "opencode" },
  { id: "antigravity", label: "Antigravity", installedKey: "agy" },
  { id: "codex", label: "Codex", installedKey: "codex" },
  { id: "pi", label: "Pi", installedKey: "pi" },
  { id: "gemini", label: "Gemini CLI", installedKey: "gemini" },
];

const providerLabel = (provider) =>
  PROVIDER_DEFS.find((def) => def.id === provider)?.label ?? (provider || "Agent");

const BACKSLASH = String.fromCharCode(92);

function lastPathSegment(p) {
  if (!p || typeof p !== "string") return "";
  const parts = p
    .split("/")
    .flatMap((seg) => seg.split(BACKSLASH))
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

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

function formatSince(ts) {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return "—";
  const diffMin = Math.max(0, Math.floor((dashboardNow().getTime() - ts) / 60000));
  if (diffMin < 1) return "<1 min ago";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} h ago`;
  return `${Math.floor(diffHours / 24)} d ago`;
}

function formatOfflineAgo(isoStr) {
  if (!isoStr || typeof isoStr !== "string") return "offline";
  const ts = Date.parse(isoStr);
  if (!Number.isFinite(ts)) return "offline";
  const diffMs = Math.max(0, dashboardNow().getTime() - ts);
  const days = Math.floor(diffMs / 86400000);
  if (days >= 1) return `offline for ${days} d`;
  const hours = Math.floor(diffMs / 3600000);
  if (hours >= 1) return `${hours} h ago`;
  const mins = Math.max(1, Math.floor(diffMs / 60000));
  return `${mins} min ago`;
}

function rangeConfig(activeRange) {
  if (activeRange === "Today") return { days: 1, title: "Agents · today" };
  if (activeRange === "30 Days") return { days: 30, title: "Agents · last 30 days" };
  return { days: 14, title: "Agents · last 14 days" };
}

function iconBoxColors(PALETTE, tone) {
  switch (tone) {
    case "ok":
      return { bg: PALETTE.okSoft, color: PALETTE.ok, border: PALETTE.okBorder };
    case "warn":
      return { bg: PALETTE.warnSoft, color: PALETTE.warn, border: PALETTE.warnBorder };
    case "danger":
      return { bg: PALETTE.dangerSoft, color: PALETTE.danger, border: PALETTE.dangerBorder };
    default:
      return { bg: PALETTE.raised, color: PALETTE.text, border: PALETTE.lineStrong };
  }
}

function chipColors(PALETTE, tone) {
  switch (tone) {
    case "ok":
      return { bg: PALETTE.okSoft, color: PALETTE.ok, borderColor: PALETTE.okBorder };
    case "warn":
      return { bg: PALETTE.warnSoft, color: PALETTE.warn, borderColor: PALETTE.warnBorder };
    case "danger":
      return { bg: PALETTE.dangerSoft, color: PALETTE.danger, borderColor: PALETTE.dangerBorder };
    default:
      return { bg: PALETTE.rowBg, color: PALETTE.mono, borderColor: PALETTE.line };
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
  onMore = null,
  moreId = null,
}) {
  const { PALETTE, SIZES, RADII } = palette;
  const ic = iconBoxColors(PALETTE, iconTone);
  const cc = chipColors(PALETTE, chipTone);

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
        .gap(8)
        .child(
          h_flex()
            .size(28)
            .flex_none()
            .rounded(RADII.chip)
            .bg(ic.bg)
            .border(1)
            .border_color(ic.border)
            .items_center()
            .justify_center()
            .child(ui.iconOf(icon, 15, ic.color)),
        )
        .child(
          div()
            .whitespace_nowrap()
            .text_size(SIZES.title)
            .font_bold()
            .text_color(PALETTE.text)
            .child(title),
        ),
    )
    .child(
      h_flex()
        .flex_none()
        .items_center()
        .gap(6)
        .when(chipLabel !== null && chipLabel !== undefined, (el) =>
          el.child(
            ui.chip({
              label: chipLabel,
              mono: true,
              color: cc.color,
              bg: cc.bg,
              borderColor: cc.borderColor,
              h: 22,
              px: 7,
            }),
          ),
        )
        .when(Boolean(onMore), (el) =>
          el.child(
            div()
              .when(Boolean(moreId), (b) => b.id(moreId))
              .px(5)
              .py(3)
              .rounded(RADII.chip)
              .text_size(SIZES.xs)
              .font_semibold()
              .text_color(PALETTE.muted)
              .whitespace_nowrap()
              .cursor_pointer()
              .hover((s) => s.text_color(PALETTE.text).bg(PALETTE.raised))
              .on_click(onMore)
              .child("all →"),
          ),
        ),
    );
}

function cardEmpty({ ui, palette, icon, title, description }) {
  const { PALETTE, SIZES, RADII } = palette;
  return v_flex()
    .w_full()
    .flex_1()
    .items_center()
    .justify_center()
    .gap(6)
    .px(14)
    .py(20)
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

function minuteOfToday(ms, todayStartMs) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  if (ms < todayStartMs) return 0;
  return (ms - todayStartMs) / 60000;
}

function timelineBarBounds(startMs, endMs, todayStartMs) {
  const sMin = minuteOfToday(startMs, todayStartMs);
  const eMin = minuteOfToday(endMs, todayStartMs);
  if (sMin === null || eMin === null || eMin <= TIMELINE_START_MIN || sMin >= TIMELINE_END_MIN) {
    return null;
  }
  const clampedStart = Math.max(TIMELINE_START_MIN, sMin);
  const clampedEnd = Math.min(TIMELINE_END_MIN, Math.max(clampedStart, eMin));
  const leftPct = ((clampedStart - TIMELINE_START_MIN) / TIMELINE_SPAN_MIN) * 100;
  const rawWidthPct = ((clampedEnd - clampedStart) / TIMELINE_SPAN_MIN) * 100;
  const widthPct = Math.min(100 - leftPct, Math.max(1.5, rawWidthPct));
  return { leftPct, widthPct };
}

function buildHeroSection({
  data,
  ui,
  palette,
  jump,
  maskPath,
  spacesList,
  agentsList,
  terminalsList,
  panesList,
  collectEntries,
  narrow,
}) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const now = dashboardNow();
  const todayStr = localIsoDate(now);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();
  const nowMs = now.getTime();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowPct = Math.max(
    0,
    Math.min(100, ((nowMin - TIMELINE_START_MIN) / TIMELINE_SPAN_MIN) * 100),
  );
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const nowLabel = `now ${hh}:${mm}`;

  const { total: todayTokens, estimated: todayEstimated } = summarizeUsageTokens(collectEntries, todayStr);
  const todayTokenLabel = formatTokens(todayTokens, { estimated: todayEstimated, unit: false });
  const sessionRows = [];

  for (const entry of collectEntries) {
    const usage = entry?.result?.usage;
    if (usage && Array.isArray(usage.sessions)) {
      for (const s of usage.sessions) {
        const sMs = typeof s?.start === "number" ? s.start : Date.parse(s?.start || "");
        const eMs = typeof s?.end === "number" ? s.end : Date.parse(s?.end || "");
        if (!Number.isFinite(sMs) || !Number.isFinite(eMs)) continue;
        const bounds = timelineBarBounds(sMs, eMs, todayStartMs);
        if (!bounds) continue;
        sessionRows.push({
          id: `sess-${s.id ?? sessionRows.length}`,
          program: providerLabel(s.provider),
          space: maskPath(s.project || "—"),
          status: "done",
          bounds,
          address: null,
        });
      }
    }
  }

  const list = agentsList ?? [];
  let workingCount = 0;
  let blockedCount = 0;
  let doneCount = 0;
  for (const a of list) {
    if (!a) continue;
    if (a.status === "working") workingCount += 1;
    else if (a.status === "blocked") blockedCount += 1;
    else if (a.status === "done") doneCount += 1;
  }

  const bgLiveItems = data
    .dedupeBackgroundLive({
      collectEntries,
      agentsList: list,
      spacesList,
      terminalsList,
      panesList,
    })
    .map((x) => x.item);
  workingCount += bgLiveItems.length;

  const tabById = new Map();
  for (const sp of spacesList ?? []) {
    for (const tab of sp?.tabs ?? []) {
      if (tab?.id) tabById.set(tab.id, tab);
    }
  }

  const liveRows = list.map((a) => {
    const tab = tabById.get(a.tab);
    const sinceMs = tab?.working_since ?? null;
    const bounds =
      (a.status === "working" || a.status === "blocked") && typeof sinceMs === "number"
        ? timelineBarBounds(sinceMs, nowMs, todayStartMs)
        : null;
    return {
      id: `tl-${a.address}`,
      program: a.program?.name || providerLabel(a.app),
      space: maskPath(a.space_name || "—"),
      status: a.status,
      bounds,
      address: a.address,
    };
  });

  const bgLiveRows = bgLiveItems.map((item, idx) => {
    const sMs = typeof item.since === "number" ? item.since : Date.parse(item.since || "");
    const bounds = Number.isFinite(sMs) ? timelineBarBounds(sMs, nowMs, todayStartMs) : null;
    const folderSeg = lastPathSegment(item.folder);
    const spaceLabel = folderSeg
      ? `${maskPath(folderSeg)} · background`
      : "outside Herdr · background";
    return {
      id: `tl-bg-${item.provider}-${idx}`,
      program: providerLabel(item.provider),
      space: spaceLabel,
      status: "working",
      bounds,
      address: null,
    };
  });

  const timelineRows = [...liveRows, ...bgLiveRows, ...sessionRows].slice(0, 6);
  const programCounts = new Map();
  for (const { program } of timelineRows) {
    programCounts.set(program, (programCounts.get(program) ?? 0) + 1);
  }
  const programSeen = new Map();

  const pulseDot = div()
    .size(8)
    .flex_none()
    .rounded(8)
    .bg(workingCount > 0 ? PALETTE.heroGreen : PALETTE.heroMuted)
    .when(workingCount > 0, (el) =>
      el.loop("opacity", { from: 0.4, to: 1, period: 1400 }),
    );

  const summaryBlock = v_flex()
    .when(!narrow, (el) =>
      el
        .w(276)
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
        .pb(14)
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
            .child("TODAY’S AGENT ACTIVITY"),
        ),
    )
    .child(
      v_flex()
        .gap(10)
        .child(
          h_flex()
            .items_baseline()
            .gap(8)
            .child(
              div()
                .text_size(todayTokenLabel.length > 5 ? 48 : 60)
                .font_bold()
                .font_family(monoFont())
                .text_color(PALETTE.heroText)
                .whitespace_nowrap()
                .when(todayEstimated, (el) => el.tooltip("Includes estimated Antigravity tokens"))
                .child(todayTokenLabel),
            )
            .when(todayTokens !== null, (el) => el.child(
              div()
                .text_size(SIZES.lg)
                .font_semibold()
                .text_color(PALETTE.heroMuted)
                .child("tok"),
            )),
        )
        .child(
          h_flex()
            .w_full()
            .flex_wrap()
            .items_center()
            .gap(5)
            .text_size(SIZES.xs)
            .font_semibold()
            .text_color(PALETTE.heroText)
            .child(
              h_flex()
                .items_center()
                .gap(4)
                .whitespace_nowrap()
                .child(div().size(7).rounded(7).bg(PALETTE.heroGreen))
                .child(`${workingCount} working`),
            )
            .child(
              h_flex()
                .items_center()
                .gap(4)
                .whitespace_nowrap()
                .child(div().text_color(PALETTE.heroMuted).child("·"))
                .child(div().size(7).rounded(7).bg(PALETTE.heroWarn))
                .child(`${blockedCount} awaiting approval`),
            )
            .child(
              h_flex()
                .items_center()
                .gap(4)
                .whitespace_nowrap()
                .child(div().text_color(PALETTE.heroMuted).child("·"))
                .child(div().size(7).rounded(7).bg(PALETTE.offline))
                .child(`${doneCount} done`),
            ),
        ),
    );

  const legend = h_flex()
    .flex_none()
    .flex_wrap()
    .items_center()
    .gap(12)
    .text_size(SIZES.xs)
    .font_semibold()
    .text_color(PALETTE.heroText)
    .child(
      h_flex()
        .items_center()
        .gap(5)
        .child(div().size(10).rounded(3).bg(PALETTE.heroGreen))
        .child("Working"),
    )
    .child(
      h_flex()
        .items_center()
        .gap(5)
        .child(div().size(10).rounded(3).bg(PALETTE.heroWarn))
        .child("Awaiting approval"),
    )
    .child(
      h_flex()
        .items_center()
        .gap(5)
        .child(div().size(10).rounded(3).bg(PALETTE.heroMuted))
        .child("Done"),
    );

  const labelProgW = narrow ? 92 : 124;
  const labelSpaceW = narrow ? 110 : 216;
  const statusColW = narrow ? 92 : 108;

  const swimlaneContent =
    timelineRows.length === 0
      ? v_flex()
          .w_full()
          .flex_1()
          .items_center()
          .justify_center()
          .gap(6)
          .px(16)
          .py(22)
          .rounded(RADII.inner)
          .border(1)
          .border_color(PALETTE.heroLine)
          .child(
            div()
              .text_size(SIZES.sm)
              .font_bold()
              .text_color(PALETTE.heroText)
              .text_center()
              .child("No agents running"),
          )
          .child(
            div()
              .max_w(440)
              .text_size(SIZES.xs)
              .text_color(PALETTE.heroMuted)
              .text_center()
              .child(
                "The 08:00-20:00 timeline appears when an agent runs in a terminal.",
              ),
          )
      : v_flex()
          .w_full()
          .gap(5)
          .child(
            h_flex()
              .w_full()
              .items_center()
              .gap(8)
              .child(div().w(labelProgW + labelSpaceW + 8).flex_none())
              .child(
                h_flex()
                  .flex_1()
                  .min_w(80)
                  .justify_end()
                  .child(
                    div()
                      .px(7)
                      .py(2)
                      .rounded(RADII.chip)
                      .bg(PALETTE.heroGreen)
                      .text_size(SIZES.xs)
                      .font_family(monoFont())
                      .font_bold()
                      .text_color(PALETTE.text)
                      .child(nowLabel),
                  ),
              )
              .child(div().w(statusColW).flex_none()),
          )
          .children(
            timelineRows.map((row) => {
              const index = (programSeen.get(row.program) ?? 0) + 1;
              programSeen.set(row.program, index);
              const label = programCounts.get(row.program) > 1 ? `${row.program} #${index}` : row.program;
              const barColor =
                row.status === "blocked"
                  ? PALETTE.heroWarn
                  : row.status === "done"
                    ? PALETTE.heroMuted
                    : PALETTE.heroGreen;

              return h_flex()
                .id(row.id)
                .w_full()
                .h(20)
                .items_center()
                .gap(8)
                .when(Boolean(row.address), (el) =>
                  el
                    .cursor_pointer()
                    .hover((s) => s.bg(PALETTE.heroLine).rounded(4))
                    .on_click(() => jump("agent.focus", { terminal: row.address })),
                )
                .child(
                  div()
                    .w(labelProgW)
                    .flex_none()
                    .truncate()
                    .text_size(SIZES.xs)
                    .font_bold()
                    .text_color(PALETTE.heroText)
                    .child(maskProgram(label)),
                )
                .child(
                  div()
                    .w(labelSpaceW)
                    .flex_none()
                    .truncate()
                    .text_size(SIZES.xs)
                    .font_family(monoFont())
                    .text_color(PALETTE.heroMuted)
                    .child(row.space),
                )
                .child(
                  div()
                    .flex_1()
                    .min_w(80)
                    .h(14)
                    .relative()
                    .rounded(4)
                    .bg(PALETTE.heroLine)
                    .overflow_hidden()
                    .when(Boolean(row.bounds), (el) =>
                      el.child(
                        div()
                          .absolute()
                          .top(0)
                          .bottom(0)
                          .left(`${row.bounds.leftPct.toFixed(1)}%`)
                          .w(`${row.bounds.widthPct.toFixed(1)}%`)
                          .rounded(4)
                          .bg(barColor),
                      ),
                    )
                    .child(
                      div()
                        .absolute()
                        .top(0)
                        .bottom(0)
                        .left(`${nowPct.toFixed(1)}%`)
                        .w(2)
                        .bg(PALETTE.heroGreen),
                    ),
                )
                .child(
                  h_flex()
                    .w(statusColW)
                    .flex_none()
                    .justify_start()
                    .child(ui.statusWithWord(row.status, { onHero: true })),
                );
            }),
          )
          .when(!narrow, (el) =>
            el.child(
              h_flex()
                .w_full()
                .items_center()
                .gap(8)
                .pt(2)
                .child(div().w(labelProgW + labelSpaceW + 8).flex_none())
                .child(
                  h_flex()
                    .flex_1()
                    .min_w(80)
                    .justify_between()
                    .children(
                      TIMELINE_HOURS.map((h) =>
                        div()
                          .text_size(SIZES.xs)
                          .font_family(monoFont())
                          .text_color(PALETTE.heroMuted)
                          .child(h),
                      ),
                    ),
                )
                .child(div().w(statusColW).flex_none()),
            ),
          );

  const swimlaneBlock = v_flex()
    .flex_1()
    .min_w(0)
    .justify_between()
    .gap(10)
    .child(
      h_flex()
        .w_full()
        .flex_wrap()
        .items_center()
        .justify_between()
        .gap(8)
        .child(
          div()
            .text_size(SIZES.md)
            .font_bold()
            .text_color(PALETTE.heroText)
            .child("Agent Timeline · 08:00 – 20:00"),
        )
        .child(legend),
    )
    .child(swimlaneContent);

  return ui.heroCard({
    id: "overview-hero",
    padding: 18,
    gap: 14,
    children: [
      narrow
        ? v_flex().w_full().gap(14).child(summaryBlock).child(swimlaneBlock)
        : h_flex().w_full().items_stretch().gap(20).child(summaryBlock).child(swimlaneBlock),
    ],
  });
}

function buildUsageCard({ ui, palette, activeRange, collectEntries, onNavigate }) {
  const { PALETTE, SIZES, monoFont } = palette;
  const { days, title } = rangeConfig(activeRange);
  const todayStr = localIsoDate();
  const cutoffStr = isoDateDaysAgo(days - 1);

  const { providers, total, estimated } = summarizeUsageTokens(collectEntries, cutoffStr, todayStr);
  let hasInstalled = false;
  const installedMap = new Map();

  for (const entry of collectEntries) {
    const res = entry?.result;
    if (!res) continue;

    if (res.installed && typeof res.installed === "object") {
      hasInstalled = true;
      for (const def of PROVIDER_DEFS) {
        if (res.installed[def.installedKey] === true) {
          installedMap.set(def.id, true);
        } else if (!installedMap.has(def.id) && res.installed[def.installedKey] === false) {
          installedMap.set(def.id, false);
        }
      }
    }

  }

  const rows = [];
  const seen = new Set();
  for (let i = 0; i < PROVIDER_DEFS.length; i++) {
    const def = PROVIDER_DEFS[i];
    const bucket = providers.get(def.id);
    const isInstalled = installedMap.get(def.id) === true;
    seen.add(def.id);
    if (bucket || isInstalled) {
      rows.push({
        id: def.id,
        label: def.label,
        tokens: bucket?.tokens ?? 0,
        estimated: bucket?.estimated ?? false,
        order: i,
      });
    }
  }

  for (const [prov, bucket] of providers) {
    if (!seen.has(prov)) {
      rows.push({ id: prov, label: prov, ...bucket, order: 99 });
    }
  }

  rows.sort((a, b) => b.tokens - a.tokens || a.order - b.order);
  const maxTokens = rows[0]?.tokens ?? 0;

  const body =
    total === null && !hasInstalled
      ? cardEmpty({
          ui,
          palette,
          icon: "agents",
          title: "Waiting for usage data",
          description: "Provider tokens appear after the collector runs.",
        })
      : rows.length === 0
        ? cardEmpty({
            ui,
            palette,
            icon: "agents",
            title: "No recorded usage",
            description: "No usage or installed agents found for this range.",
          })
        : v_flex()
            .w_full()
            .flex_1()
            .justify_between()
            .gap(8)
            .children(
              rows.map((r, idx) => {
                const isZero = r.tokens === 0;
                const barColor =
                  idx === 0
                    ? PALETTE.accent
                    : idx === 1
                      ? PALETTE.mono
                      : PALETTE.muted;
                return h_flex()
                  .id(`ov-usage-${r.id}`)
                  .w_full()
                  .items_center()
                  .gap(8)
                  .child(
                    div()
                      .w(92)
                      .flex_none()
                      .truncate()
                      .text_size(SIZES.xs)
                      .font_semibold()
                      .text_color(isZero ? PALETTE.muted : PALETTE.text)
                      .child(r.label),
                  )
                  .child(
                    div()
                      .flex_1()
                      .min_w(0)
                      .child(
                        ui.horizontalBar({
                          ratio: maxTokens > 0 ? r.tokens / maxTokens : 0,
                          height: 14,
                          radius: 4,
                          color: barColor,
                          trackColor: PALETTE.bg,
                        }),
                      ),
                  )
                  .child(
                    div()
                      .w(92)
                      .flex_none()
                      .whitespace_nowrap()
                      .text_right()
                      .text_size(SIZES.xs)
                      .font_family(monoFont())
                      .font_semibold()
                      .text_color(isZero ? PALETTE.muted : PALETTE.mono)
                      .when(r.estimated, (el) => el.tooltip("Estimated Antigravity tokens"))
                      .child(isZero ? (total === null ? "—" : "none") : formatTokens(r.tokens, { estimated: r.estimated })),
                  );
              }),
            );

  return ui.card({
    id: "overview-usage",
    padding: 16,
    gap: 12,
    children: [
      cardHead({
        ui,
        palette,
        icon: "agents",
        title,
        chipLabel: formatTokens(total, { estimated }),
        moreId: "ov-usage-more",
        onMore: (_e, cx) => onNavigate("agents", cx),
      }),
      body,
    ],
  });
}

function buildMachinesCard({
  ui,
  palette,
  data,
  maskHost,
  machinesList,
  agentsList,
  localEntry,
  collectEntries,
  onNavigate,
}) {
  const { PALETTE, SIZES, monoFont } = palette;
  const localRes = localEntry?.result ?? null;
  const ts = localRes?.tailscale ?? null;
  const localHostname = localRes?.system?.hostname || null;
  const localTsName = ts?.self?.name || null;
  const localKey = (localTsName || localHostname || "local").toLowerCase();

  let selfPingMs = null;
  const selfNames = new Set(
    [localTsName, localHostname].filter(Boolean).map((n) => n.toLowerCase()),
  );
  for (const e of collectEntries) {
    if (e.machine === null) continue;
    for (const p of e.result?.tailscale?.peers ?? []) {
      if (p?.name && selfNames.has(p.name.toLowerCase()) && typeof p.ping_ms === "number") {
        selfPingMs = selfPingMs == null ? p.ping_ms : Math.min(selfPingMs, p.ping_ms);
      }
    }
  }

  const merged = new Map();

  for (const m of machinesList ?? []) {
    if (!m) continue;
    const isLocal = m.name == null;
    const key = isLocal ? localKey : String(m.name).toLowerCase();
    const displayName = isLocal ? localTsName || localHostname || "This computer" : m.name;
    merged.set(key, {
      key,
      displayName,
      isLocal,
      herdrName: m.name ?? null,
      herdrLayout: m.layout,
      inTailscale: false,
      online: m.layout === "ready",
      pingMs: isLocal ? selfPingMs : null,
      lastSeen: null,
    });
  }

  if (ts?.self) {
    const selfKey = (ts.self.name || localKey).toLowerCase();
    const prev = merged.get(selfKey) ?? merged.get(localKey);
    const key = prev ? prev.key : selfKey;
    merged.set(key, {
      key,
      displayName: ts.self.name || prev?.displayName || localHostname || "This computer",
      isLocal: true,
      herdrName: prev?.herdrName ?? null,
      herdrLayout: prev?.herdrLayout ?? "ready",
      inTailscale: true,
      online: true,
      pingMs: prev?.pingMs ?? selfPingMs,
      lastSeen: null,
    });
  }

  for (const peer of ts?.peers ?? []) {
    if (!peer?.name) continue;
    const key = peer.name.toLowerCase();
    const prev = merged.get(key);
    merged.set(key, {
      key,
      displayName: prev?.displayName || peer.name,
      isLocal: Boolean(prev?.isLocal),
      herdrName: prev?.herdrName ?? null,
      herdrLayout: prev?.herdrLayout ?? null,
      inTailscale: true,
      online: Boolean(peer.online),
      pingMs: typeof peer.ping_ms === "number" ? peer.ping_ms : prev?.pingMs ?? null,
      lastSeen: peer.last_seen ?? null,
    });
  }

  const agentCounts = new Map();
  for (const a of agentsList ?? []) {
    if (!a) continue;
    const m = data.machineFromAddress(a.address);
    const k = m === null ? "__local__" : String(m).toLowerCase();
    agentCounts.set(k, (agentCounts.get(k) ?? 0) + 1);
  }

  const rows = Array.from(merged.values()).map((m) => {
    const aKey = m.isLocal ? "__local__" : String(m.herdrName ?? m.displayName).toLowerCase();
    return { ...m, agentCount: agentCounts.get(aKey) ?? 0 };
  });

  rows.sort((a, b) => {
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return String(a.displayName).localeCompare(String(b.displayName));
  });

  const onlineCount = rows.filter((r) => r.online).length;
  const totalCount = rows.length;

  const body =
    rows.length === 0
      ? cardEmpty({
          ui,
          palette,
          icon: "machines",
          title: "Machine not found",
          description: "Herdr and Tailscale reported no machines.",
        })
      : v_flex()
          .w_full()
          .gap(6)
          .children(
            rows.slice(0, 6).map((m) => {
              let dotColor = PALETTE.offline;
              let stateText = "—";
              if (m.inTailscale) {
                if (m.online) {
                  dotColor = PALETTE.ok;
                  stateText =
                    m.pingMs !== null
                      ? `online · ${Math.round(m.pingMs)} ms`
                      : "online";
                } else {
                  dotColor = PALETTE.offline;
                  stateText = formatOfflineAgo(m.lastSeen);
                }
              } else {
                dotColor =
                  m.herdrLayout === "ready"
                    ? PALETTE.ok
                    : m.herdrLayout === "loading"
                      ? PALETTE.warn
                      : PALETTE.offline;
                stateText = data.layoutStateLabel(m.herdrLayout);
              }

              return ui.miniRow({
                id: `ov-mach-${m.key}`,
                px: 8,
                py: 6,
                gap: 5,
                onClick: (_e, cx) => onNavigate("machines", cx),
                children: [
                  div().size(7).flex_none().rounded(7).bg(dotColor),
                  div()
                    .flex_1()
                    .min_w(56)
                    .truncate()
                    .font_family(monoFont())
                    .text_size(SIZES.xs)
                    .font_semibold()
                    .text_color(PALETTE.text)
                    .child(maskHost(m.displayName)),
                  div()
                    .flex_none()
                    .text_size(SIZES.xs)
                    .text_color(m.online ? PALETTE.mono : PALETTE.muted)
                    .whitespace_nowrap()
                    .child(stateText),
                  div()
                    .flex_none()
                    .font_family(monoFont())
                    .text_size(SIZES.xs)
                    .font_semibold()
                    .text_color(m.agentCount > 0 ? PALETTE.mono : PALETTE.muted)
                    .whitespace_nowrap()
                    .child(countLabel(m.agentCount, "agent")),
                ],
              });
            }),
          );

  return ui.card({
    id: "overview-machines",
    padding: 16,
    gap: 12,
    children: [
      cardHead({
        ui,
        palette,
        icon: "machines",
        iconTone: onlineCount > 0 ? "ok" : "normal",
        title: "Machines",
        chipLabel: `${onlineCount} online · ${totalCount} total`,
        moreId: "ov-machines-more",
        onMore: (_e, cx) => onNavigate("machines", cx),
      }),
      body,
    ],
  });
}

function buildApprovalsCard({
  ui,
  palette,
  jump,
  maskPath,
  agentsList,
  spacesList,
  blockedSinceMap,
  onNavigate,
}) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const blocked = (agentsList ?? []).filter((a) => a && a.status === "blocked");
  const tabChangedAt = new Map();
  for (const sp of spacesList ?? []) {
    for (const tab of sp?.tabs ?? []) {
      if (tab?.id && typeof tab.changed_at === "number") {
        tabChangedAt.set(tab.id, tab.changed_at);
      }
    }
  }

  const decisions = readTodayDecisions();
  const hasDecisions = decisions.approved > 0 || decisions.rejected > 0;

  const listBody =
    blocked.length === 0
      ? cardEmpty({
          ui,
          palette,
          icon: "approvals",
          title: "No pending approvals",
          description: "Agents awaiting approval appear here.",
        })
      : v_flex()
          .w_full()
          .gap(7)
          .children(
            blocked.slice(0, 4).map((a, idx) => {
              const progName = maskProgram(a.program?.name || a.app || "Agent");
              const spaceLabel = maskPath(a.space_name || "—");
              const titleText = maskTitle(a.title || a.tab_name || "—");
              const sinceTs = blockedSinceMap?.get(a.address) ?? tabChangedAt.get(a.tab) ?? null;
              const sinceLabel = formatSince(sinceTs);
              const isPrimary = idx === 0;

              return ui.miniRow({
                id: `ov-appr-${a.address}`,
                urgent: true,
                px: 10,
                py: 7,
                gap: 8,
                children: [
                  v_flex()
                    .flex_1()
                    .min_w(0)
                    .gap(2)
                    .child(
                      h_flex()
                        .w_full()
                        .items_center()
                        .gap(6)
                        .min_w(0)
                        .child(div().size(7).flex_none().rounded(7).bg(PALETTE.warn))
                        .child(
                          div()
                            .flex_1()
                            .min_w(0)
                            .truncate()
                            .text_size(SIZES.xs)
                            .font_bold()
                            .text_color(PALETTE.text)
                            .child(titleText),
                        ),
                    )
                    .child(
                      div()
                        .pl(13)
                        .truncate()
                        .font_family(monoFont())
                        .text_size(SIZES.xs)
                        .text_color(PALETTE.mono)
                        .child(`${progName} · ${spaceLabel} · ${sinceLabel}`),
                    ),
                  h_flex()
                    .id(`ov-inspect-${a.address}`)
                    .flex_none()
                    .h(30)
                    .px(10)
                    .rounded(RADII.chip)
                    .bg(isPrimary ? PALETTE.accent : PALETTE.raised)
                    .border(1)
                    .border_color(isPrimary ? PALETTE.accent : PALETTE.lineStrong)
                    .items_center()
                    .justify_center()
                    .text_size(SIZES.xs)
                    .font_bold()
                    .text_color(isPrimary ? PALETTE.onAccent : PALETTE.text)
                    .cursor_pointer()
                    .hover((s) =>
                      s.bg(isPrimary ? PALETTE.accentHover : PALETTE.raisedHover),
                    )
                    .on_click(() => jump("agent.focus", { terminal: a.address }))
                    .child("Inspect"),
                ],
              });
            }),
          );

  return ui.card({
    id: "overview-approvals",
    padding: 16,
    gap: 10,
    children: [
      cardHead({
        ui,
        palette,
        icon: "approvals",
        iconTone: blocked.length > 0 ? "warn" : "normal",
        title: "Approvals",
        chipLabel: `${blocked.length} pending`,
        chipTone: blocked.length > 0 ? "warn" : "normal",
        moreId: "ov-approvals-more",
        onMore: (_e, cx) => onNavigate("approvals", cx),
      }),
      listBody,
      ...(hasDecisions
        ? [
            h_flex()
              .w_full()
              .pt(7)
              .border_t(1)
              .border_color(PALETTE.line)
              .items_center()
              .gap(5)
              .text_size(SIZES.xs)
              .text_color(PALETTE.muted)
              .child("Approved today:")
              .child(
                div()
                  .font_family(monoFont())
                  .font_bold()
                  .text_color(PALETTE.ok)
                  .child(String(decisions.approved)),
              )
              .child("· rejected:")
              .child(
                div()
                  .font_family(monoFont())
                  .font_bold()
                  .text_color(PALETTE.text)
                  .child(String(decisions.rejected)),
              ),
          ]
        : []),
    ],
  });
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
      return { color: PALETTE.muted, bg: PALETTE.offlineSoft, borderColor: PALETTE.offlineBorder };
  }
}

function buildSpacesCard({
  ui,
  palette,
  data,
  jump,
  maskPath,
  spacesList,
  agentsList,
  onNavigate,
}) {
  const { PALETTE, SIZES, RADII, monoFont, statusWord } = palette;
  const spaces = spacesList ?? [];
  const agentsBySpace = new Map();
  for (const a of agentsList ?? []) {
    if (!a?.space) continue;
    if (!agentsBySpace.has(a.space)) agentsBySpace.set(a.space, []);
    agentsBySpace.get(a.space).push(a);
  }

  const body =
    spaces.length === 0
      ? cardEmpty({
          ui,
          palette,
          icon: "spaces",
          title: "No open spaces",
          description: "Spaces you open in Herdr appear here.",
        })
      : v_flex()
          .w_full()
          .gap(6)
          .children(
            spaces.slice(0, 6).map((sp) => {
              const spaceAgents = agentsBySpace.get(sp.id) ?? [];
              const st = data.deriveSpaceStatus(sp, spaceAgents);
              const count = spaceAgents.length;
              const chipStyle = spaceChipStyle(PALETTE, st);

              return ui.miniRow({
                id: `ov-space-${sp.id}`,
                urgent: st === "blocked",
                px: 10,
                py: 6,
                gap: 8,
                onClick: () => jump("space.select", { id: sp.id }),
                children: [
                  div()
                    .w(104)
                    .flex_none()
                    .truncate()
                    .text_size(SIZES.sm)
                    .font_bold()
                    .text_color(PALETTE.text)
                    .child(maskPath(sp.name || "—")),
                  h_flex()
                    .flex_1()
                    .min_w(0)
                    .items_center()
                    .child(
                      sp.branch
                        ? h_flex()
                            .max_w(165)
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
                    ),
                  div()
                    .flex_none()
                    .font_family(monoFont())
                    .text_size(SIZES.xs)
                    .font_semibold()
                    .text_color(count > 0 ? PALETTE.mono : PALETTE.muted)
                    .whitespace_nowrap()
                    .child(countLabel(count, "agent")),
                  ui.chip({
                    label: statusWord(st),
                    dotStatus: st,
                    color: chipStyle.color,
                    bg: chipStyle.bg,
                    borderColor: chipStyle.borderColor,
                  }),
                ],
              });
            }),
          );

  return ui.card({
    id: "overview-spaces",
    padding: 16,
    gap: 12,
    children: [
      cardHead({
        ui,
        palette,
        icon: "spaces",
        title: "Spaces",
        chipLabel: `${spaces.length} project spaces`,
        moreId: "ov-spaces-more",
        onMore: (_e, cx) => onNavigate("spaces", cx),
      }),
      body,
    ],
  });
}

function buildPortsCard({
  ui,
  palette,
  maskHost,
  machinesList,
  collectEntries,
  onNavigate,
}) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const publicItems = [];
  const serverSummaries = [];
  const seenKeys = new Set();

  for (const entry of collectEntries) {
    const key = entry.machine === null ? "local" : String(entry.machine).toLowerCase();
    seenKeys.add(key);
    const res = entry?.result;
    const host =
      res?.system?.hostname ||
      res?.tailscale?.self?.name ||
      entry.machine ||
      "This computer";

    if (!res || !Array.isArray(res.ports)) {
      serverSummaries.push({
        key,
        host,
        unavailable: true,
        reason: entry?.error || "no port scan",
      });
      continue;
    }

    const serveList = tailscaleRoutes(res?.tailscale);
    let pub = 0;
    let tailnet = 0;
    let local = 0;

    for (const p of res.ports) {
      if (!p) continue;
      if (p.access === "public") {
        pub += 1;
        const funnelHit = serveList.find(
          (s) => s.funnel && (s.port === p.port || extractTargetPort(s.target) === p.port),
        );
        publicItems.push({
          id: `ov-pub-${key}-${p.port}-${p.pid ?? 0}`,
          host,
          port: p.port,
          funnelPort: funnelHit?.port ?? null,
          process: p.process || "—",
        });
      } else if (p.access === "tailnet") {
        tailnet += 1;
      } else if (p.access === "local") {
        local += 1;
      }
    }

    serverSummaries.push({
      key,
      host,
      unavailable: false,
      pub,
      tailnet,
      local,
    });
  }

  for (const m of machinesList ?? []) {
    if (!m) continue;
    const key = m.name === null ? "local" : String(m.name).toLowerCase();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    serverSummaries.push({
      key,
      host: m.name ?? "This computer",
      unavailable: true,
      reason: m.layout === "ready" ? "no port scan" : "unreachable · no port scan",
    });
  }

  const hasPortScan = serverSummaries.some((s) => !s.unavailable);
  const totalPublic = publicItems.length;
  const chipLabel = hasPortScan ? `${totalPublic} public` : "—";
  const chipTone = !hasPortScan ? "normal" : totalPublic > 0 ? "danger" : "ok";

  const body =
    serverSummaries.length === 0
      ? cardEmpty({
          ui,
          palette,
          icon: "ports",
          title: "Waiting for port data",
          description: "Open ports and access levels appear after the collector runs.",
        })
      : v_flex()
          .w_full()
          .gap(8)
          .when(totalPublic > 0, (el) =>
            el.children(
              publicItems.slice(0, 2).map((item) =>
                ui.miniRow({
                  id: item.id,
                  danger: true,
                  px: 10,
                  py: 7,
                  gap: 8,
                  onClick: (_e, cx) => onNavigate("ports", cx),
                  children: [
                    ui.iconOf("alert", 15, PALETTE.danger),
                    div()
                      .flex_1()
                      .min_w(0)
                      .truncate()
                      .font_family(monoFont())
                      .text_size(SIZES.xs)
                      .font_bold()
                      .text_color(PALETTE.text)
                      .child(
                        `${maskHost(item.host)} :${item.port}${
                          item.funnelPort ? ` → Funnel :${item.funnelPort}` : ""
                        } · ${maskText(item.process)}`,
                      ),
                    ui.chip({
                      label: "public",
                      color: PALETTE.onAccent,
                      bg: PALETTE.danger,
                      borderColor: PALETTE.danger,
                    }),
                  ],
                }),
              ),
            ),
          )
          .when(hasPortScan && totalPublic === 0, (el) =>
            el.child(
              h_flex()
                .w_full()
                .items_center()
                .gap(8)
                .px(10)
                .py(7)
                .rounded(RADII.inner)
                .bg(PALETTE.okSoft)
                .border(1)
                .border_color(PALETTE.okBorder)
                .child(div().size(7).flex_none().rounded(7).bg(PALETTE.ok))
                .child(
                  div()
                    .text_size(SIZES.xs)
                    .font_semibold()
                    .text_color(PALETTE.ok)
                    .child("No public ports"),
                ),
            ),
          )
          .child(
            v_flex()
              .w_full()
              .gap(6)
              .children(
                serverSummaries.slice(0, 5).map((srv) => {
                  if (srv.unavailable) {
                    return ui.miniRow({
                      id: `ov-port-srv-${srv.key}`,
                      px: 10,
                      py: 6,
                      gap: 10,
                      onClick: (_e, cx) => onNavigate("ports", cx),
                      children: [
                        div()
                          .w(122)
                          .flex_none()
                          .truncate()
                          .font_family(monoFont())
                          .text_size(SIZES.xs)
                          .font_semibold()
                          .text_color(PALETTE.muted)
                          .child(maskHost(srv.host)),
                        div()
                          .flex_1()
                          .min_w(0)
                          .truncate()
                          .font_family(monoFont())
                          .text_size(SIZES.xs)
                          .text_color(PALETTE.muted)
                          .child(srv.reason),
                      ],
                    });
                  }

                  const dots = [];
                  for (let i = 0; i < Math.min(srv.pub, 4); i++) dots.push(PALETTE.danger);
                  for (let i = 0; i < Math.min(srv.tailnet, 4) && dots.length < 6; i++) {
                    dots.push(PALETTE.accent);
                  }
                  for (let i = 0; i < Math.min(srv.local, 4) && dots.length < 6; i++) {
                    dots.push(PALETTE.muted);
                  }

                  return ui.miniRow({
                    id: `ov-port-srv-${srv.key}`,
                    px: 9,
                    py: 6,
                    gap: 6,
                    onClick: (_e, cx) => onNavigate("ports", cx),
                    children: [
                      div()
                        .w(122)
                        .flex_none()
                        .truncate()
                        .font_family(monoFont())
                        .text_size(SIZES.xs)
                        .font_semibold()
                        .text_color(PALETTE.text)
                        .child(maskHost(srv.host)),
                      h_flex()
                        .w(44)
                        .flex_none()
                        .items_center()
                        .gap(2)
                        .children(
                          dots.map((col) => div().size(5).flex_none().rounded(5).bg(col)),
                        ),
                      h_flex()
                        .flex_1()
                        .min_w(0)
                        .flex_wrap()
                        .items_center()
                        .gap(4)
                        .font_family(monoFont())
                        .text_size(SIZES.xs)
                        .child(
                          div()
                            .text_color(srv.pub > 0 ? PALETTE.danger : PALETTE.muted)
                            .when(srv.pub > 0, (e) => e.font_bold())
                            .whitespace_nowrap()
                            .child(`${srv.pub} public`),
                        )
                        .child(div().text_color(PALETTE.lineStrong).child("·"))
                        .child(
                          div()
                            .text_color(srv.tailnet > 0 ? PALETTE.mono : PALETTE.muted)
                            .whitespace_nowrap()
                            .child(`${srv.tailnet} tailnet`),
                        )
                        .child(div().text_color(PALETTE.lineStrong).child("·"))
                        .child(
                          div()
                            .text_color(PALETTE.muted)
                            .whitespace_nowrap()
                            .child(`${srv.local} local`),
                        ),
                    ],
                  });
                }),
              ),
          );

  return ui.card({
    id: "overview-ports",
    padding: 16,
    gap: 12,
    children: [
      cardHead({
        ui,
        palette,
        icon: "ports",
        iconTone: totalPublic > 0 ? "danger" : "normal",
        title: "Ports · risk",
        chipLabel,
        chipTone,
        moreId: "ov-ports-more",
        onMore: (_e, cx) => onNavigate("ports", cx),
      }),
      body,
    ],
  });
}

export function renderOverview({
  data,
  ui,
  palette,
  jump,
  maskHost,
  maskPath,
  activeRange,
  collectEntries = [],
  localEntry = null,
  machinesList,
  spacesList,
  agentsList,
  terminalsList,
  panesList,
  blockedSinceMap,
  narrow,
  onNavigate,
}) {
  const hero = buildHeroSection({
    data,
    ui,
    palette,
    jump,
    maskPath,
    spacesList,
    agentsList,
    terminalsList,
    panesList,
    collectEntries,
    narrow,
  });

  const usageCard = buildUsageCard({
    ui,
    palette,
    activeRange,
    collectEntries,
    onNavigate,
  });
  const machinesCard = buildMachinesCard({
    ui,
    palette,
    data,
    maskHost,
    machinesList,
    agentsList,
    localEntry,
    collectEntries,
    onNavigate,
  });
  const approvalsCard = buildApprovalsCard({
    ui,
    palette,
    jump,
    maskPath,
    agentsList,
    spacesList,
    blockedSinceMap,
    onNavigate,
  });
  const spacesCard = buildSpacesCard({
    ui,
    palette,
    data,
    jump,
    maskPath,
    spacesList,
    agentsList,
    onNavigate,
  });
  const portsCard = buildPortsCard({
    ui,
    palette,
    maskHost,
    machinesList,
    collectEntries,
    onNavigate,
  });

  const row2 = narrow
    ? v_flex()
        .w_full()
        .gap(14)
        .child(usageCard.w_full())
        .child(machinesCard.w_full())
        .child(approvalsCard.w_full())
    : h_flex()
        .w_full()
        .items_stretch()
        .gap(14)
        .child(usageCard.flex_1().min_w(0))
        .child(machinesCard.flex_1().min_w(0))
        .child(approvalsCard.flex_1().min_w(0));

  const row3 = narrow
    ? v_flex()
        .w_full()
        .gap(14)
        .child(spacesCard.w_full())
        .child(portsCard.w_full())
    : h_flex()
        .w_full()
        .items_stretch()
        .gap(14)
        .child(spacesCard.flex_1().min_w(0))
        .child(portsCard.flex_1().min_w(0));

  return v_flex().w_full().gap(14).child(hero).child(row2).child(row3);
}
