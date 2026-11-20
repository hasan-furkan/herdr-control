// Screen 5, Sub-tab 2: Agents · Usage and Cost (Cost hero, daily bars, per-agent table, top projects, space share).

import { maskText } from "../mask.js";
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { countLabel, formatTokens, rowTokens } from "../data.js";

function providerColor(PALETTE, providerId) {
  switch (providerId) {
    case "claude":
      return PALETTE.accent;
    case "opencode":
      return PALETTE.mono;
    case "antigravity":
      return PALETTE.offline;
    case "codex":
      return PALETTE.lineHover;
    default:
      return PALETTE.muted;
  }
}

function providerLabel(providerId, helpers) {
  const def = helpers.PROVIDER_DEFS.find((d) => d.id === providerId);
  return def ? def.label : maskText(providerId || "Other", "Other");
}

function rangeDaysCount(activeRange) {
  if (activeRange === "Today") return 1;
  if (activeRange === "30 Days") return 30;
  return 14;
}

function rangeSubtitle(activeRange) {
  if (activeRange === "Today") return "today";
  if (activeRange === "30 Days") return "last 30 days";
  return "last 14 days";
}

function summarizeModels(modelTokenMap) {
  const entries = Array.from(modelTokenMap.entries()).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "—";
  return entries
    .slice(0, 2)
    .map(([m]) => m)
    .join(" · ");
}

function buildMachineFilterBar({
  ui,
  palette,
  maskHost,
  machineOptions,
  machineFilter,
  onMachineFilter,
  dateSpanLabel,
}) {
  const { PALETTE, SIZES, monoFont } = palette;

  return h_flex()
    .w_full()
    .items_center()
    .justify_between()
    .flex_wrap()
    .gap(8)
    .child(
      h_flex()
        .items_center()
        .flex_wrap()
        .gap(6)
        .child(
          div()
            .text_size(SIZES.xs)
            .font_semibold()
            .text_color(PALETTE.muted)
            .child("Machine:"),
        )
        .child(
          ui.chip({
            id: "usage-machine-all",
            label: "All",
            active: machineFilter === "all",
            onClick: (_e, cx) => onMachineFilter("all", cx),
          }),
        )
        .children(
          machineOptions.map((m) =>
            ui.chip({
              id: `usage-machine-${m.key}`,
              label: maskHost(m.label),
              mono: true,
              active: machineFilter === m.key,
              onClick: (_e, cx) => onMachineFilter(m.key, cx),
            }),
          ),
        ),
    )
    .child(
      div()
        .text_size(SIZES.xs)
        .font_family(monoFont())
        .text_color(PALETTE.mono)
        .child(dateSpanLabel),
    );
}

function buildCostHero({ palette, summary, helpers }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;

  const usdDisplay = summary.hasPriced
    ? helpers.formatUsd(summary.totalUsd)
    : "—";

  const methodParts = ["list price × tokens"];
  if (summary.hasTokens) {
    methodParts.push(formatTokens(summary.totalTokens, { estimated: summary.estimated }));
  }
  if (summary.hasPriced && summary.hasUnpriced) {
    methodParts.push("known models");
  }

  return v_flex()
    .id("usage-cost-hero")
    .rounded(RADII.card)
    .bg(PALETTE.heroBg)
    .text_color(PALETTE.heroText)
    .border(1)
    .border_color(PALETTE.lineStrong)
    .p(18)
    .gap(14)
    .justify_between()
    .child(
      h_flex()
        .w_full()
        .items_center()
        .justify_between()
        .gap(8)
        .child(
          div()
            .text_size(SIZES.xs)
            .font_bold()
            .text_color(PALETTE.heroMuted)
            .child("ESTIMATED API COST"),
        )
        .child(
          div()
            .px(9)
            .py(2)
            .rounded(RADII.pill)
            .bg(PALETTE.onAccentSoft)
            .border(1)
            .border_color(PALETTE.onAccentBorder)
            .text_size(SIZES.xs)
            .font_bold()
            .text_color(PALETTE.heroMuted)
            .child("estimate"),
        ),
    )
    .child(
      h_flex()
        .w_full()
        .items_end()
        .justify_between()
        .flex_wrap()
        .gap(12)
        .child(
          h_flex()
            .items_baseline()
            .gap(6)
            .when(summary.hasPriced, (el) =>
              el.child(
                div()
                  .text_size(SIZES.stat)
                  .font_bold()
                  .font_family(monoFont())
                  .text_color(PALETTE.heroMuted)
                  .child("≈"),
              ),
            )
            .child(
              div()
                .text_size(52)
                .font_bold()
                .font_family(monoFont())
                .text_color(PALETTE.heroText)
                .child(usdDisplay),
            )
            .when(summary.hasPriced, (el) =>
              el.child(
                div()
                  .text_size(SIZES.stat)
                  .font_bold()
                  .font_family(monoFont())
                  .text_color(PALETTE.heroMuted)
                  .child("$"),
              ),
            ),
        )
        .child(
          v_flex()
            .px(12)
            .py(8)
            .gap(2)
            .rounded(RADII.inner)
            .bg(PALETTE.onAccentSoft)
            .border(1)
            .border_color(PALETTE.onAccentBorder)
            .child(
              div()
                .text_size(SIZES.xs)
                .font_semibold()
                .text_color(PALETTE.heroMuted)
                .child("covered by subscription"),
            )
            .child(
              div()
                .text_size(SIZES.lg)
                .font_bold()
                .font_family(monoFont())
                .text_color(PALETTE.heroText)
                .child("—"),
            ),
        ),
    )
    .child(
      div()
        .pt(8)
        .border_t(1)
        .border_color(PALETTE.heroLine)
        .text_size(SIZES.xs)
        .font_semibold()
        .text_color(PALETTE.heroMuted)
        .child(methodParts.join(" · ")),
    );
}

