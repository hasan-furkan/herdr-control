// Screen 5, Sub-tab 3: Agents · Catalog (definition + live state + <cmd> --version health check).

import { isStreaming, maskError, maskProgram, maskText } from "../mask.js";
import { countLabel, rowTokens } from "../data.js";
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

function permChip(PALETTE, SIZES, label, variant) {
  let color = PALETTE.text;
  let bg = PALETTE.rowHover;
  let border = PALETTE.lineStrong;

  if (variant === "absent") {
    color = PALETTE.muted;
    bg = PALETTE.transparent;
    border = PALETTE.line;
  } else if (variant === "risky") {
    color = PALETTE.warn;
    bg = PALETTE.warnSoft;
    border = PALETTE.warnBorder;
  } else if (variant === "guarded") {
    color = PALETTE.warn;
    bg = PALETTE.transparent;
    border = PALETTE.warnBorder;
  }

  return div()
    .px(6)
    .py(2)
    .rounded(5)
    .bg(bg)
    .border(1)
    .border_color(border)
    .text_size(SIZES.xs)
    .font_semibold()
    .text_color(color)
    .whitespace_nowrap()
    .child(label);
}

function capChip(PALETTE, SIZES, label, planned) {
  return div()
    .px(6)
    .py(2)
    .rounded(5)
    .bg(planned ? PALETTE.transparent : PALETTE.rowBg)
    .border(1)
    .border_color(PALETTE.line)
    .text_size(SIZES.xs)
    .font_semibold()
    .text_color(planned ? PALETTE.muted : PALETTE.text)
    .whitespace_nowrap()
    .child(label);
}

function healthButton({ PALETTE, SIZES, RADII, id, label, running = false, error = false, disabled = false, onClick }) {
  const bg = error ? PALETTE.dangerSoft : PALETTE.raised;
  const border = error ? PALETTE.dangerBorder : PALETTE.lineStrong;
  const color = disabled ? PALETTE.muted : error ? PALETTE.danger : PALETTE.text;
  const hoverBg = error ? PALETTE.dangerSoft : PALETTE.raisedHover;

  return h_flex()
    .id(id)
    .h(32)
    .px(10)
    .rounded(RADII.chip)
    .bg(disabled ? PALETTE.transparent : bg)
    .border(1)
    .when(disabled, (el) => el.border_dashed().border_color(PALETTE.line))
    .when(!disabled, (el) => el.border_color(border))
    .items_center()
    .justify_center()
    .text_size(SIZES.xs)
    .font_bold()
    .text_color(color)
    .whitespace_nowrap()
    .when(disabled, (el) => el.opacity(0.55))
    .when(!disabled && Boolean(onClick), (el) =>
      el
        .cursor_pointer()
        .hover((s) => s.bg(hoverBg).border_color(error ? PALETTE.danger : PALETTE.accent))
        .on_click(onClick),
    )
    .child(running ? "Checking..." : label);
}

