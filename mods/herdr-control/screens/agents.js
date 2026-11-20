// Screen 5: Agents — sub-tabs: Now, Usage, Catalog.

import { dashboardNow } from "../demo-mode.js";
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { renderAgentsNow } from "./agents-now.js";
import { renderAgentsUsage } from "./agents-usage.js";
import { renderAgentsCatalog } from "./agents-catalog.js";

export const AGENTS_TABS = ["now", "usage", "catalog"];

const TAB_ITEMS = [
  { id: "now", label: "Now" },
  { id: "usage", label: "Usage" },
  { id: "catalog", label: "Catalog" },
];

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const PROVIDER_DEFS = [
  { id: "claude", label: "Claude Code", installedKey: "claude", payment: "subscription" },
  { id: "opencode", label: "OpenCode", installedKey: "opencode", payment: "subscription" },
  { id: "antigravity", label: "Antigravity", installedKey: "agy", payment: "—" },
  { id: "codex", label: "Codex", installedKey: "codex", payment: "—" },
  { id: "pi", label: "Pi", installedKey: "pi", payment: "—" },
  { id: "gemini", label: "Gemini CLI", installedKey: "gemini", payment: "—" },
];

const TITLE_MODEL_PATTERNS = [
  { re: /\bopus\s*5\.5\b/i, format: () => "Opus 5.5" },
  { re: /\bopus\s*5\b/i, format: () => "Opus 5" },
  { re: /\bopus\s*4\.[678]\b/i, format: (m) => m[0].replace(/opus/i, "Opus") },
  { re: /\bsonnet\s*5\.5\b/i, format: () => "Sonnet 5.5" },
  { re: /\bsonnet\s*5\b/i, format: () => "Sonnet 5" },
  { re: /\bsonnet\s*4\.6\b/i, format: () => "Sonnet 4.6" },
  { re: /\bhaiku\s*[45]\.5\b/i, format: (m) => m[0].replace(/haiku/i, "Haiku") },
  { re: /\bdeepseek\s*v?4\.1(?:\s*flash)?\b/i, format: () => "DeepSeek V4.1" },
  { re: /\bgpt-?5\.3(?:\s*codex)?\b/i, format: (m) => m[0].toUpperCase() },
  { re: /\bgemini\s*4(?:\s*(?:argon|hydrogen))?\b/i, format: (m) => m[0] },
];

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

function dateRangeDays(count) {
  const out = [];
  const total = Math.max(1, Number(count) || 1);
  for (let i = total - 1; i >= 0; i--) {
    out.push(isoDateDaysAgo(i));
  }
  return out;
}

function formatShortDate(isoDate) {
  if (!isoDate || typeof isoDate !== "string") return "—";
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const monthIdx = Number(parts[1]) - 1;
  const dayNum = Number(parts[2]);
  const mon = MONTHS[monthIdx];
  if (!mon || !Number.isFinite(dayNum)) return isoDate;
  return `${String(dayNum).padStart(2, "0")} ${mon}`;
}

function formatRelativeDay(isoDate) {
  const today = localIsoDate();
  if (isoDate === today) return "Today";
  if (isoDate === isoDateDaysAgo(1)) return "Yesterday";
  return formatShortDate(isoDate);
}