function buildDailyChartCard({ ui, palette, days, dailyByDate, totalTokens, estimated, hasUsage, helpers }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const chartProviders = ["claude", "opencode", "antigravity", "codex"];
  const BAR_AREA_H = 104;

  let maxDayTokens = 0;
  for (const d of days) {
    const bucket = dailyByDate.get(d);
    if (!bucket) continue;
    const sum = chartProviders.reduce((s, p) => s + (bucket.get(p) ?? 0), 0);
    if (sum > maxDayTokens) maxDayTokens = sum;
  }

  const head = h_flex()
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
            .child("Daily Token Usage"),
        ),
    )
    .child(
      h_flex()
        .items_center()
        .flex_wrap()
        .gap(8)
        .children(
          chartProviders.map((p) =>
            h_flex()
              .items_center()
              .gap(5)
              .text_size(SIZES.xs)
              .font_semibold()
              .text_color(PALETTE.mono)
              .child(div().size(9).rounded(3).bg(providerColor(PALETTE, p)))
              .child(p === "antigravity" && estimated ? "Antigravity (estimated)" : providerLabel(p, helpers)),
          ),
        )
        .child(
          ui.chip({
            label: formatTokens(hasUsage ? totalTokens : null, { estimated }),
            mono: true,
            color: PALETTE.mono,
          }),
        ),
    );

  let body;
  if (!hasUsage) {
    body = ui.emptyState({
      icon: "overview",
      title: "Waiting for token data",
      description: "Daily token usage appears after the collector runs.",
    });
  } else if (maxDayTokens <= 0) {
    body = ui.emptyState({
      icon: "overview",
      title: "No token usage in this range",
      description: "No token usage for the selected dates and machines.",
    });
  } else {
    const barColumns = days.map((d, idx) => {
      const bucket = dailyByDate.get(d);
      const segments = [];
      let dayTotal = 0;
      for (const p of chartProviders) {
        const tok = bucket?.get(p) ?? 0;
        dayTotal += tok;
      }

      // Build segments top-to-bottom so claude sits at the bottom.
      for (let i = chartProviders.length - 1; i >= 0; i--) {
        const p = chartProviders[i];
        const tok = bucket?.get(p) ?? 0;
        if (tok <= 0) continue;
        const segH = Math.max(2, Math.round((tok / maxDayTokens) * BAR_AREA_H));
        segments.push(
          div()
            .w_full()
            .h(segH)
            .bg(providerColor(PALETTE, p)),
        );
      }

      const isToday = idx === days.length - 1;
      return v_flex()
        .id(`daily-bar-${d}`)
        .flex_1()
        .min_w(days.length > 20 ? 6 : 14)
        .max_w(44)
        .h(BAR_AREA_H)
        .justify_end()
        .tooltip(`${helpers.formatShortDate(d)}: ${formatTokens(dayTotal, { estimated: (bucket?.get("antigravity") ?? 0) > 0 })}`)
        .when(segments.length === 0, (el) =>
          el.child(div().w_full().h(2).rounded(1).bg(PALETTE.line)),
        )
        .when(segments.length > 0, (el) =>
          el.child(
            v_flex()
              .w_full()
              .rounded(3)
              .overflow_hidden()
              .when(isToday, (b) => b.border(1).border_color(PALETTE.ok))
              .children(segments),
          ),
        );
    });

    const tickIdxs =
      days.length === 1
        ? [0]
        : days.length <= 14
          ? [0, Math.floor(days.length / 2), days.length - 1]
          : [0, 7, 14, 21, days.length - 1];

    body = v_flex()
      .w_full()
      .gap(6)
      .child(
        h_flex()
          .w_full()
          .items_stretch()
          .gap(8)
          .child(
            v_flex()
              .w(54)
              .flex_none()
              .h(BAR_AREA_H)
              .justify_between()
              .items_end()
              .text_size(SIZES.xs)
              .font_family(monoFont())
              .text_color(PALETTE.muted)
              .child(formatTokens(maxDayTokens, { unit: false }))
              .child(formatTokens(maxDayTokens / 2, { unit: false }))
              .child("0"),
          )
          .child(
            h_flex()
              .flex_1()
              .min_w(0)
              .h(BAR_AREA_H)
              .items_end()
              .gap(days.length > 20 ? 3 : 6)
              .pb(1)
              .border_b(1)
              .border_color(PALETTE.lineStrong)
              .children(barColumns),
          ),
      )
      .child(
        h_flex()
          .w_full()
          .gap(8)
          .child(div().w(54).flex_none())
          .child(
            h_flex()
              .flex_1()
              .justify_between()
              .text_size(SIZES.xs)
              .font_family(monoFont())
              .children(
                tickIdxs.map((i, k) => {
                  const isLast = k === tickIdxs.length - 1;
                  return div()
                    .when(isLast, (el) => el.font_bold().text_color(PALETTE.text))
                    .when(!isLast, (el) => el.text_color(PALETTE.muted))
                    .child(helpers.formatShortDate(days[i]));
                }),
              ),
          ),
      );
  }

  return ui.card({
    id: "usage-daily-chart",
    padding: 16,
    gap: 12,
    children: [head, body],
  });
}