function buildJoinedCatalog({ catalog, collectEntries, agentsList, healthChecks }) {
  const installedMap = new Map();
  let hasInstalled = false;
  const lastSessionByProv = new Map();

  for (const entry of collectEntries) {
    const res = entry?.result;
    if (!res) continue;

    if (res.installed && typeof res.installed === "object") {
      hasInstalled = true;
      for (const [k, v] of Object.entries(res.installed)) {
        if (v === true) installedMap.set(k, true);
        else if (!installedMap.has(k) && v === false) installedMap.set(k, false);
      }
    }

    const days = res.usage?.days;
    if (Array.isArray(days)) {
      for (const row of days) {
        if (!row || !row.date || !row.provider) continue;
        const sess = Number(row.sessions) || 0;
        const act = Number(row.active_s) || 0;
        const tok = rowTokens(row);
        if (row.provider === "antigravity" && tok === 0) continue;
        if (sess <= 0 && act <= 0 && tok <= 0) continue;

        const prev = lastSessionByProv.get(row.provider);
        if (!prev || row.date > prev.date) {
          lastSessionByProv.set(row.provider, { date: row.date, sessions: sess });
        } else if (row.date === prev.date) {
          prev.sessions += sess;
        }
      }
    }
  }

  const runningByAppKey = new Map();
  for (const a of agentsList ?? []) {
    if (!a) continue;
    const keys = [a.program?.key, a.app]
      .filter(Boolean)
      .map((k) => String(k).toLowerCase());
    for (const k of keys) {
      if (!runningByAppKey.has(k)) runningByAppKey.set(k, []);
      runningByAppKey.get(k).push(a);
    }
  }

  const groups = (catalog ?? []).map((grp) => {
    const joinedAgents = grp.agents.map((ag) => {
      const matchedLive = [];
      const seenAddr = new Set();
      for (const ak of ag.appKeys ?? []) {
        for (const a of runningByAppKey.get(ak.toLowerCase()) ?? []) {
          if (!seenAddr.has(a.address)) {
            seenAddr.add(a.address);
            matchedLive.push(a);
          }
        }
      }

      let liveStatus = null;
      if (matchedLive.length > 0) {
        const prio = { blocked: 4, working: 3, done: 2, idle: 1 };
        matchedLive.sort((a, b) => (prio[b.status] ?? 0) - (prio[a.status] ?? 0));
        liveStatus = matchedLive[0].status;
      }

      const isInstalled =
        ag.installedKey && hasInstalled
          ? installedMap.get(ag.installedKey) ?? null
          : null;

      const lastSession = ag.provider ? lastSessionByProv.get(ag.provider) ?? null : null;
      const health = healthChecks?.[ag.id] ?? null;

      return {
        ...ag,
        isHermes: grp.group === "hermes",
        liveCount: matchedLive.length,
        liveStatus,
        isInstalled,
        lastSession,
        health,
      };
    });

    return {
      ...grp,
      agents: joinedAgents,
    };
  });

  return { groups, hasInstalled };
}

