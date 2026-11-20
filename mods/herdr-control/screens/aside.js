// Screen 7: Terminal right rail (part === "aside") — active space agents, ports, and approvals.

import { dashboardNow } from "../demo-mode.js";
import { maskBranch, maskError, maskProgram, maskText, maskTitle } from "../mask.js";
import { countLabel } from "../data.js";
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { renderApprovalItem } from "./approvals.js";
import { collectSpacePorts, formatDurationMs, machineFromAddress } from "./spaces.js";

function railCardHead({ ui, palette, icon, tone = "normal", title, chipLabel = null }) {
  const { PALETTE, SIZES, RADII } = palette;
  const iconBg =
    tone === "danger"
      ? PALETTE.dangerSoft
      : tone === "warn"
        ? PALETTE.warnSoft
        : tone === "ok"
          ? PALETTE.okSoft
          : PALETTE.raised;
  const iconColor =
    tone === "danger"
      ? PALETTE.danger
      : tone === "warn"
        ? PALETTE.warn
        : tone === "ok"
          ? PALETTE.ok
          : PALETTE.text;
  const iconBorder =
    tone === "danger"
      ? PALETTE.dangerBorder
      : tone === "warn"
        ? PALETTE.warnBorder
        : tone === "ok"
          ? PALETTE.okBorder
          : PALETTE.lineStrong;

  const chipColor =
    tone === "danger"
      ? PALETTE.danger
      : tone === "warn"
        ? PALETTE.warn
        : tone === "ok"
          ? PALETTE.ok
          : PALETTE.mono;
  const chipBg =
    tone === "danger"
      ? PALETTE.dangerSoft
      : tone === "warn"
        ? PALETTE.warnSoft
        : tone === "ok"
          ? PALETTE.okSoft
          : PALETTE.rowBg;
  const chipBorder =
    tone === "danger"
      ? PALETTE.dangerBorder
      : tone === "warn"
        ? PALETTE.warnBorder
        : tone === "ok"
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
        .min_w(0)
        .items_center()
        .gap(7)
        .child(
          h_flex()
            .size(24)
            .flex_none()
            .rounded(RADII.chip)
            .bg(iconBg)
            .border(1)
            .border_color(iconBorder)
            .items_center()
            .justify_center()
            .child(ui.iconOf(icon, 13, iconColor)),
        )
        .child(
          div()
            .min_w(0)
            .text_size(SIZES.md)
            .font_bold()
            .text_color(PALETTE.text)
            .whitespace_nowrap()
            .child(title),
        ),
    )
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
    );
}