function buildPerAgentTable({
  ui,
  palette,
  maskHost,
  agentRows,
  activeCount,
  unusedCount,
  totalSessions,
  activeRange,
  hasUsage,
  helpers,
}) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;

  const head = h_flex()
    .w_full()
    .items_center()
    .justify_between()
    .flex_wrap()
    .gap(8)
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
            .child(ui.iconOf("agents", 15, PALETTE.text)),
        )
        .child(
          div()
            .text_size(SIZES.title)
            .font_bold()
            .text_color(PALETTE.text)
            .child("Usage and Cost by Agent"),
        )
        .child(
          div()
            .pl(8)
            .border_l(1)
            .border_color(PALETTE.lineStrong)
            .text_size(SIZES.xs)
            .font_family(monoFont())
            .text_color(PALETTE.mono)
            .child(`${rangeSubtitle(activeRange)} · ${countLabel(totalSessions, "session")}`),
        ),
    )
    .child(
      ui.chip({
        label: `${activeCount} active · ${unusedCount} never used`,
        mono: true,
        color: PALETTE.mono,
      }),
    );

  let body;
  if (!hasUsage && agentRows.length === 0) {
    body = ui.emptyState({
      icon: "agents",
      title: "Waiting for usage data",
      description: "Usage and cost by agent appear after the collector runs.",
    });
  } else {
    const showMachineCol = agentRows.some((r) => r.machines.length > 1) ||
      new Set(agentRows.flatMap((r) => r.machines)).size > 1;

    const colHeader = h_flex()
      .w_full()
      .px(8)
      .pb(5)
      .gap(6)
      .border_b(1)
      .border_color(PALETTE.lineStrong)
      .text_size(SIZES.xs)
      .font_bold()
      .text_color(PALETTE.muted)
      .child(div().w(104).flex_none().child("Agent"))
      .when(showMachineCol, (el) => el.child(div().w(90).flex_none().child("Machine")))
      .child(div().flex_1().min_w(140).child("Model"))
      .child(div().w(58).flex_none().text_right().child("Input"))
      .child(div().w(58).flex_none().text_right().child("Output"))
      .child(div().w(66).flex_none().text_right().child("Cache"))
      .child(div().w(48).flex_none().text_right().child("Sessions"))
      .child(div().w(70).flex_none().text_right().child("Total tokens"))
      .child(div().w(72).flex_none().text_right().child("API estimate"))
      .child(div().w(78).flex_none().text_right().child("Payment"));

    const rowsEl = agentRows.map((r) => {
      const isUnused = r.unused;
      const machineText =
        r.machines.length === 0
          ? "—"
          : r.machines.length === 1
            ? maskHost(r.machines[0])
            : `${maskHost(r.machines[0])} +${r.machines.length - 1}`;

      const estimateText = r.hasPriced ? `≈ $${helpers.formatUsd(r.usd)}` : "—";
      const modelDisplay = isUnused ? "installed" : maskText(r.modelsText);

      const isSubscription = r.payment === "subscription";
      const paymentBg = isSubscription ? PALETTE.accentSoft : PALETTE.offlineSoft;
      const paymentBorder = isSubscription ? PALETTE.accentBorder : PALETTE.offlineBorder;
      const paymentColor = isSubscription ? PALETTE.text : PALETTE.muted;

      return h_flex()
        .id(`usage-agent-row-${r.id}`)
        .w_full()
        .px(8)
        .py(7)
        .gap(6)
        .items_center()
        .rounded(RADII.chip)
        .bg(isUnused ? PALETTE.surfaceDark : PALETTE.rowBg)
        .border(1)
        .when(isUnused, (el) => el.border_dashed().border_color(PALETTE.offlineBorder))
        .when(!isUnused, (el) => el.border_color(PALETTE.line))
        .child(
          h_flex()
            .w(104)
            .flex_none()
            .items_center()
            .gap(7)
            .child(
              isUnused
                ? div().size(8).flex_none().rounded(8).border(1.5).border_color(PALETTE.offline)
                : div().size(8).flex_none().rounded(3).bg(providerColor(PALETTE, r.id)),
            )
            .child(
              div()
                .min_w(0)
                .truncate()
                .text_size(SIZES.sm)
                .font_bold()
                .text_color(isUnused ? PALETTE.muted : PALETTE.text)
                .when(r.estimated, (el) => el.tooltip("Estimated Antigravity tokens"))
                .child(r.label),
            ),
        )
        .when(showMachineCol, (el) =>
          el.child(
            div()
              .w(90)
              .flex_none()
              .truncate()
              .text_size(SIZES.xs)
              .font_family(monoFont())
              .text_color(PALETTE.mono)
              .child(machineText),
          ),
        )
        .child(
          div()
            .flex_1()
            .min_w(140)
            .truncate()
            .text_size(SIZES.xs)
            .font_family(monoFont())
            .text_color(isUnused ? PALETTE.muted : PALETTE.mono)
            .child(modelDisplay),
        )
        .when(isUnused, (el) =>
          el.child(
            div()
              .w(58 + 6 + 58 + 6 + 66 + 6 + 48 + 6 + 70)
              .flex_none()
              .text_center()
              .text_size(SIZES.xs)
              .font_family(monoFont())
              .text_color(PALETTE.muted)
              .child("0 · never used"),
          ),
        )
        .when(!isUnused, (el) =>
          el
            .child(
              div()
                .w(58)
                .flex_none()
                .text_right()
                .text_size(SIZES.xs)
                .font_family(monoFont())
                .font_semibold()
                .text_color(PALETTE.mono)
                .child(formatTokens(r.input, { estimated: r.estimated, unit: false })),
            )
            .child(
              div()
                .w(58)
                .flex_none()
                .text_right()
                .text_size(SIZES.xs)
                .font_family(monoFont())
                .font_semibold()
                .text_color(PALETTE.mono)
                .child(formatTokens(r.output, { estimated: r.estimated, unit: false })),
            )
            .child(
              div()
                .w(66)
                .flex_none()
                .text_right()
                .text_size(SIZES.xs)
                .font_family(monoFont())
                .font_semibold()
                .text_color(PALETTE.mono)
                .child(formatTokens(r.cacheRead, { estimated: r.estimated, unit: false })),
            )
            .child(
              div()
                .w(48)
                .flex_none()
                .text_right()
                .text_size(SIZES.xs)
                .font_family(monoFont())
                .font_semibold()
                .text_color(PALETTE.mono)
                .child(String(r.sessions)),
            )
            .child(
              div()
                .w(70)
                .flex_none()
                .text_right()
                .text_size(SIZES.xs)
                .font_family(monoFont())
                .font_semibold()
                .text_color(PALETTE.text)
                .child(formatTokens(r.totalTokens, { estimated: r.estimated, unit: false })),
            ),
        )
        .child(
          div()
            .w(72)
            .flex_none()
            .text_right()
            .text_size(SIZES.xs)
            .font_family(monoFont())
            .font_bold()
            .text_color(r.hasPriced ? PALETTE.text : PALETTE.muted)
            .child(estimateText),
        )
        .child(
          h_flex()
            .w(78)
            .flex_none()
            .justify_end()
            .child(
              ui.chip({
                label: isSubscription ? "subscription" : r.payment,
                color: paymentColor,
                bg: paymentBg,
                borderColor: paymentBorder,
                h: 22,
                px: 8,
              }),
            ),
        );
    });

    body = div()
      .id("usage-agents-scroll")
      .w_full()
      .overflow_x_scrollbar()
      .child(
        v_flex()
          .w_full()
          .min_w(showMachineCol ? 856 : 760)
          .gap(4)
          .child(colHeader)
          .children(rowsEl),
      );
  }

  return ui.card({
    id: "usage-agents-table",
    padding: 16,
    gap: 12,
    children: [head, body],
  });
}