function buildCatalogHero({ ui, palette, groups, onRunHealth, narrow }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const allAgents = groups.flatMap((g) => g.agents);
  const codeCheckTargets = allAgents
    .filter((a) => Boolean(a.cmd))
    .map((a) => ({ id: a.id, cmd: a.cmd }));

  const totalCount = allAgents.length;
  const installedCount = allAgents.filter((a) => a.isInstalled === true).length;
  const runningCount = allAgents.filter((a) => a.liveCount > 0 && a.liveStatus !== "idle").length;
  const plannedCount = allAgents.filter((a) => Boolean(a.planned)).length;
  const errorAgents = allAgents.filter((a) => a.health && a.health.ok === false);
  const okAgents = allAgents.filter((a) => a.health && a.health.ok === true);
  const anyRunningHealth = allAgents.some((a) => a.health && a.health.running);

  const summaryLeft = h_flex()
    .items_center()
    .gap(16)
    .when(!narrow, (el) => el.pr(20).border_r(1).border_color(PALETTE.heroLine))
    .child(
      h_flex()
        .items_baseline()
        .gap(6)
        .child(
          div()
            .text_size(52)
            .font_bold()
            .font_family(monoFont())
            .text_color(PALETTE.heroText)
            .child(String(totalCount)),
        )
        .child(
          div()
            .text_size(SIZES.md)
            .font_bold()
            .text_color(PALETTE.heroMuted)
            .child("agents"),
        ),
    )
    .child(
      v_flex()
        .gap(4)
        .child(
          div()
            .text_size(SIZES.xs)
            .font_bold()
            .text_color(PALETTE.heroMuted)
            .child("AGENT CATALOG · DEFINITION AND LIVE STATUS"),
        )
        .child(
          h_flex()
            .flex_wrap()
            .items_center()
            .gap(8)
            .text_size(SIZES.sm)
            .font_semibold()
            .text_color(PALETTE.heroText)
            .child(
              h_flex()
                .items_center()
                .gap(5)
                .child(div().size(7).rounded(7).bg(PALETTE.heroGreen))
                .child(`${installedCount} installed`),
            )
            .child(div().text_color(PALETTE.heroMuted).child("·"))
            .child(
              h_flex()
                .items_center()
                .gap(5)
                .child(div().size(7).rounded(7).bg(PALETTE.heroGreen))
                .child(`${runningCount} working`),
            )
            .when(errorAgents.length > 0, (el) =>
              el
                .child(div().text_color(PALETTE.heroMuted).child("·"))
                .child(
                  h_flex()
                    .items_center()
                    .gap(5)
                    .child(div().size(7).rounded(7).bg(PALETTE.danger))
                    .child(`${errorAgents.length} error`),
                ),
            )
            .child(div().text_color(PALETTE.heroMuted).child("·"))
            .child(
              h_flex()
                .items_center()
                .gap(5)
                .child(div().size(7).rounded(7).border(1.5).border_dashed().border_color(PALETTE.heroMuted))
                .child(`${plannedCount} planned`),
            ),
        ),
    );

  const hasErrors = errorAgents.length > 0;
  const hasOkOnly = !hasErrors && okAgents.length > 0;
  const firstErr = errorAgents[0];

  const calloutBg = hasErrors
    ? PALETTE.dangerSoft
    : hasOkOnly
      ? PALETTE.okSoft
      : PALETTE.onAccentSoft;
  const calloutBorder = hasErrors
    ? PALETTE.dangerBorder
    : hasOkOnly
      ? PALETTE.okBorder
      : PALETTE.onAccentBorder;

  const calloutBox = h_flex()
    .flex_1()
    .min_w(0)
    .px(12)
    .py(10)
    .gap(10)
    .items_center()
    .justify_between()
    .flex_wrap()
    .rounded(RADII.inner)
    .bg(calloutBg)
    .border(1)
    .border_color(calloutBorder)
    .child(
      h_flex()
        .flex_1()
        .min_w(180)
        .items_center()
        .gap(8)
        .when(hasErrors, (el) =>
          el
            .child(ui.iconOf("alert", 16, PALETTE.danger))
            .child(
              ui.chip({
                label: "error",
                color: PALETTE.danger,
                bg: PALETTE.dangerSoft,
                borderColor: PALETTE.dangerBorder,
                h: 22,
                px: 7,
              }),
            )
            .child(
              div()
                .min_w(0)
                .truncate()
                .text_size(SIZES.sm)
                .font_semibold()
                .text_color(PALETTE.heroText)
                .child(`${maskProgram(firstErr.name)}: ${maskError(firstErr.health.error)}`),
            ),
        )
        .when(hasOkOnly, (el) =>
          el
            .child(
              ui.chip({
                label: "ok",
                color: PALETTE.heroGreen,
                bg: PALETTE.okSoft,
                borderColor: PALETTE.okBorder,
                h: 22,
                px: 7,
              }),
            )
            .child(
              div()
                .min_w(0)
                .truncate()
                .text_size(SIZES.sm)
                .font_semibold()
                .text_color(PALETTE.heroText)
                .child(`${okAgents.length} local agents verified (--version).`),
            ),
        )
        .when(!hasErrors && !hasOkOnly, (el) =>
          el.child(
            div()
              .min_w(0)
              .text_size(SIZES.xs)
              .font_semibold()
              .text_color(PALETTE.heroMuted)
              .child("Check local coding agents with <cmd> --version."),
          ),
        ),
    )
    .child(
      h_flex()
        .id("catalog-health-all")
        .flex_none()
        .h(34)
        .px(12)
        .rounded(RADII.chip)
        .bg(PALETTE.heroText)
        .text_size(SIZES.xs)
        .font_bold()
        .text_color(PALETTE.heroBg)
        .items_center()
        .justify_center()
        .when(!anyRunningHealth, (el) =>
          el
            .cursor_pointer()
            .hover((s) => s.opacity(0.88))
            .on_click((_e, cx) => onRunHealth(codeCheckTargets, cx)),
        )
        .when(anyRunningHealth, (el) => el.opacity(0.6))
        .child(anyRunningHealth ? "Checking..." : "Run health check"),
    );

  return ui.heroCard({
    id: "catalog-hero",
    padding: 16,
    gap: 12,
    children: [
      narrow
        ? v_flex().w_full().gap(12).child(summaryLeft).child(calloutBox)
        : h_flex().w_full().items_center().gap(18).child(summaryLeft).child(calloutBox),
    ],
  });
}