function formatInt(n) {
  const num = Math.round(Number(n) || 0);
  const sign = num < 0 ? "-" : "";
  const s = String(Math.abs(num));
  return sign + s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatHours(seconds) {
  const hrs = (Number(seconds) || 0) / 3600;
  return hrs.toFixed(1);
}

function formatDurationMs(ms) {
  const totalMin = Math.max(0, Math.floor((Number(ms) || 0) / 60000));
  if (totalMin < 1) return "<1 min";
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
}

function formatUsd(usd) {
  const val = Number(usd) || 0;
  if (val === 0) return "0";
  if (val >= 100) return formatInt(Math.round(val));
  if (val >= 10) return val.toFixed(1);
  if (val >= 0.01) return val.toFixed(2);
  return "<0.01";
}

function machineFromAddress(address) {
  if (!address || typeof address !== "string") return null;
  const idx = address.indexOf("/");
  return idx === -1 ? null : address.slice(0, idx);
}

function resolveMachineName(machine, collectEntries) {
  if (machine != null && machine !== "" && machine !== "local") {
    return String(machine);
  }
  const localEntry = (collectEntries ?? []).find((e) => e && e.machine === null);
  return (
    localEntry?.result?.system?.hostname ||
    localEntry?.result?.tailscale?.self?.name ||
    "This computer"
  );
}

function extractModelFromTitle(title) {
  if (!title || typeof title !== "string") return "—";
  for (const pat of TITLE_MODEL_PATTERNS) {
    const m = title.match(pat.re);
    if (m) return pat.format(m);
  }
  return "—";
}

function buildHelpers(prices) {
  const priceList = Array.isArray(prices) ? prices : [];

  const findPriceRule = (model) => {
    if (!model || typeof model !== "string") return null;
    const norm = model.toLowerCase().replace(/\./g, "-");
    for (const rule of priceList) {
      if (rule && rule.match && norm.includes(rule.match)) return rule;
    }
    return null;
  };

  const estimateRowUsd = (row) => {
    const rule = findPriceRule(row?.model);
    if (!rule) return null;
    const input = Number(row?.input) || 0;
    const output = Number(row?.output) || 0;
    const cacheRead = Number(row?.cache_read) || 0;
    const cacheWrite = Number(row?.cache_write) || 0;
    const cacheReadPrice = typeof rule.cache_read === "number" ? rule.cache_read : 0.1 * rule.input;
    const cacheWritePrice = rule.input * 1.25;
    return (
      (input * rule.input +
        output * rule.output +
        cacheRead * cacheReadPrice +
        cacheWrite * cacheWritePrice) /
      1_000_000
    );
  };

  return {
    PROVIDER_DEFS,
    localIsoDate,
    isoDateDaysAgo,
    dateRangeDays,
    formatShortDate,
    formatRelativeDay,
    formatInt,
    formatHours,
    formatDurationMs,
    formatUsd,
    machineFromAddress,
    resolveMachineName,
    extractModelFromTitle,
    estimateRowUsd,
  };
}

function renderSubTabBar({ palette, activeTab, onAgentsTab, narrow }) {
  const { PALETTE, SIZES, RADII } = palette;

  const tabsPill = h_flex()
    .flex_none()
    .items_center()
    .p(3)
    .gap(3)
    .rounded(RADII.pill)
    .bg(PALETTE.surface)
    .border(1)
    .border_color(PALETTE.line)
    .children(
      TAB_ITEMS.map((tab) => {
        const active = activeTab === tab.id;
        return h_flex()
          .id(`agents-tab-${tab.id}`)
          .h(28)
          .px(12)
          .rounded(RADII.pill)
          .items_center()
          .justify_center()
          .cursor_pointer()
          .text_size(SIZES.xs)
          .font_bold()
          .whitespace_nowrap()
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
          .on_click((_e, cx) => onAgentsTab(tab.id, cx))
          .child(tab.label);
      }),
    );

  const catalogLegend = h_flex()
    .items_center()
    .flex_wrap()
    .gap(10)
    .text_size(SIZES.xs)
    .font_semibold()
    .text_color(PALETTE.muted)
    .child(
      h_flex()
        .items_center()
        .gap(5)
        .child(div().w(11).h(7).rounded(2).border(1).border_color(PALETTE.lineStrong))
        .child("dim = unavailable"),
    )
    .child("·")
    .child(
      h_flex()
        .items_center()
        .gap(5)
        .child(
          div()
            .w(11)
            .h(7)
            .rounded(2)
            .bg(PALETTE.warnSoft)
            .border(1)
            .border_color(PALETTE.warnBorder),
        )
        .child("amber = risk / approval"),
    );

  return h_flex()
    .id("agents-subbar")
    .w_full()
    .items_center()
    .justify_between()
    .flex_wrap()
    .gap(10)
    .child(tabsPill)
    .when(activeTab === "catalog" && !narrow, (el) => el.child(catalogLegend));
}

export function renderAgents({
  data,
  ui,
  palette,
  jump,
  maskHost,
  maskPath,
  prices,
  catalog,
  activeRange,
  agentsTab,
  onAgentsTab,
  machineFilter,
  onMachineFilter,
  healthChecks,
  onRunHealth,
  collectEntries,
  machinesList,
  spacesList,
  agentsList,
  terminalsList,
  panesList,
  narrow,
}) {
  const activeTab = AGENTS_TABS.includes(agentsTab) ? agentsTab : "now";
  const helpers = buildHelpers(prices);

  let body;
  if (activeTab === "usage") {
    body = renderAgentsUsage({
      ui,
      palette,
      maskHost,
      maskPath,
      activeRange,
      machineFilter: machineFilter || "all",
      onMachineFilter,
      collectEntries: collectEntries ?? [],
      helpers,
      narrow,
    });
  } else if (activeTab === "catalog") {
    body = renderAgentsCatalog({
      ui,
      palette,
      catalog,
      collectEntries: collectEntries ?? [],
      agentsList: agentsList ?? [],
      healthChecks: healthChecks ?? {},
      onRunHealth,
      helpers,
      narrow,
    });
  } else {
    body = renderAgentsNow({
      data,
      ui,
      palette,
      jump,
      maskHost,
      maskPath,
      collectEntries: collectEntries ?? [],
      machinesList: machinesList ?? [],
      spacesList: spacesList ?? [],
      agentsList: agentsList ?? [],
      terminalsList: terminalsList ?? [],
      panesList: panesList ?? [],
      helpers,
      narrow,
    });
  }

  return v_flex()
    .w_full()
    .gap(14)
    .child(renderSubTabBar({ palette, activeTab, onAgentsTab, narrow }))
    .child(body);
}