function buildTopProjectsCard({ ui, palette, maskHost, maskPath, topJobs, hasUsage, helpers }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const topSum = topJobs.reduce((s, j) => s + j.tokens, 0);

  const head = h_flex()
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
            .bg(PALETTE.raised)
            .border(1)
            .border_color(PALETTE.lineStrong)
            .items_center()
            .justify_center()
            .child(ui.iconOf("spaces", 15, PALETTE.text)),
        )
        .child(
          div()
            .text_size(SIZES.title)
            .font_bold()
            .text_color(PALETTE.text)
            .child("Activity"),
        )
        .child(
          div()
            .pl(8)
            .border_l(1)
            .border_color(PALETTE.lineStrong)
            .text_size(SIZES.xs)
            .font_family(monoFont())
            .text_color(PALETTE.mono)
            .child("top 6 projects by token usage"),
        ),
    )
    .child(
      ui.chip({
        label: topJobs.length > 0 ? `${formatTokens(topSum, { estimated: topJobs.some((job) => job.estimated) })} · top ${topJobs.length}` : "—",
        mono: true,
        color: PALETTE.mono,
      }),
    );

  const body =
    !hasUsage || topJobs.length === 0
      ? ui.emptyState({
          icon: "spaces",
          title: "No project usage",
          description: "No project token usage for this range.",
        })
      : v_flex()
          .w_full()
          .gap(6)
          .children(
            topJobs.map((j, idx) =>
              h_flex()
                .id(`usage-job-${idx}`)
                .w_full()
                .px(10)
                .py(7)
                .gap(8)
                .items_center()
                .rounded(RADII.chip)
                .bg(PALETTE.rowBg)
                .border(1)
                .border_color(PALETTE.line)
                .child(
                  div()
                    .w(128)
                    .flex_none()
                    .px(7)
                    .py(2)
                    .rounded(6)
                    .bg(PALETTE.raised)
                    .border(1)
                    .border_color(PALETTE.lineStrong)
                    .truncate()
                    .text_size(SIZES.xs)
                    .font_family(monoFont())
                    .font_semibold()
                    .text_color(PALETTE.text)
                    .child(maskPath(j.project || "—")),
                )
                .child(
                  div()
                    .flex_1()
                    .min_w(60)
                    .truncate()
                    .text_size(SIZES.xs)
                    .font_family(monoFont())
                    .text_color(PALETTE.muted)
                    .child(maskHost(j.machine)),
                )
                .child(
                  div()
                    .w(96)
                    .flex_none()
                    .text_right()
                    .truncate()
                    .text_size(SIZES.xs)
                    .font_semibold()
                    .text_color(PALETTE.mono)
                    .child(providerLabel(j.provider, helpers)),
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
                    .child(formatTokens(j.tokens, { estimated: j.estimated, unit: false })),
                )
                .child(
                  div()
                    .w(76)
                    .flex_none()
                    .text_right()
                    .text_size(SIZES.xs)
                    .font_family(monoFont())
                    .font_bold()
                    .text_color(j.hasPriced ? PALETTE.text : PALETTE.muted)
                    .child(j.hasPriced ? `≈ $${helpers.formatUsd(j.usd)}` : "—"),
                ),
            ),
          );

  return ui.card({
    id: "usage-top-jobs",
    padding: 16,
    gap: 12,
    children: [head, body],
  });
}