function buildAgentStateCell(PALETTE, SIZES, ui, ag) {
  const items = [];

  if (ag.isHermes) {
    if (ag.planned) {
      items.push(
        h_flex()
          .px(7)
          .py(2)
          .rounded(999)
          .border(1)
          .border_dashed()
          .border_color(PALETTE.offlineBorder)
          .items_center()
          .gap(5)
          .child(div().size(7).rounded(7).border(1.5).border_dashed().border_color(PALETTE.offline))
          .child(
            div()
              .text_size(SIZES.xs)
              .font_semibold()
              .text_color(PALETTE.muted)
              .child("planned"),
          ),
      );
    } else {
      items.push(
        div()
          .text_size(SIZES.sm)
          .font_bold()
          .text_color(PALETTE.muted)
          .child("—"),
      );
      items.push(
        div()
          .text_size(SIZES.xs)
          .text_color(PALETTE.muted)
          .child("no live source"),
      );
    }
    return items;
  }

  if (ag.liveCount > 0 && ag.liveStatus) {
    const isBlocked = ag.liveStatus === "blocked";
    const isWorking = ag.liveStatus === "working";
    items.push(
      h_flex()
        .px(7)
        .py(2)
        .rounded(999)
        .bg(isBlocked ? PALETTE.warnSoft : isWorking ? PALETTE.okSoft : PALETTE.offlineSoft)
        .border(1)
        .border_color(isBlocked ? PALETTE.warnBorder : isWorking ? PALETTE.okBorder : PALETTE.offlineBorder)
        .items_center()
        .gap(5)
        .child(ui.statusWithWord(ag.liveStatus))
        .when(ag.liveCount > 1, (el) =>
          el.child(
            div()
              .text_size(SIZES.xs)
              .font_bold()
              .text_color(PALETTE.mono)
              .child(`×${ag.liveCount}`),
          ),
        ),
    );
  } else if (ag.isInstalled === true) {
    items.push(
      h_flex()
        .px(7)
        .py(2)
        .rounded(999)
        .bg(PALETTE.okSoft)
        .border(1)
        .border_color(PALETTE.okBorder)
        .items_center()
        .gap(5)
        .child(div().size(7).rounded(7).bg(PALETTE.ok))
        .child(
          div()
            .text_size(SIZES.xs)
            .font_semibold()
            .text_color(PALETTE.ok)
            .child("installed"),
        ),
    );
  } else if (ag.isInstalled === false) {
    items.push(
      h_flex()
        .px(7)
        .py(2)
        .rounded(999)
        .bg(PALETTE.offlineSoft)
        .border(1)
        .border_color(PALETTE.offlineBorder)
        .items_center()
        .gap(5)
        .child(div().size(7).rounded(7).border(1.5).border_color(PALETTE.offline))
        .child(
          div()
            .text_size(SIZES.xs)
            .font_semibold()
            .text_color(PALETTE.muted)
            .child("not installed"),
        ),
    );
  } else {
    items.push(
      div()
        .text_size(SIZES.sm)
        .font_bold()
        .text_color(PALETTE.muted)
        .child("—"),
    );
  }

  if (ag.health) {
    if (ag.health.running) {
      items.push(
        div()
          .text_size(SIZES.xs)
          .text_color(PALETTE.muted)
          .child("checking..."),
      );
    } else if (ag.health.ok === true) {
      items.push(
        div()
          .max_w(130)
          .truncate()
          .text_size(SIZES.xs)
          .text_color(PALETTE.ok)
          .tooltip(maskText(ag.health.version) || "ok")
          .child(`ok · ${maskText(ag.health.version) || ""}`),
      );
    } else if (ag.health.ok === false) {
      items.push(
        div()
          .max_w(130)
          .truncate()
          .text_size(SIZES.xs)
          .text_color(PALETTE.danger)
          .tooltip(maskError(ag.health.error) || "error")
          .child(`error · ${maskError(ag.health.error) || ""}`),
      );
    }
  }

  return items;
}