function railEmpty({ ui, palette, icon, title, description }) {
  const { PALETTE, SIZES, RADII } = palette;
  return v_flex()
    .w_full()
    .items_center()
    .justify_center()
    .gap(4)
    .px(12)
    .py(14)
    .rounded(RADII.inner)
    .bg(PALETTE.rowBg)
    .border(1)
    .border_color(PALETTE.line)
    .child(ui.iconOf(icon, 16, PALETTE.muted))
    .child(
      div()
        .text_size(SIZES.xs)
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

function renderSpaceHeader({ ui, palette, maskPath, activeSpace, streaming }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  return h_flex()
    .id("aside-space-header")
    .w_full()
    .items_center()
    .justify_between()
    .gap(8)
    .px(10)
    .py(8)
    .rounded(RADII.inner)
    .bg(PALETTE.surface)
    .border(1)
    .border_color(PALETTE.line)
    .child(
      h_flex()
        .flex_1()
        .min_w(0)
        .items_center()
        .gap(6)
        .child(ui.iconOf("spaces", 13, PALETTE.muted))
        .child(
          div()
            .min_w(0)
            .truncate()
            .text_size(SIZES.xs)
            .font_bold()
            .text_color(PALETTE.text)
            .child(maskPath(activeSpace.name || "—")),
        )
        .when(Boolean(activeSpace.branch), (el) =>
          el.child(
            div()
              .min_w(0)
              .truncate()
              .px(6)
              .py(1)
              .rounded(RADII.chip)
              .bg(PALETTE.rowBg)
              .border(1)
              .border_color(PALETTE.line)
              .font_family(monoFont())
              .text_size(SIZES.xs)
              .text_color(PALETTE.mono)
              .child(maskBranch(activeSpace.branch)),
          ),
        ),
    )
    .when(streaming, (el) =>
      el.child(
        ui.chip({
          label: "streaming",
          color: PALETTE.warn,
          bg: PALETTE.warnSoft,
          borderColor: PALETTE.warnBorder,
          h: 20,
          px: 7,
        }),
      ),
    );
}

function renderAgentsCard({ ui, palette, jump, maskHost, activeSpace, spaceAgents, tabWorkingSince, localHostname }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const workingCount = spaceAgents.filter((a) => a.status === "working").length;
  const blockedCount = spaceAgents.filter((a) => a.status === "blocked").length;

  const tone = blockedCount > 0 ? "warn" : workingCount > 0 ? "ok" : "normal";
  const chipLabel =
    blockedCount > 0
      ? `${blockedCount} pending`
      : workingCount > 0
        ? `${workingCount} working`
        : countLabel(spaceAgents.length, "agent");

  const progTotals = new Map();
  for (const a of spaceAgents) {
    const pname = a.program?.name || a.app || "Agent";
    progTotals.set(pname, (progTotals.get(pname) ?? 0) + 1);
  }
  const progSeen = new Map();

  const body =
    spaceAgents.length === 0
      ? railEmpty({
          ui,
          palette,
          icon: "agents",
          title: "No agents in this space",
          description: "No agents are working or waiting in the active space.",
        })
      : v_flex()
          .w_full()
          .gap(8)
          .children(
            spaceAgents.map((a) => {
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

              const machName = maskHost(
                machineFromAddress(a.address) ?? (localHostname || "This computer"),
              );
              const sinceMs = tabWorkingSince.get(a.tab) ?? null;
              const durLabel =
                (isWorking || isBlocked) && typeof sinceMs === "number" && sinceMs > 0
                  ? formatDurationMs(dashboardNow().getTime() - sinceMs)
                  : "—";
              const pic = ui.programIcon(a.program, 14, PALETTE.text);

              return v_flex()
                .id(`aside-agent-${a.address}`)
                .w_full()
                .p(10)
                .gap(5)
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
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(6)
                    .child(
                      h_flex()
                        .flex_1()
                        .min_w(100)
                        .items_center()
                        .gap(6)
                        .when(Boolean(pic), (el) => el.child(pic))
                        .child(
                          div()
                            .min_w(0)
                            .truncate()
                            .text_size(SIZES.sm)
                            .font_bold()
                            .text_color(PALETTE.text)
                            .child(maskProgram(displayName)),
                        ),
                    )
                    .child(ui.statusWithWord(a.status, { dotSize: 6, textSize: SIZES.xs })),
                )
                .when(Boolean(a.title && a.title !== pname), (el) =>
                  el.child(
                    div()
                      .w_full()
                      .truncate()
                      .text_size(SIZES.xs)
                      .text_color(PALETTE.muted)
                      .child(maskTitle(a.title)),
                  ),
                )
                .child(
                  h_flex()
                    .w_full()
                    .items_center()
                    .justify_between()
                    .gap(6)
                    .font_family(monoFont())
                    .text_size(SIZES.xs)
                    .text_color(PALETTE.mono)
                    .child(`Duration: ${durLabel}`)
                    .child(
                      div()
                        .min_w(0)
                        .truncate()
                        .text_color(PALETTE.muted)
                        .child(machName),
                    ),
                );
            }),
          );

  return ui.card({
    id: "aside-agents-card",
    padding: 12,
    gap: 10,
    children: [
      railCardHead({
        ui,
        palette,
        icon: "agents",
        tone,
        title: "Agents",
        chipLabel,
      }),
      body,
    ],
  });
}

function renderPortsCard({ ui, palette, maskHost, portsInfo }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const { known, ports } = portsInfo;
  const publicCount = ports.filter((p) => p.access === "public").length;

  const tone = !known ? "normal" : publicCount > 0 ? "danger" : "normal";
  const chipLabel = !known
    ? "—"
    : publicCount > 0
      ? `${publicCount} public`
      : countLabel(ports.length, "port");

  let body;
  if (!known) {
    body = railEmpty({
      ui,
      palette,
      icon: "ports",
      title: "No port data",
      description: "Waiting for listening port data from this machine.",
    });
  } else if (ports.length === 0) {
    body = railEmpty({
      ui,
      palette,
      icon: "ports",
      title: "No open ports",
      description: "No processes in this space's folder are listening on a port.",
    });
  } else {
    body = v_flex()
      .w_full()
      .gap(6)
      .children(
        ports.map((p) => {
          const isPublic = p.access === "public";
          const isTailnet = p.access === "tailnet";
          const accessLabel = p.access;
          const accessColor = isPublic
            ? PALETTE.danger
            : isTailnet
              ? PALETTE.text
              : PALETTE.muted;
          const accessBg = isPublic
            ? PALETTE.dangerSoft
            : isTailnet
              ? PALETTE.raised
              : PALETTE.rowBg;
          const accessBorder = isPublic
            ? PALETTE.dangerBorder
            : isTailnet
              ? PALETTE.lineStrong
              : PALETTE.line;

          const metaParts = [maskHost(p.machineName)];
          if (p.funnelPort !== null) metaParts.push(`Funnel :${p.funnelPort}`);
          else if (p.servePort !== null) metaParts.push(`Serve :${p.servePort}`);

          return v_flex()
            .id(`aside-port-${p.id}`)
            .w_full()
            .px(10)
            .py(8)
            .gap(4)
            .rounded(RADII.inner)
            .bg(isPublic ? PALETTE.dangerSoft : PALETTE.rowBg)
            .border(1)
            .border_color(isPublic ? PALETTE.dangerBorder : PALETTE.line)
            .child(
              h_flex()
                .w_full()
                .flex_wrap()
                .items_center()
                .justify_between()
                .gap(6)
                .child(
                  h_flex()
                    .flex_1()
                    .min_w(100)
                    .items_center()
                    .gap(6)
                    .child(
                      isPublic
                        ? ui.iconOf("alert", 13, PALETTE.danger)
                        : div()
                            .size(6)
                            .flex_none()
                            .rounded(6)
                            .bg(isTailnet ? PALETTE.ok : PALETTE.offline),
                    )
                    .child(
                      div()
                        .flex_none()
                        .font_family(monoFont())
                        .text_size(SIZES.sm)
                        .font_bold()
                        .text_color(isPublic ? PALETTE.danger : PALETTE.text)
                        .child(`:${p.port}`),
                    )
                    .child(
                      div()
                        .min_w(0)
                        .truncate()
                        .text_size(SIZES.xs)
                        .font_semibold()
                        .text_color(PALETTE.text)
                        .child(maskText(p.process)),
                    ),
                )
                .child(
                  ui.chip({
                    label: accessLabel,
                    color: accessColor,
                    bg: accessBg,
                    borderColor: accessBorder,
                    h: 20,
                    px: 7,
                  }),
                ),
            )
            .child(
              div()
                .w_full()
                .truncate()
                .font_family(monoFont())
                .text_size(SIZES.xs)
                .text_color(PALETTE.mono)
                .child(metaParts.join(" · ")),
            );
        }),
      );
  }

  return ui.card({
    id: "aside-ports-card",
    padding: 12,
    gap: 10,
    children: [
      railCardHead({
        ui,
        palette,
        icon: "ports",
        tone,
        title: "Ports",
        chipLabel,
      }),
      body,
    ],
  });
}

function renderApprovalsCard({
  ui,
  palette,
  jump,
  maskHost,
  maskPath,
  blockedAgents,
  tabChangedAt,
  blockedSinceMap,
  confirming,
  sendingAddress,
  actionError = null,
  onSetConfirm,
  onClearConfirm,
  onSetSending,
  onSetError = null,
}) {
  const { PALETTE, SIZES, RADII } = palette;
  const tone = blockedAgents.length > 0 ? "warn" : "ok";
  const body =
    blockedAgents.length === 0
      ? railEmpty({
          ui,
          palette,
          icon: "approvals",
          title: "No pending approvals",
          description: "No agents in this space are waiting for a decision.",
        })
      : v_flex()
          .w_full()
          .gap(8)
          .children(
            blockedAgents.map((a) =>
              renderApprovalItem({
                agent: a,
                ui,
                palette,
                jump,
                maskHost,
                maskPath,
                tabChangedAt,
                blockedSinceMap,
                confirming,
                sendingAddress,
                onSetConfirm,
                onClearConfirm,
                onSetSending,
                onSetError,
                compact: true,
                idPrefix: "aside-approval",
              }),
            ),
          );

  return ui.card({
    id: "aside-approvals-card",
    padding: 12,
    gap: 10,
    children: [
      railCardHead({
        ui,
        palette,
        icon: "approvals",
        tone,
        title: "Approvals",
        chipLabel: `${blockedAgents.length} pending`,
      }),
      ...(actionError
        ? [
            div()
              .w_full()
              .px(8)
              .py(6)
              .rounded(RADII.chip)
              .bg(PALETTE.dangerSoft)
              .border(1)
              .border_color(PALETTE.dangerBorder)
              .text_size(SIZES.xs)
              .font_semibold()
              .text_color(PALETTE.danger)
              .child(maskError(actionError)),
          ]
        : []),
      body,
    ],
  });
}

export function renderAside({
  ui,
  palette,
  jump,
  maskHost,
  maskPath,
  streaming,
  collectEntries,
  localEntry,
  spacesList,
  agentsList,
  focusedInfo,
  blockedSinceMap,
  confirming,
  sendingAddress,
  actionError = null,
  onSetConfirm,
  onClearConfirm,
  onSetSending,
  onSetError = null,
}) {
  const { PALETTE, textFont } = palette;
  const spacesAll = spacesList ?? [];
  const activeSpace =
    spacesAll.find((s) => s && s.active) ??
    (focusedInfo?.space ? spacesAll.find((s) => s && s.id === focusedInfo.space) : null) ??
    spacesAll[0] ??
    null;

  if (!activeSpace) {
    return v_flex()
      .id("root-aside")
      .size_full()
      .min_h(0)
      .font_family(textFont())
      .bg(PALETTE.bg)
      .text_color(PALETTE.text)
      .p(10)
      .child(
        railEmpty({
          ui,
          palette,
          icon: "spaces",
          title: "No active space",
          description: "Open a space to see its agents, ports and approvals.",
        }),
      );
  }

  const localHostname = localEntry?.result?.system?.hostname || null;
  const spaceAgents = (agentsList ?? []).filter((a) => a && a.space === activeSpace.id);
  const blockedAgents = spaceAgents.filter((a) => a.status === "blocked");

  const tabWorkingSince = new Map();
  const tabChangedAt = new Map();
  for (const tab of activeSpace.tabs ?? []) {
    if (!tab?.id) continue;
    if (typeof tab.working_since === "number") tabWorkingSince.set(tab.id, tab.working_since);
    if (typeof tab.changed_at === "number") tabChangedAt.set(tab.id, tab.changed_at);
  }

  const portsInfo = collectSpacePorts({
    space: activeSpace,
    collectEntries,
    localHostname,
  });

  return v_flex()
    .id("root-aside")
    .size_full()
    .min_h(0)
    .font_family(textFont())
    .bg(PALETTE.bg)
    .text_color(PALETTE.text)
    .overflow_y_scrollbar()
    .p(6)
    .gap(10)
    .child(renderSpaceHeader({ ui, palette, maskPath, activeSpace, streaming }))
    .child(
      renderAgentsCard({
        ui,
        palette,
        jump,
        maskHost,
        activeSpace,
        spaceAgents,
        tabWorkingSince,
        localHostname,
      }),
    )
    .child(
      renderPortsCard({
        ui,
        palette,
        maskHost,
        portsInfo,
      }),
    )
    .child(
      renderApprovalsCard({
        ui,
        palette,
        jump,
        maskHost,
        maskPath,
        blockedAgents,
        tabChangedAt,
        blockedSinceMap,
        confirming,
        sendingAddress,
        actionError,
        onSetConfirm,
        onClearConfirm,
        onSetSending,
        onSetError,
      }),
    );
}