function buildSpaceShareCard({ ui, palette, maskPath, projectShares, totalTokens, estimated, hasUsage }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const shareColors = [
    PALETTE.heroBg,
    PALETTE.mono,
    PALETTE.muted,
    PALETTE.offline,
    PALETTE.lineHover,
    PALETTE.raisedHover,
  ];

  const head = ui.cardTitleRow({
    icon: "overview",
    title: "Share by Space",
    meta: countLabel(projectShares.length, "space"),
  });

  let body;
  if (!hasUsage || projectShares.length === 0 || totalTokens <= 0) {
    body = ui.emptyState({
      icon: "overview",
      title: "No share data",
      description: "No tokens to calculate project shares for this range.",
    });
  } else {
    const topItems = projectShares.slice(0, 6);
    const stackedSegments = topItems.map((item, idx) => {
      const pct = Math.max(2, (item.tokens / totalTokens) * 100);
      return div()
        .h_full()
        .w(`${pct.toFixed(1)}%`)
        .bg(shareColors[idx % shareColors.length]);
    });

    body = v_flex()
      .w_full()
      .gap(12)
      .child(
        v_flex()
          .w_full()
          .gap(6)
          .child(
            h_flex()
              .w_full()
              .items_baseline()
              .justify_between()
              .child(
                div()
                  .text_size(SIZES.lg)
                  .font_bold()
                  .font_family(monoFont())
                  .text_color(PALETTE.text)
                  .child(formatTokens(totalTokens, { estimated })),
              )
              .child(
                div()
                  .text_size(SIZES.xs)
                  .text_color(PALETTE.muted)
                  .child(`top ${countLabel(topItems.length, "space")}`),
              ),
          )
          .child(
            h_flex()
              .w_full()
              .h(12)
              .gap(2)
              .rounded(RADII.pill)
              .overflow_hidden()
              .bg(PALETTE.track)
              .children(stackedSegments),
          ),
      )
      .child(
        v_flex()
          .w_full()
          .gap(8)
          .children(
            topItems.map((item, idx) => {
              const pct = Math.round((item.tokens / totalTokens) * 100);
              const color = shareColors[idx % shareColors.length];
              return v_flex()
                .id(`share-${idx}`)
                .w_full()
                .gap(4)
                .child(
                  h_flex()
                    .w_full()
                    .items_center()
                    .gap(8)
                    .child(div().size(9).flex_none().rounded(3).bg(color))
                    .child(
                      div()
                        .flex_1()
                        .min_w(0)
                        .truncate()
                        .text_size(SIZES.xs)
                        .font_family(monoFont())
                        .font_semibold()
                        .text_color(PALETTE.text)
                        .child(maskPath(item.project || "—")),
                    )
                    .child(
                      div()
                        .w(38)
                        .flex_none()
                        .text_right()
                        .text_size(SIZES.xs)
                        .font_family(monoFont())
                        .text_color(PALETTE.muted)
                        .child(`${pct}%`),
                    )
                    .child(
                      div()
                        .w(68)
                        .flex_none()
                        .text_right()
                        .text_size(SIZES.xs)
                        .font_family(monoFont())
                        .font_bold()
                        .text_color(PALETTE.mono)
                        .child(formatTokens(item.tokens, { estimated: item.estimated, unit: false })),
                    ),
                )
                .child(
                  ui.horizontalBar({
                    ratio: item.tokens / totalTokens,
                    height: 5,
                    color,
                  }),
                );
            }),
          ),
      );
  }

  return ui.card({
    id: "usage-space-share",
    padding: 16,
    gap: 12,
    children: [head, body],
  });
}