function buildGroupCard({ ui, palette, group, onRunHealth, helpers, narrow }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const isHermes = group.group === "hermes";

  const countSummary = isHermes
    ? `${countLabel(group.agents.length, "agent")} · ${group.agents.filter((a) => a.planned).length} planned · no live status`
    : `${countLabel(group.agents.length, "agent")} · ${group.agents.filter((a) => a.liveCount > 0).length} working · ${group.agents.filter((a) => a.isInstalled === true).length} installed`;

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
            .bg(isHermes ? PALETTE.okSoft : PALETTE.raised)
            .border(1)
            .border_color(isHermes ? PALETTE.okBorder : PALETTE.lineStrong)
            .items_center()
            .justify_center()
            .child(ui.iconOf(isHermes ? "machines" : "terminals", 15, isHermes ? PALETTE.ok : PALETTE.text)),
        )
        .child(
          div()
            .text_size(SIZES.title)
            .font_bold()
            .text_color(PALETTE.text)
            .child(maskText(group.title, "Agent group")),
        )
        .child(
          div()
            .pl(8)
            .border_l(1)
            .border_color(PALETTE.lineStrong)
            .text_size(SIZES.xs)
            .font_family(monoFont())
            .text_color(PALETTE.mono)
            .child(`${maskText(group.subtitle)} · definition`),
        ),
    )
    .child(
      ui.chip({
        label: countSummary,
        mono: true,
        color: PALETTE.mono,
      }),
    );

  const rows = group.agents.map((ag) => {
    const isRunningNow = ag.liveCount > 0 && ag.liveStatus === "working";
    const isHealthErr = ag.health && ag.health.ok === false;
    const isPlanned = Boolean(ag.planned);

    const rowBg = isHealthErr
      ? PALETTE.dangerSoft
      : isRunningNow
        ? PALETTE.okSoft
        : isPlanned
          ? PALETTE.surfaceDark
          : PALETTE.rowBg;
    const rowBorder = isHealthErr
      ? PALETTE.dangerBorder
      : isRunningNow
        ? PALETTE.okBorder
        : isPlanned
          ? PALETTE.offlineBorder
          : PALETTE.line;

    const idBlock = v_flex()
      .when(!narrow, (el) => el.w(150).flex_none())
      .when(narrow, (el) => el.flex_1().min_w(0))
      .gap(2)
      .child(
        div()
          .truncate()
          .text_size(SIZES.sm)
          .font_bold()
          .text_color(isPlanned ? PALETTE.muted : PALETTE.text)
          .child(maskProgram(ag.name)),
      )
      .child(
        div()
          .truncate()
          .text_size(SIZES.xs)
          .font_family(monoFont())
          .text_color(isPlanned ? PALETTE.muted : PALETTE.mono)
          .child(isPlanned ? `${maskText(ag.model)} · planned` : maskText(ag.model)),
      );

    const rolesBlock = h_flex()
      .flex_1()
      .min_w(0)
      .flex_wrap()
      .gap(4)
      .children((isStreaming() ? [] : ag.roles ?? []).map((role) => capChip(PALETTE, SIZES, role, isPlanned)));

    const rights = ag.rights ?? {};
    const rightsBlock = h_flex()
      .flex_1()
      .min_w(0)
      .flex_wrap()
      .gap(4)
      .when(!isStreaming() && typeof rights.internet === "boolean", (el) => el.child(
        permChip(
          PALETTE,
          SIZES,
          rights.internet ? "internet access" : "no internet",
          rights.internet ? "present" : "absent",
        ),
      ))
      .when(!isStreaming() && typeof rights.write === "boolean", (el) => el.child(
        permChip(
          PALETTE,
          SIZES,
          rights.write ? "write files" : isHermes ? "no code changes" : "read-only",
          rights.write ? "present" : "absent",
        ),
      ))
      .when(!isStreaming() && (rights.approval || typeof rights.push === "boolean"), (el) => el.child(
        rights.approval
          ? permChip(PALETTE, SIZES, "User approval required", "guarded")
          : permChip(
              PALETTE,
              SIZES,
              rights.push ? "GitHub push allowed" : "no GitHub push",
              rights.push ? "risky" : "absent",
            ),
      ));

    const stateBlock = v_flex()
      .when(!narrow, (el) => el.w(104).flex_none())
      .gap(3)
      .items_start()
      .children(buildAgentStateCell(PALETTE, SIZES, ui, ag));

    let lastPrimary = "—";
    let lastSecondary = "—";
    if (ag.isHermes) {
      lastPrimary = ag.planned ? "not set up yet" : "—";
      lastSecondary = ag.planned ? "awaiting setup" : "no session source";
    } else if (ag.liveCount > 0 && isRunningNow) {
      lastPrimary = "now";
      lastSecondary = `${ag.liveCount} live sessions`;
    } else if (ag.lastSession) {
      lastPrimary = helpers.formatRelativeDay(ag.lastSession.date);
      lastSecondary = countLabel(ag.lastSession.sessions, "session");
    } else if (ag.provider) {
      lastPrimary = "never used";
      lastSecondary = ag.isInstalled ? "installed, no sessions" : "no sessions";
    } else {
      lastPrimary = "—";
      lastSecondary = ag.isInstalled ? "installed, no recorded usage" : "no recorded sessions";
    }

    const lastBlock = v_flex()
      .when(!narrow, (el) => el.w(132).flex_none())
      .gap(1)
      .child(
        div()
          .truncate()
          .text_size(SIZES.xs)
          .font_family(monoFont())
          .font_semibold()
          .text_color(isRunningNow ? PALETTE.ok : PALETTE.mono)
          .child(lastPrimary),
      )
      .child(
        div()
          .truncate()
          .text_size(SIZES.xs)
          .text_color(isHealthErr ? PALETTE.danger : PALETTE.muted)
          .child(lastSecondary),
      );

    const actionBlock = ag.cmd
      ? healthButton({
          PALETTE,
          SIZES,
          RADII,
          id: `health-${ag.id}`,
          label: "Run health check",
          running: Boolean(ag.health?.running),
          error: isHealthErr,
          disabled: Boolean(ag.health?.running),
          onClick: (_e, cx) => onRunHealth([{ id: ag.id, cmd: ag.cmd }], cx),
        })
      : healthButton({
          PALETTE,
          SIZES,
          RADII,
          id: `health-${ag.id}`,
          label: "no local command",
          disabled: true,
        });

    if (narrow) {
      return v_flex()
        .id(`cat-row-${ag.id}`)
        .w_full()
        .p(10)
        .gap(8)
        .rounded(RADII.chip)
        .bg(rowBg)
        .border(1)
        .when(isPlanned, (el) => el.border_dashed())
        .border_color(rowBorder)
        .child(
          h_flex()
            .w_full()
            .items_center()
            .justify_between()
            .gap(8)
            .child(idBlock)
            .child(stateBlock)
            .child(actionBlock),
        )
        .child(
          h_flex()
            .w_full()
            .items_center()
            .justify_between()
            .flex_wrap()
            .gap(8)
            .child(rolesBlock)
            .child(rightsBlock)
            .child(lastBlock),
        );
    }

    return h_flex()
      .id(`cat-row-${ag.id}`)
      .w_full()
      .px(10)
      .py(8)
      .gap(8)
      .items_center()
      .rounded(RADII.chip)
      .bg(rowBg)
      .border(1)
      .when(isPlanned, (el) => el.border_dashed())
      .border_color(rowBorder)
      .child(idBlock)
      .child(rolesBlock)
      .child(rightsBlock)
      .child(stateBlock)
      .child(lastBlock)
      .child(h_flex().flex_none().justify_end().child(actionBlock));
  });

  return ui.card({
    id: `catalog-group-${group.group}`,
    padding: 16,
    gap: 10,
    children: [
      head,
      v_flex().w_full().gap(6).children(rows),
    ],
  });
}

export function renderAgentsCatalog({
  ui,
  palette,
  catalog,
  collectEntries,
  agentsList,
  healthChecks,
  onRunHealth,
  helpers,
  narrow,
}) {
  const { groups } = buildJoinedCatalog({ catalog, collectEntries, agentsList, healthChecks });

  return v_flex()
    .w_full()
    .gap(14)
    .child(buildCatalogHero({ ui, palette, groups, onRunHealth, narrow }))
    .children(
      groups.map((group) =>
        buildGroupCard({ ui, palette, group, onRunHealth, helpers, narrow }),
      ),
    );
}