export function renderAgentsUsage({
  ui,
  palette,
  maskHost,
  maskPath,
  activeRange,
  machineFilter,
  onMachineFilter,
  collectEntries,
  helpers,
  narrow,
}) {
  const daysCount = rangeDaysCount(activeRange);
  const days = helpers.dateRangeDays(daysCount);
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const daySet = new Set(days);
  const dateSpanLabel =
    days.length === 1
      ? helpers.formatShortDate(firstDay)
      : `${helpers.formatShortDate(firstDay)} – ${helpers.formatShortDate(lastDay)}`;

  // Build machine list from collector entries.
  const machineOptions = [];
  for (const entry of collectEntries) {
    const key = entry.machine === null ? "local" : String(entry.machine);
    const label = helpers.resolveMachineName(entry.machine, collectEntries);
    machineOptions.push({ key, label });
  }

  const filteredEntries =
    machineFilter === "all"
      ? collectEntries
      : collectEntries.filter((e) => (e.machine === null ? "local" : String(e.machine)) === machineFilter);

  let hasUsage = false;
  let totalTokens = 0;
  let estimated = false;
  let totalUsd = 0;
  let hasPriced = false;
  let hasUnpriced = false;
  let totalSessions = 0;

  const installedMap = new Map();
  const dailyByDate = new Map();
  const byProvider = new Map();
  const byJob = new Map();
  const byProject = new Map();

  for (const entry of filteredEntries) {
    const res = entry?.result;
    if (!res) continue;
    const machLabel = helpers.resolveMachineName(entry.machine, collectEntries);

    if (res.installed && typeof res.installed === "object") {
      for (const def of helpers.PROVIDER_DEFS) {
        if (res.installed[def.installedKey] === true) {
          installedMap.set(def.id, true);
        }
      }
    }

    if (Array.isArray(res.usage?.days)) {
      hasUsage = true;
      for (const row of res.usage.days) {
        if (!row || !daySet.has(row.date)) continue;
        const p = row.provider || "other";
        const inp = Number(row.input) || 0;
        const out = Number(row.output) || 0;
        const cr = Number(row.cache_read) || 0;
        const sess = Number(row.sessions) || 0;
        const rowTok = rowTokens(row);
        if (p === "antigravity" && rowTok === 0) continue;
        const isEst = rowTok > 0 && Boolean(row.estimated || p === "antigravity");
        const rowUsd = helpers.estimateRowUsd(row);

        totalTokens += rowTok;
        estimated ||= isEst;
        totalSessions += sess;
        if (rowUsd !== null) {
          totalUsd += rowUsd;
          hasPriced = true;
        } else if (rowTok > 0) {
          hasUnpriced = true;
        }

        // Daily stacked bars
        if (!dailyByDate.has(row.date)) dailyByDate.set(row.date, new Map());
        const dProv = dailyByDate.get(row.date);
        dProv.set(p, (dProv.get(p) ?? 0) + rowTok);

        // Per-provider aggregation
        if (!byProvider.has(p)) {
          byProvider.set(p, {
            id: p,
            label: providerLabel(p, helpers),
            payment: helpers.PROVIDER_DEFS.find((d) => d.id === p)?.payment ?? "—",
            models: new Map(),
            machines: new Set(),
            input: 0,
            output: 0,
            cacheRead: 0,
            sessions: 0,
            estimated: false,
            usd: 0,
            hasPriced: false,
            totalTokens: 0,
          });
        }
        const pAgg = byProvider.get(p);
        pAgg.input += inp;
        pAgg.output += out;
        pAgg.cacheRead += cr;
        pAgg.sessions += sess;
        if (isEst) pAgg.estimated = true;
        pAgg.totalTokens += rowTok;
        pAgg.machines.add(machLabel);
        if (row.model) {
          pAgg.models.set(row.model, (pAgg.models.get(row.model) ?? 0) + rowTok);
        }
        if (rowUsd !== null) {
          pAgg.usd += rowUsd;
          pAgg.hasPriced = true;
        }

        // Top projects ("Activity")
        const projName = row.project || "—";
        const jobKey = `${projName}::${p}::${machLabel}`;
        if (!byJob.has(jobKey)) {
          byJob.set(jobKey, {
            project: projName,
            provider: p,
            machine: machLabel,
            tokens: 0,
            estimated: false,
            usd: 0,
            hasPriced: false,
          });
        }
        const jAgg = byJob.get(jobKey);
        jAgg.tokens += rowTok;
        jAgg.estimated ||= isEst;
        if (rowUsd !== null) {
          jAgg.usd += rowUsd;
          jAgg.hasPriced = true;
        }

        // Space share ("Share by Space")
        const share = byProject.get(projName) ?? { project: projName, tokens: 0, estimated: false };
        share.tokens += rowTok;
        share.estimated ||= isEst;
        byProject.set(projName, share);
      }
    }
  }

  const agentRows = [];
  const seenProv = new Set();
  for (let i = 0; i < helpers.PROVIDER_DEFS.length; i++) {
    const def = helpers.PROVIDER_DEFS[i];
    seenProv.add(def.id);
    const agg = byProvider.get(def.id);
    if (agg && (agg.totalTokens > 0 || agg.sessions > 0)) {
      agentRows.push({
        id: def.id,
        label: def.label,
        machines: Array.from(agg.machines),
        modelsText: summarizeModels(agg.models),
        input: agg.input,
        output: agg.output,
        cacheRead: agg.cacheRead,
        sessions: agg.sessions,
        estimated: agg.estimated,
        usd: agg.usd,
        hasPriced: agg.hasPriced,
        payment: def.payment,
        totalTokens: agg.totalTokens,
        unused: false,
        order: i,
      });
    } else if (installedMap.get(def.id) === true) {
      agentRows.push({
        id: def.id,
        label: def.label,
        machines: [],
        modelsText: "installed",
        input: 0,
        output: 0,
        cacheRead: 0,
        sessions: 0,
        estimated: false,
        usd: 0,
        hasPriced: false,
        payment: def.payment,
        totalTokens: 0,
        unused: true,
        order: i,
      });
    }
  }

  for (const [p, agg] of byProvider.entries()) {
    if (seenProv.has(p)) continue;
    agentRows.push({
      id: p,
      label: agg.label,
      machines: Array.from(agg.machines),
      modelsText: summarizeModels(agg.models),
      input: agg.input,
      output: agg.output,
      cacheRead: agg.cacheRead,
      sessions: agg.sessions,
      estimated: agg.estimated,
      usd: agg.usd,
      hasPriced: agg.hasPriced,
      payment: agg.payment,
      totalTokens: agg.totalTokens,
      unused: false,
      order: 99,
    });
  }

  agentRows.sort((a, b) => {
    if (a.unused !== b.unused) return a.unused ? 1 : -1;
    return b.totalTokens - a.totalTokens || a.order - b.order;
  });

  const activeCount = agentRows.filter((r) => !r.unused).length;
  const unusedCount = agentRows.filter((r) => r.unused).length;

  const topJobs = Array.from(byJob.values())
    .filter((j) => j.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 6);

  const projectShares = Array.from(byProject.values())
    .filter((p) => p.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);

  const heroCard = buildCostHero({
    palette,
    summary: {
      totalUsd,
      totalTokens,
      hasTokens: totalTokens > 0,
      estimated,
      hasPriced,
      hasUnpriced,
    },
    helpers,
  });

  const dailyCard = buildDailyChartCard({
    ui,
    palette,
    days,
    dailyByDate,
    totalTokens,
    estimated,
    hasUsage,
    helpers,
  });

  const row1 = narrow
    ? v_flex().w_full().gap(12).child(heroCard).child(dailyCard)
    : h_flex()
        .w_full()
        .items_stretch()
        .gap(12)
        .child(heroCard.w(370).flex_none())
        .child(dailyCard.flex_1().min_w(0));

  const jobsCard = buildTopProjectsCard({
    ui,
    palette,
    maskHost,
    maskPath,
    topJobs,
    hasUsage,
    helpers,
  });

  const shareCard = buildSpaceShareCard({
    ui,
    palette,
    maskPath,
    projectShares,
    totalTokens,
    estimated,
    hasUsage,
  });

  const row3 = narrow
    ? v_flex().w_full().gap(12).child(jobsCard).child(shareCard)
    : h_flex()
        .w_full()
        .items_stretch()
        .gap(12)
        .child(jobsCard.flex_1().min_w(0))
        .child(shareCard.w(390).flex_none());

  return v_flex()
    .w_full()
    .gap(14)
    .when(machineOptions.length > 0, (el) =>
      el.child(
        buildMachineFilterBar({
          ui,
          palette,
          maskHost,
          machineOptions,
          machineFilter,
          onMachineFilter,
          dateSpanLabel,
        }),
      ),
    )
    .child(row1)
    .child(
      buildPerAgentTable({
        ui,
        palette,
        maskHost,
        agentRows,
        activeCount,
        unusedCount,
        totalSessions,
        activeRange,
        hasUsage,
        helpers,
      }),
    )
    .child(row3);
}
