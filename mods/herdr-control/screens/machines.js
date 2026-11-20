// Screen 3: Machines (master-detail over Tailscale + Herdr machines).

import { dashboardNow, isDemo } from "../demo-mode.js";
import { dashboardCommands } from "../source.js";
import { countLabel } from "../data.js";
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { formatDockerPortsDisplay, isStreaming, maskError, maskProgram, maskText, maskTitle } from "../mask.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LATENCY_CHART_H = 74;
const TRAFFIC_CHART_H = 68;

/** Format an epoch ms timestamp as HH:MM. */
function formatClockHHMM(ts) {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return "—";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Format an ISO timestamp as "DD Mon HH:MM". */
function formatSinceDateTime(isoStr) {
  if (!isoStr || typeof isoStr !== "string") return "—";
  const ts = Date.parse(isoStr);
  if (!Number.isFinite(ts)) return "—";
  const d = new Date(ts);
  const mon = MONTHS[d.getMonth()];
  if (!mon) return "—";
  return `${d.getDate()} ${mon} ${formatClockHHMM(ts)}`;
}

/** Format uptime seconds ("14 d 06 h" / "7 h 22 min" / "18 min"). */
function formatUptime(uptimeS) {
  if (typeof uptimeS !== "number" || !Number.isFinite(uptimeS) || uptimeS < 0) return "—";
  const totalMin = Math.floor(uptimeS / 60);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} d ${String(hours).padStart(2, "0")} h`;
  if (hours > 0) return `${hours} h ${String(mins).padStart(2, "0")} min`;
  return `${mins} min`;
}

/** Format a working duration in ms ("1 h 48 min" / "24 min" / "<1 min"). */
function formatDurationMs(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return "<1 min";
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
}

/** Format latency in ms to one decimal place when under 10 ms. */
function formatMs(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

/** Format decimal byte counts for network traffic (TB = 10^12 bytes per contract). */
function formatTrafficBytes(bytes) {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b < 0) return "—";
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`;
  return `${Math.round(b)} B`;
}

/** Format binary byte counts for RAM/disk capacity in GB/TB. */
function formatCapacityGb(bytes, decimals = 1) {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b <= 0) return "—";
  const gib = b / 1073741824;
  if (gib >= 1024) {
    return `${(gib / 1024).toFixed(1)} TB`;
  }
  const str = decimals === 0 ? String(Math.round(gib)) : gib.toFixed(decimals);
  return `${str} GB`;
}

/** Build a responsive card header whose title never truncates/collapses behind long meta text. */
function panelHead({ ui, palette, icon, iconTone = "normal", title, meta = null }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const iconBg =
    iconTone === "ok"
      ? PALETTE.okSoft
      : iconTone === "danger"
        ? PALETTE.dangerSoft
        : PALETTE.raised;
  const iconColor =
    iconTone === "ok"
      ? PALETTE.ok
      : iconTone === "danger"
        ? PALETTE.danger
        : PALETTE.text;
  const iconBorder =
    iconTone === "ok"
      ? PALETTE.okBorder
      : iconTone === "danger"
        ? PALETTE.dangerBorder
        : PALETTE.lineStrong;

  return h_flex()
    .w_full()
    .flex_wrap()
    .items_center()
    .justify_between()
    .gap(8)
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
            .bg(iconBg)
            .border(1)
            .border_color(iconBorder)
            .items_center()
            .justify_center()
            .child(ui.iconOf(icon, 15, iconColor)),
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
    .when(meta !== null && meta !== undefined && meta !== "", (el) =>
      el.child(
        div()
          .min_w(0)
          .truncate()
          .text_size(SIZES.xs)
          .font_family(monoFont())
          .text_color(PALETTE.muted)
          .child(String(meta)),
      ),
    );
}

/** Check once per render if Herdr's terminal.open command accepts a `machine` argument. */
function terminalOpenSupportsMachine() {
  try {
    const cmd = (dashboardCommands() ?? []).find((c) => c && c.name === "terminal.open");
    return Boolean(cmd?.args?.some((a) => a && a.name === "machine"));
  } catch {
    return false;
  }
}

/** Check once per render if Herdr's tab.new / space.new support opening a command tab on a machine. */
function remoteTabCommandSupported() {
  try {
    const list = dashboardCommands() ?? [];
    const tabNew = list.find((c) => c && c.name === "tab.new");
    const spaceNew = list.find((c) => c && c.name === "space.new");
    const hasTabArgs =
      Boolean(tabNew?.args?.some((a) => a && a.name === "space")) &&
      Boolean(tabNew?.args?.some((a) => a && a.name === "argv")) &&
      Boolean(tabNew?.args?.some((a) => a && a.name === "name"));
    const hasSpaceArgs =
      Boolean(spaceNew?.args?.some((a) => a && a.name === "machine")) &&
      Boolean(spaceNew?.args?.some((a) => a && a.name === "tab")) &&
      Boolean(spaceNew?.args?.some((a) => a && a.name === "argv"));
    return hasTabArgs && hasSpaceArgs;
  } catch {
    return false;
  }
}

/** Build the left "All Machines" master list panel. */
function renderMachineListPanel({
  ui,
  palette,
  maskHost,
  maskTailnet,
  models,
  selectedKey,
  onSelectMachine,
  tailnetName,
  latestCollectAt,
  narrow,
}) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const onlineCount = models.filter((m) => m.online).length;
  const totalCount = models.length;

  const listItems =
    models.length === 0
      ? [
          ui.emptyState({
            icon: "machines",
            title: "Machine not found",
            description: "Herdr and Tailscale have yet to report a machine.",
          }),
        ]
      : models.map((m) => {
          const isSelected = m.key === selectedKey;
          const dotColor =
            m.statusTone === "ok"
              ? PALETTE.ok
              : m.statusTone === "warn"
                ? PALETTE.warn
                : PALETTE.offline;
          const rowBg = isSelected
            ? PALETTE.accentSoft
            : m.online
              ? PALETTE.rowBg
              : PALETTE.surfaceDark;
          const rowBorder = isSelected ? PALETTE.accentBorder : PALETTE.line;
          const pingLabel = formatMs(m.pingMs);

          return v_flex()
            .id(`machine-list-item-${m.key}`)
            .w_full()
            .px(12)
            .py(10)
            .gap(4)
            .rounded(RADII.inner)
            .bg(rowBg)
            .border(1)
            .when(isSelected, (el) => el.border_l(3))
            .border_color(rowBorder)
            .cursor_pointer()
            .hover((s) =>
              s
                .bg(isSelected ? PALETTE.accentSoft : PALETTE.rowHover)
                .border_color(isSelected ? PALETTE.accentBorder : PALETTE.lineStrong),
            )
            .on_click((_e, cx) => onSelectMachine(m.key, cx))
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
                    .gap(8)
                    .child(div().size(8).flex_none().rounded(8).bg(dotColor))
                    .child(
                      div()
                        .flex_1()
                        .min_w(0)
                        .truncate()
                        .font_family(monoFont())
                        .text_size(SIZES.sm)
                        .font_bold()
                        .text_color(PALETTE.text)
                        .child(maskHost(m.displayName)),
                    ),
                )
                .child(
                  div()
                    .flex_none()
                    .font_family(monoFont())
                    .text_size(SIZES.xs)
                    .font_bold()
                    .text_color(m.pingMs !== null ? PALETTE.ok : PALETTE.muted)
                    .whitespace_nowrap()
                    .child(pingLabel),
                ),
            )
            .child(
              h_flex()
                .w_full()
                .items_center()
                .justify_between()
                .gap(6)
                .pl(16)
                .child(
                  div()
                    .flex_1()
                    .min_w(0)
                    .truncate()
                    .text_size(SIZES.xs)
                    .font_semibold()
                    .text_color(m.online ? PALETTE.mono : PALETTE.muted)
                    .child(m.statusText),
                )
                .when(m.publicPortsCount > 0, (el) =>
                  el.child(
                    ui.chip({
                      label: `${m.publicPortsCount} public ports`,
                      color: PALETTE.danger,
                      bg: PALETTE.dangerSoft,
                      borderColor: PALETTE.dangerBorder,
                      h: 20,
                      px: 7,
                    }),
                  ),
                )
                .when(Boolean(m.traffic?.limitChip), (el) =>
                  el.child(
                    ui.chip({
                      label: m.traffic.limitChip,
                      color:
                        m.traffic.limitTone === "danger" ? PALETTE.danger : PALETTE.warn,
                      bg:
                        m.traffic.limitTone === "danger"
                          ? PALETTE.dangerSoft
                          : PALETTE.warnSoft,
                      borderColor:
                        m.traffic.limitTone === "danger"
                          ? PALETTE.dangerBorder
                          : PALETTE.warnBorder,
                      h: 20,
                      px: 7,
                    }),
                  ),
                ),
            )
            .when(Boolean(m.collectError), (el) =>
              el.child(h_flex().pl(16).child(ui.chip({
                label: m.collectError,
                color: PALETTE.warn,
                bg: PALETTE.warnSoft,
                borderColor: PALETTE.warnBorder,
                h: 20,
                px: 7,
              }))),
            )
            .child(
              h_flex()
                .w_full()
                .items_center()
                .justify_between()
                .gap(8)
                .pl(16)
                .child(
                  div()
                    .flex_1()
                    .min_w(0)
                    .truncate()
                    .font_family(monoFont())
                    .text_size(SIZES.xs)
                    .text_color(PALETTE.muted)
                    .child(m.connectionPathShort),
                )
                .child(
                  h_flex()
                    .flex_none()
                    .items_center()
                    .gap(6)
                    .when((m.remote?.containers?.length ?? 0) > 0, (el) =>
                      el.child(
                        div()
                          .font_family(monoFont())
                          .text_size(SIZES.xs)
                          .font_semibold()
                          .text_color(PALETTE.ok)
                          .whitespace_nowrap()
                          .child(`${m.remote.containers.length} containers`),
                      ),
                    )
                    .child(
                      div()
                        .font_family(monoFont())
                        .text_size(SIZES.xs)
                        .font_semibold()
                        .text_color(m.machineAgents.length > 0 ? PALETTE.mono : PALETTE.muted)
                        .whitespace_nowrap()
                        .child(countLabel(m.machineAgents.length, "agent")),
                    ),
                ),
            );
        });

  const lastPollText = latestCollectAt ? formatClockHHMM(latestCollectAt) : "—";
  const tailnetFoot = tailnetName ? maskTailnet(tailnetName) : "—";

  const panel = ui.card({
    id: "machines-list-panel",
    padding: 14,
    gap: 12,
    children: [
      panelHead({
        ui,
        palette,
        icon: "machines",
        iconTone: onlineCount > 0 ? "ok" : "normal",
        title: "All Machines",
        meta: `${onlineCount}/${totalCount} online`,
      }),
      v_flex().w_full().gap(8).children(listItems),
      div()
        .w_full()
        .pt(8)
        .border_t(1)
        .border_color(PALETTE.line)
        .truncate()
        .font_family(monoFont())
        .text_size(SIZES.xs)
        .text_color(PALETTE.muted)
        .child(`Last check: ${lastPollText} · ${tailnetFoot}`),
    ],
  });

  return narrow ? panel.w_full() : panel.w(306).flex_none();
}

/** Build the bone hero identity band for the selected machine. */
function renderMachineHeroBand({ ui, palette, jump, maskHost, maskIp, machine, canOpenTerminal }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const dotCol =
    machine.statusTone === "ok"
      ? PALETTE.heroGreen
      : machine.statusTone === "warn"
        ? PALETTE.heroWarn
        : PALETTE.offline;

  const eyebrowState = machine.isLocal
    ? "SELECTED MACHINE · ONLINE · THIS COMPUTER"
    : `SELECTED MACHINE · ${machine.statusText.toUpperCase()}`;

  const ipText = machine.ip ? maskIp(machine.ip) : "—";
  const osText = maskText(machine.os) || "—";
  const uptimeText = formatUptime(machine.system?.uptime_s);

  const metaPairs = [
    { label: "OS", value: osText, mono: false },
    { label: "Uptime", value: uptimeText, mono: true },
    { label: "Connection Path", value: machine.connectionPathDetail, mono: true },
  ];

  const handleOpenTerminal = () => {
    if (machine.isLocal) {
      jump("terminal.open", {});
    } else if (canOpenTerminal && machine.herdrName) {
      jump("terminal.open", { machine: machine.herdrName });
    }
  };

  return ui.heroCard({
    id: "machine-detail-hero",
    padding: 15,
    gap: 8,
    children: [
      h_flex()
        .w_full()
        .flex_wrap()
        .items_start()
        .justify_between()
        .gap(14)
        .child(
          v_flex()
            .flex_1()
            .min_w(220)
            .gap(8)
            .child(
              h_flex()
                .items_center()
                .gap(7)
                .child(div().size(8).flex_none().rounded(8).bg(dotCol))
                .child(
                  div()
                    .text_size(SIZES.xs)
                    .font_bold()
                    .text_color(PALETTE.heroMuted)
                    .child(eyebrowState),
                ),
            )
            .child(
              h_flex()
                .flex_wrap()
                .items_baseline()
                .gap(10)
                .child(
                  div()
                    .text_size(SIZES.stat)
                    .font_bold()
                    .font_family(monoFont())
                    .text_color(PALETTE.heroText)
                    .child(maskHost(machine.displayName)),
                )
                .child(
                  div()
                    .px(10)
                    .py(3)
                    .rounded(RADII.pill)
                    .bg(PALETTE.onAccentSoft)
                    .border(1)
                    .border_color(PALETTE.onAccentBorder)
                    .font_family(monoFont())
                    .text_size(SIZES.sm)
                    .font_semibold()
                    .text_color(PALETTE.heroText)
                    .child(ipText),
                ),
            ),
        )
        .when(canOpenTerminal, (el) =>
          el.child(
            h_flex()
              .id("machine-open-terminal")
              .flex_none()
              .h(36)
              .px(14)
              .gap(8)
              .rounded(RADII.chip)
              .bg(PALETTE.heroText)
              .items_center()
              .justify_center()
              .cursor_pointer()
              .hover((s) => s.bg(PALETTE.raisedHover))
              .on_click(handleOpenTerminal)
              .child(ui.iconOf("terminals", 15, PALETTE.heroBg))
              .child(
                div()
                  .text_size(SIZES.xs)
                  .font_bold()
                  .text_color(PALETTE.heroBg)
                  .whitespace_nowrap()
                  .child("Open terminal"),
              ),
          ),
        ),
      h_flex()
        .w_full()
        .flex_wrap()
        .pt(8)
        .border_t(1)
        .border_color(PALETTE.heroLine)
        .gap(18)
        .children(
          metaPairs.map((pair) =>
            h_flex()
              .items_baseline()
              .gap(6)
              .child(
                div()
                  .text_size(SIZES.xs)
                  .font_semibold()
                  .text_color(PALETTE.heroMuted)
                  .child(pair.label),
              )
              .child(
                div()
                  .text_size(SIZES.sm)
                  .font_bold()
                  .text_color(PALETTE.heroText)
                  .when(pair.mono, (el) => el.font_family(monoFont()))
                  .child(pair.value),
              ),
          ),
        ),
    ],
  });
}

/** Build the "Resource Usage" card (CPU / RAM / Disk progress bars). */
function renderResourcesPanel({ ui, palette, machine }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const sys = machine.system;

  let subtitle = null;
  if (sys) {
    const parts = [];
    if (sys.cpu_model) {
      parts.push(
        maskText(sys.cpu_model
          .replace(/^(?:AMD|Intel\(R\)|Apple)\s+/i, "")
          .replace(/\s+\d+-Core.*$/i, "")
          .replace(/\s+(?:Processor|CPU).*$/i, "")
          .trim()),
      );
    }
    if (sys.ram_total_b > 0) parts.push(formatCapacityGb(sys.ram_total_b, 0));
    if (sys.disk_total_b > 0) parts.push(formatCapacityGb(sys.disk_total_b, 0));
    if (parts.length > 0) subtitle = parts.join(" · ");
  }

  let body;
  if (!sys) {
    const reason = !machine.isHerdrMachine
      ? "Tailscale-only node. No system data."
      : machine.collectError
        ? `Could not read system data (${machine.collectError}).`
        : "CPU, RAM and disk data appear after the collector runs.";
    body = v_flex()
      .w_full()
      .flex_1()
      .items_center()
      .justify_center()
      .gap(6)
      .py(18)
      .px(12)
      .rounded(RADII.inner)
      .bg(PALETTE.rowBg)
      .border(1)
      .border_color(PALETTE.line)
      .child(
        div()
          .font_family(monoFont())
          .text_size(SIZES.lg)
          .font_bold()
          .text_color(PALETTE.muted)
          .child("—"),
      )
      .child(
        div()
          .text_size(SIZES.xs)
          .text_color(PALETTE.muted)
          .text_center()
          .child(reason),
      );
  } else {
    const cpuRatio = Number.isFinite(sys.cpu_pct) ? sys.cpu_pct / 100 : null;
    const capacityRatio = (used, total) => Number.isFinite(used) && total > 0 ? used / total : null;

    const metrics = [
      {
        label: "CPU",
        ratio: cpuRatio,
        detail: sys.cpu_cores > 0 ? `${sys.cpu_cores} cores` : "—",
      },
      {
        label: "RAM",
        ratio: capacityRatio(sys.ram_used_b, sys.ram_total_b),
        detail: `${formatCapacityGb(sys.ram_used_b)} / ${formatCapacityGb(sys.ram_total_b, 0)}`,
      },
      {
        label: "DISK",
        ratio: capacityRatio(sys.disk_used_b, sys.disk_total_b),
        detail: `${formatCapacityGb(sys.disk_used_b, 0)} / ${formatCapacityGb(sys.disk_total_b, 0)}`,
      },
    ];

    body = v_flex()
      .w_full()
      .gap(8)
      .children(
        metrics.map((m) =>
          v_flex()
            .w_full()
            .p(8)
            .gap(5)
            .rounded(RADII.inner)
            .bg(PALETTE.rowBg)
            .border(1)
            .border_color(PALETTE.line)
            .child(
              m.ratio === null
                ? h_flex().w_full().justify_between().text_size(SIZES.xs)
                    .child(m.label).child(m.detail)
                : ui.progressBar({
                    label: m.label,
                    valueLabel: `${Math.round(m.ratio * 100)}% · ${m.detail}`,
                    ratio: m.ratio,
                    height: 7,
                  }),
            ),
        ),
      );
  }

  return ui.card({
    id: "machine-resources-card",
    padding: 14,
    gap: 10,
    children: [
      v_flex()
        .w_full()
        .gap(3)
        .child(
          panelHead({
            ui,
            palette,
            icon: "machines",
            title: "Resource Usage",
          }),
        )
        .when(Boolean(subtitle), (el) =>
          el.child(
            div()
              .w_full()
              .truncate()
              .font_family(monoFont())
              .text_size(SIZES.xs)
              .text_color(PALETTE.muted)
              .child(subtitle),
          ),
        ),
      body,
    ],
  });
}

/** Build the "Latency · last hour" card from in-memory ping samples. */
function renderLatencyPanel({ ui, palette, machine, pingHistory }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const oneHourAgo = dashboardNow().getTime() - 3600000;
  const rawSamples = pingHistory?.get(machine.key) ?? [];
  const samples = rawSamples.filter((s) => s && typeof s.ms === "number" && s.ts >= oneHourAgo);

  let metaText = "—";
  let body;

  if (samples.length < 2) {
    if (machine.pingMs !== null) {
      metaText = formatMs(machine.pingMs);
    }
    const emptyMsg = !machine.inTailscale
      ? "No Tailscale latency data for this machine."
      : samples.length === 1
        ? `1 sample (${formatMs(samples[0].ms)}). The chart needs at least 2 samples.`
        : machine.isLocal
          ? "Only another Herdr machine can measure this computer's latency."
          : "The last-hour chart needs at least 2 samples.";

    body = v_flex()
      .w_full()
      .flex_1()
      .items_center()
      .justify_center()
      .gap(6)
      .py(18)
      .px(12)
      .rounded(RADII.inner)
      .bg(PALETTE.rowBg)
      .border(1)
      .border_color(PALETTE.line)
      .child(
        div()
          .font_family(monoFont())
          .text_size(SIZES.lg)
          .font_bold()
          .text_color(PALETTE.muted)
          .child("—"),
      )
      .child(
        div()
          .text_size(SIZES.xs)
          .text_color(PALETTE.muted)
          .text_center()
          .child(emptyMsg),
      );
  } else {
    const latest = samples[samples.length - 1];
    const sum = samples.reduce((acc, s) => acc + s.ms, 0);
    const avg = sum / samples.length;
    let peakIdx = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].ms > samples[peakIdx].ms) peakIdx = i;
    }
    const peak = samples[peakIdx];
    const maxScale = Math.max(peak.ms * 1.15, 1);
    metaText = `${formatMs(latest.ms)} · avg. ${formatMs(avg)} · peak ${formatMs(peak.ms)}`;

    const bars = samples.map((s, idx) => {
      const isLatest = idx === samples.length - 1;
      const isPeak = idx === peakIdx && peak.ms > avg * 1.25;
      const barH = Math.max(4, Math.round((s.ms / maxScale) * LATENCY_CHART_H));
      const color = isLatest ? PALETTE.ok : isPeak ? PALETTE.warn : PALETTE.mono;
      return v_flex()
        .id(`latency-bar-${idx}`)
        .flex_1()
        .min_w(3)
        .max_w(16)
        .h(LATENCY_CHART_H)
        .justify_end()
        .tooltip(`${formatClockHHMM(s.ts)} · ${formatMs(s.ms)}`)
        .child(div().w_full().h(barH).rounded(3).bg(color));
    });

    const midSample = samples[Math.floor(samples.length / 2)];
    body = v_flex()
      .w_full()
      .flex_1()
      .justify_between()
      .gap(8)
      .child(
        h_flex()
          .w_full()
          .items_stretch()
          .gap(8)
          .child(
            v_flex()
              .w(42)
              .flex_none()
              .h(LATENCY_CHART_H)
              .justify_between()
              .items_end()
              .font_family(monoFont())
              .text_size(SIZES.xs)
              .text_color(PALETTE.muted)
              .child(formatMs(maxScale))
              .child(formatMs(maxScale / 2))
              .child("0"),
          )
          .child(
            h_flex()
              .flex_1()
              .min_w(0)
              .h(LATENCY_CHART_H)
              .items_end()
              .gap(2)
              .pb(2)
              .border_b(1)
              .border_color(PALETTE.lineStrong)
              .children(bars),
          ),
      )
      .child(
        h_flex()
          .w_full()
          .gap(8)
          .child(div().w(42).flex_none())
          .child(
            h_flex()
              .flex_1()
              .justify_between()
              .font_family(monoFont())
              .text_size(SIZES.xs)
              .text_color(PALETTE.muted)
              .child(formatClockHHMM(samples[0].ts))
              .child(formatClockHHMM(midSample.ts))
              .child(formatClockHHMM(latest.ts)),
          ),
      );
  }

  return ui.card({
    id: "machine-latency-card",
    padding: 14,
    gap: 10,
    children: [
      v_flex()
        .w_full()
        .gap(3)
        .child(
          panelHead({
            ui,
            palette,
            icon: "overview",
            title: "Latency · last hour",
            meta: samples.length < 2 ? metaText : null,
          }),
        )
        .when(samples.length >= 2, (el) =>
          el.child(
            div()
              .w_full()
              .truncate()
              .font_family(monoFont())
              .text_size(SIZES.xs)
              .text_color(PALETTE.ok)
              .child(metaText),
          ),
        ),
      body,
    ],
  });
}

/** Build the "Monthly Traffic" card with totals, optional limit bar, daily bars, projection, and source line. */
function renderTrafficPanel({ data, ui, palette, machine, narrow }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const tr = machine.traffic;

  if (!tr || !tr.hasNetwork) {
    return ui.card({
      id: "machine-traffic-card",
      padding: 14,
      gap: 10,
      children: [
        panelHead({
          ui,
          palette,
          icon: "ports",
          title: "Monthly Traffic",
          meta: tr?.periodLabel ?? null,
        }),
        h_flex()
          .w_full()
          .py(12)
          .px(12)
          .rounded(RADII.inner)
          .bg(PALETTE.rowBg)
          .border(1)
          .border_color(PALETTE.line)
          .items_center()
          .justify_between()
          .gap(10)
          .child(
            div()
              .text_size(SIZES.sm)
              .font_semibold()
              .text_color(PALETTE.muted)
              .child("No traffic data"),
          )
          .when(Boolean(machine.collectError), (el) =>
            el.child(
              div()
                .font_family(monoFont())
                .text_size(SIZES.xs)
                .text_color(PALETTE.muted)
                .child(machine.collectError),
            ),
          ),
      ],
    });
  }

  const statCells = [
    { label: "Download", value: formatTrafficBytes(tr.rxTotal), estimate: false },
    { label: "Upload", value: formatTrafficBytes(tr.txTotal), estimate: false },
    { label: "Total", value: formatTrafficBytes(tr.totalB), estimate: false },
    {
      label: "Period end",
      value: formatTrafficBytes(
        tr.countMode === "out" ? tr.projectedForLimit : tr.projectedTotalB,
      ),
      estimate: true,
    },
  ];

  const statsRow = h_flex()
    .w_full()
    .flex_wrap()
    .gap(8)
    .children(
      statCells.map((cell) =>
        v_flex()
          .flex_1()
          .min_w(narrow ? 120 : 106)
          .p(9)
          .gap(4)
          .rounded(RADII.inner)
          .bg(PALETTE.rowBg)
          .border(1)
          .border_color(PALETTE.line)
          .child(
            h_flex()
              .w_full()
              .items_center()
              .justify_between()
              .gap(6)
              .child(
                div()
                  .text_size(SIZES.xs)
                  .font_semibold()
                  .text_color(PALETTE.muted)
                  .child(cell.label),
              )
              .when(cell.estimate, (el) =>
                el.child(
                  ui.chip({
                    label: "estimated",
                    color: PALETTE.mono,
                    bg: PALETTE.raised,
                    borderColor: PALETTE.lineStrong,
                    h: 18,
                    px: 6,
                  }),
                ),
              ),
          )
          .child(
            div()
              .font_family(monoFont())
              .text_size(SIZES.md)
              .font_bold()
              .text_color(PALETTE.text)
              .child(cell.value),
          ),
      ),
    );

  const barColor =
    tr.limitTone === "danger"
      ? PALETTE.danger
      : tr.limitTone === "warn"
        ? PALETTE.warn
        : PALETTE.ok;

  const limitSection = tr.hasLimit
    ? v_flex()
        .w_full()
        .p(10)
        .gap(6)
        .rounded(RADII.inner)
        .bg(
          tr.limitTone === "danger"
            ? PALETTE.dangerSoft
            : tr.limitTone === "warn"
              ? PALETTE.warnSoft
              : PALETTE.rowBg,
        )
        .border(1)
        .border_color(
          tr.limitTone === "danger"
            ? PALETTE.dangerBorder
            : tr.limitTone === "warn"
              ? PALETTE.warnBorder
              : PALETTE.line,
        )
        .child(
          ui.progressBar({
            label: `Monthly limit (${tr.countMode === "out" ? "upload" : "total"} · ${tr.limitCfg.monthly_tb} TB)`,
            valueLabel: `${formatTrafficBytes(tr.usedForLimit)} / ${tr.limitCfg.monthly_tb} TB (${Math.round(tr.usedRatio * 100)}%)`,
            ratio: Math.min(1, tr.usedRatio),
            height: 8,
            color: barColor,
          }),
        )
    : null;

  const maxBar = Math.max(tr.maxDayTotal, 1);
  const dailyBarEls = tr.dailyBars.map((d, idx) => {
    const isToday = idx === tr.dailyBars.length - 1;
    const rxH = d.rx > 0 ? Math.max(2, Math.round((d.rx / maxBar) * TRAFFIC_CHART_H)) : 0;
    const txH = d.tx > 0 ? Math.max(2, Math.round((d.tx / maxBar) * TRAFFIC_CHART_H)) : 0;
    const tip = `${data.formatShortDate(d.date)}: Download ${formatTrafficBytes(d.rx)} · Upload ${formatTrafficBytes(d.tx)} · Total ${formatTrafficBytes(d.total)}`;

    return v_flex()
      .id(`traffic-day-${d.date}`)
      .flex_1()
      .min_w(4)
      .max_w(28)
      .h(TRAFFIC_CHART_H)
      .justify_end()
      .tooltip(tip)
      .when(d.total <= 0, (el) => el.child(div().w_full().h(2).rounded(1).bg(PALETTE.line)))
      .when(d.total > 0, (el) =>
        el.child(
          v_flex()
            .w_full()
            .rounded(3)
            .overflow_hidden()
            .when(isToday, (b) => b.border(1).border_color(PALETTE.ok))
            .when(txH > 0, (b) => b.child(div().w_full().h(txH).bg(PALETTE.muted)))
            .when(rxH > 0, (b) => b.child(div().w_full().h(rxH).bg(PALETTE.accent))),
        ),
      );
  });

  const firstDate = tr.dailyBars[0]?.date;
  const midDate = tr.dailyBars[Math.floor(tr.dailyBars.length / 2)]?.date;
  const lastDate = tr.dailyBars[tr.dailyBars.length - 1]?.date;

  const dailyChart = v_flex()
    .w_full()
    .gap(6)
    .child(
      h_flex()
        .w_full()
        .items_center()
        .justify_between()
        .gap(8)
        .child(
          div()
            .text_size(SIZES.xs)
            .font_semibold()
            .text_color(PALETTE.muted)
            .child("Daily traffic"),
        )
        .child(
          h_flex()
            .items_center()
            .gap(10)
            .child(
              h_flex()
                .items_center()
                .gap(5)
                .text_size(SIZES.xs)
                .text_color(PALETTE.mono)
                .child(div().size(8).rounded(2).bg(PALETTE.accent))
                .child("Download"),
            )
            .child(
              h_flex()
                .items_center()
                .gap(5)
                .text_size(SIZES.xs)
                .text_color(PALETTE.muted)
                .child(div().size(8).rounded(2).bg(PALETTE.muted))
                .child("Upload"),
            ),
        ),
    )
    .child(
      h_flex()
        .w_full()
        .items_stretch()
        .gap(8)
        .child(
          v_flex()
            .w(58)
            .flex_none()
            .h(TRAFFIC_CHART_H)
            .justify_between()
            .items_end()
            .font_family(monoFont())
            .text_size(SIZES.xs)
            .text_color(PALETTE.muted)
            .child(tr.maxDayTotal > 0 ? formatTrafficBytes(tr.maxDayTotal) : "—")
            .child("0"),
        )
        .child(
          h_flex()
            .flex_1()
            .min_w(0)
            .h(TRAFFIC_CHART_H)
            .items_end()
            .gap(3)
            .pb(2)
            .border_b(1)
            .border_color(PALETTE.lineStrong)
            .children(dailyBarEls),
        ),
    )
    .child(
      h_flex()
        .w_full()
        .gap(8)
        .child(div().w(58).flex_none())
        .child(
          h_flex()
            .flex_1()
            .justify_between()
            .font_family(monoFont())
            .text_size(SIZES.xs)
            .text_color(PALETTE.muted)
            .child(data.formatShortDate(firstDate))
            .when(tr.dailyBars.length >= 3, (el) => el.child(data.formatShortDate(midDate)))
            .when(tr.dailyBars.length >= 2, (el) => el.child(data.formatShortDate(lastDate))),
        ),
    );

  const sourceLine =
    tr.source === "vnstat"
      ? tr.ifaces.length > 0
        ? `vnstat · ${maskText(tr.ifaces.join(", "))}`
        : "vnstat"
      : `counters · since ${formatSinceDateTime(tr.since)} · ${countLabel(tr.resets, "reset")} (possible gaps)`;

  return ui.card({
    id: "machine-traffic-card",
    padding: 14,
    gap: 10,
    children: [
      panelHead({
        ui,
        palette,
        icon: "ports",
        title: "Monthly Traffic",
        meta: tr.periodLabel,
      }),
      statsRow,
      ...(limitSection ? [limitSection] : []),
      dailyChart,
      div()
        .w_full()
        .pt(8)
        .border_t(1)
        .border_color(PALETTE.line)
        .font_family(monoFont())
        .text_size(SIZES.xs)
        .text_color(PALETTE.muted)
        .child(sourceLine),
    ],
  });
}

/** Build the "Agents on This Machine" panel. */
function renderMachineAgentsPanel({ ui, palette, jump, maskPath, machine }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const list = machine.machineAgents ?? [];

  const body =
    list.length === 0
      ? v_flex()
          .w_full()
          .py(18)
          .px(12)
          .rounded(RADII.inner)
          .bg(PALETTE.rowBg)
          .border(1)
          .border_color(PALETTE.line)
          .items_center()
          .justify_center()
          .gap(4)
          .child(
            div()
              .text_size(SIZES.sm)
              .font_bold()
              .text_color(PALETTE.text)
              .child("No agents running"),
          )
          .child(
            div()
              .text_size(SIZES.xs)
              .text_color(PALETTE.muted)
              .text_center()
              .child(
                machine.isHerdrMachine
                  ? "This machine has no active agent sessions."
                  : "This node hosts no Herdr agents.",
              ),
          )
      : v_flex()
          .w_full()
          .gap(8)
          .children(
            list.map((a) => {
              const isBlocked = a.status === "blocked";
              const isWorking = a.status === "working";
              const durLabel =
                isWorking && typeof a.workingSince === "number"
                  ? formatDurationMs(Math.max(0, dashboardNow().getTime() - a.workingSince))
                  : "—";

              return v_flex()
                .id(`machine-agent-${a.address}`)
                .w_full()
                .px(12)
                .py(10)
                .gap(6)
                .rounded(RADII.inner)
                .bg(isBlocked ? PALETTE.warnSoft : PALETTE.rowBg)
                .border(1)
                .border_color(isBlocked ? PALETTE.warnBorder : PALETTE.line)
                .cursor_pointer()
                .hover((s) =>
                  s
                    .bg(isBlocked ? PALETTE.warnHover : PALETTE.rowHover)
                    .border_color(PALETTE.lineStrong),
                )
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
                        .gap(8)
                        .child(
                          div()
                            .truncate()
                            .text_size(SIZES.sm)
                            .font_bold()
                            .text_color(PALETTE.text)
                            .child(maskProgram(a.displayProgram)),
                        )
                        .child(
                          ui.chip({
                            label: maskPath(a.space_name || "—"),
                            mono: true,
                            color: PALETTE.mono,
                            bg: PALETTE.raised,
                            borderColor: PALETTE.line,
                            h: 20,
                            px: 7,
                          }),
                        ),
                    )
                    .child(ui.statusWithWord(a.status)),
                )
                .child(
                  h_flex()
                    .w_full()
                    .items_center()
                    .justify_between()
                    .gap(8)
                    .font_family(monoFont())
                    .text_size(SIZES.xs)
                    .text_color(PALETTE.muted)
                    .child(
                      div()
                        .flex_1()
                        .min_w(0)
                        .truncate()
                        .child(maskTitle(a.title || a.tab_name || "—")),
                    )
                    .child(div().flex_none().whitespace_nowrap().child(durLabel)),
                );
            }),
          );

  return ui.card({
    id: "machine-agents-card",
    padding: 14,
    gap: 10,
    children: [
      panelHead({
        ui,
        palette,
        icon: "agents",
        title: "Agents on This Machine",
        meta: countLabel(list.length, "agent"),
      }),
      body,
    ],
  });
}

/** Build the "Docker Containers" panel for remote Herdr machines. */
function renderDockerPanel({
  ui,
  palette,
  maskContainer,
  machine,
  narrow,
  streaming = false,
  canOpenRemoteTab = false,
  dockerLogError = null,
  onOpenContainerLogs = null,
}) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const remote = machine.remote;
  const containers = remote?.containers ?? [];
  const runningCount = containers.filter((c) => c.state === "running").length;
  const canOpenLogs = Boolean(
    !streaming &&
      machine.isHerdrMachine &&
      machine.herdrName &&
      canOpenRemoteTab &&
      onOpenContainerLogs,
  );

  let headerMeta = "—";
  if (remote?.dockerError) {
    headerMeta = "Could not read Docker";
  } else if (remote && !remote.ok) {
    headerMeta = maskError(remote.error) || "unreachable";
  } else if (remote) {
    headerMeta =
      containers.length > 0
        ? `${runningCount}/${containers.length} running`
        : "0 containers";
  }

  let body;
  if (!remote) {
    body = v_flex()
      .w_full()
      .py(16)
      .px(12)
      .rounded(RADII.inner)
      .bg(PALETTE.rowBg)
      .border(1)
      .border_color(PALETTE.line)
      .items_center()
      .justify_center()
      .gap(4)
      .child(
        div()
          .text_size(SIZES.sm)
          .font_bold()
          .text_color(PALETTE.muted)
          .child("Waiting for Docker data"),
      )
      .child(
        div()
          .text_size(SIZES.xs)
          .text_color(PALETTE.muted)
          .text_center()
          .child("Containers appear when the remote collector responds."),
      );
  } else if (!remote.ok) {
    body = v_flex()
      .w_full()
      .py(16)
      .px(12)
      .rounded(RADII.inner)
      .bg(PALETTE.rowBg)
      .border(1)
      .border_color(PALETTE.line)
      .items_center()
      .justify_center()
      .gap(4)
      .child(
        div()
          .text_size(SIZES.sm)
          .font_bold()
          .text_color(PALETTE.muted)
          .child("Could not read remote machine data"),
      )
      .child(
        div()
          .text_size(SIZES.xs)
          .text_color(PALETTE.muted)
          .text_center()
          .child(maskError(remote.error) || "unreachable"),
      );
  } else if (remote.dockerError) {
    body = v_flex()
      .w_full()
      .py(16)
      .px(12)
      .rounded(RADII.inner)
      .bg(PALETTE.warnSoft)
      .border(1)
      .border_color(PALETTE.warnBorder)
      .items_center()
      .justify_center()
      .gap(4)
      .child(
        div()
          .text_size(SIZES.sm)
          .font_bold()
          .text_color(PALETTE.warn)
          .child("Could not read Docker"),
      )
      .child(
        div()
          .text_size(SIZES.xs)
          .text_color(PALETTE.muted)
          .text_center()
          .child("Docker is unavailable or socket access was denied."),
      );
  } else if (containers.length === 0) {
    body = v_flex()
      .w_full()
      .py(16)
      .px(12)
      .rounded(RADII.inner)
      .bg(PALETTE.rowBg)
      .border(1)
      .border_color(PALETTE.line)
      .items_center()
      .justify_center()
      .child(
        div()
          .text_size(SIZES.sm)
          .font_semibold()
          .text_color(PALETTE.muted)
          .child("No containers running"),
      );
  } else {
    body = v_flex()
      .w_full()
      .gap(8)
      .children(
        containers.map((c, idx) => {
          const isRunning = c.state === "running";
          const displayName = maskContainer(c.name, idx);
          const portsDisplay = formatDockerPortsDisplay(c, streaming);
          const memDisplay =
            c.memPerc && c.memPerc !== "—" && c.memUsage && c.memUsage !== "—"
              ? `${c.memUsage} (${c.memPerc})`
              : c.memUsage || "—";
          const netDisplay = c.hasNetIo ? `↓ ${c.netRx} · ↑ ${c.netTx}` : "—";
          const containerKey = c.id || c.name || String(idx);
          const rowError =
            !streaming &&
            dockerLogError &&
            dockerLogError.machineKey === machine.key &&
            dockerLogError.containerKey === containerKey
              ? dockerLogError.message
              : null;

          return v_flex()
            .id(`machine-docker-${c.id || idx}`)
            .w_full()
            .px(12)
            .py(10)
            .gap(7)
            .rounded(RADII.inner)
            .bg(PALETTE.rowBg)
            .border(1)
            .border_color(PALETTE.line)
            .child(
              h_flex()
                .w_full()
                .flex_wrap()
                .items_center()
                .justify_between()
                .gap(8)
                .child(
                  h_flex()
                    .flex_1()
                    .min_w(0)
                    .items_center()
                    .gap(8)
                    .child(
                      div()
                        .size(8)
                        .flex_none()
                        .rounded(8)
                        .bg(isRunning ? PALETTE.ok : PALETTE.offline),
                    )
                    .child(
                      div()
                        .min_w(0)
                        .truncate()
                        .font_family(monoFont())
                        .text_size(SIZES.sm)
                        .font_bold()
                        .text_color(PALETTE.text)
                        .child(displayName),
                    )
                    .child(
                      ui.chip({
                        label: maskText(c.image),
                        mono: true,
                        color: PALETTE.mono,
                        bg: PALETTE.raised,
                        borderColor: PALETTE.line,
                        h: 20,
                        px: 7,
                      }),
                    ),
                )
                .child(
                  h_flex()
                    .flex_none()
                    .items_center()
                    .gap(8)
                    .child(
                      div()
                        .font_family(monoFont())
                        .text_size(SIZES.xs)
                        .font_semibold()
                        .text_color(isRunning ? PALETTE.ok : PALETTE.muted)
                        .whitespace_nowrap()
                        .child(streaming ? (isRunning ? "Running" : c.state === "exited" ? "Stopped" : "—") : c.status),
                    )
                    .when(canOpenLogs, (el) =>
                      el.child(
                        ui.chip({
                          id: `machine-docker-logs-${idx}`,
                          label: "Logs",
                          color: PALETTE.text,
                          bg: PALETTE.raised,
                          borderColor: PALETTE.lineStrong,
                          h: 22,
                          px: 8,
                          onClick: (_e, cx) =>
                            onOpenContainerLogs(machine, c, containerKey, cx),
                        }),
                      ),
                    ),
                ),
            )
            .child(
              h_flex()
                .w_full()
                .flex_wrap()
                .items_center()
                .justify_between()
                .gap(narrow ? 8 : 14)
                .font_family(monoFont())
                .text_size(SIZES.xs)
                .child(
                  h_flex()
                    .min_w(0)
                    .items_center()
                    .gap(6)
                    .child(div().text_color(PALETTE.muted).child("Port:"))
                    .child(
                      div()
                        .text_color(portsDisplay === "—" ? PALETTE.muted : PALETTE.text)
                        .truncate()
                        .child(portsDisplay),
                    ),
                )
                .child(
                  h_flex()
                    .flex_none()
                    .flex_wrap()
                    .items_center()
                    .gap(14)
                    .child(
                      h_flex()
                        .items_center()
                        .gap(5)
                        .child(div().text_color(PALETTE.muted).child("CPU:"))
                        .child(div().text_color(PALETTE.text).font_semibold().child(maskText(c.cpuPerc) || "—")),
                    )
                    .child(
                      h_flex()
                        .items_center()
                        .gap(5)
                        .child(div().text_color(PALETTE.muted).child("Memory:"))
                        .child(div().text_color(PALETTE.text).font_semibold().child(maskText(memDisplay))),
                    ),
                ),
            )
            .child(
              h_flex()
                .w_full()
                .flex_wrap()
                .items_center()
                .justify_between()
                .gap(8)
                .font_family(monoFont())
                .text_size(SIZES.xs)
                .child(
                  h_flex()
                    .flex_wrap()
                    .items_center()
                    .gap(6)
                    .child(div().text_color(PALETTE.muted).child("Network"))
                    .child(
                      div()
                        .text_color(c.hasNetIo ? PALETTE.text : PALETTE.muted)
                        .font_semibold()
                        .child(maskText(netDisplay)),
                    )
                    .child(
                      div()
                        .text_color(PALETTE.muted)
                        .child("since container start"),
                    ),
                )
                .when(Boolean(rowError), (el) =>
                  el.child(
                    ui.chip({
                      id: `machine-docker-log-err-${idx}`,
                      label: rowError,
                      color: PALETTE.danger,
                      bg: PALETTE.dangerSoft,
                      borderColor: PALETTE.dangerBorder,
                      h: 22,
                      px: 8,
                    }),
                  ),
                ),
            );
        }),
      );
  }

  return ui.card({
    id: "machine-docker-card",
    padding: 14,
    gap: 10,
    children: [
      panelHead({
        ui,
        palette,
        icon: "machines",
        iconTone: containers.length > 0 && runningCount > 0 ? "ok" : "normal",
        title: "Docker Containers",
        meta: headerMeta,
      }),
      body,
    ],
  });
}

/** Build the "Open Ports and Access" panel. */
function renderMachinePortsPanel({ data, ui, palette, maskIp, machine }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const ports = machine.ports;
  const pubCount = machine.publicPortsCount;

  let body;
  if (!ports) {
    body = v_flex()
      .w_full()
      .py(18)
      .px(12)
      .rounded(RADII.inner)
      .bg(PALETTE.rowBg)
      .border(1)
      .border_color(PALETTE.line)
      .items_center()
      .justify_center()
      .gap(4)
      .child(
        div()
          .text_size(SIZES.sm)
          .font_bold()
          .text_color(PALETTE.muted)
          .child("No port data"),
      )
      .child(
        div()
          .text_size(SIZES.xs)
          .text_color(PALETTE.muted)
          .text_center()
          .child(
            machine.isHerdrMachine
              ? machine.collectError || "Waiting for port scan results."
              : "Tailscale-only nodes skip port scans.",
          ),
      );
  } else if (ports.length === 0) {
    body = v_flex()
      .w_full()
      .py(18)
      .px(12)
      .rounded(RADII.inner)
      .bg(PALETTE.rowBg)
      .border(1)
      .border_color(PALETTE.line)
      .items_center()
      .justify_center()
      .child(
        div()
          .text_size(SIZES.sm)
          .font_semibold()
          .text_color(PALETTE.muted)
          .child("No listening ports"),
      );
  } else {
    body = v_flex()
      .w_full()
      .gap(6)
      .children(
        ports.map((p) => {
          const isPublic = p.access === "public";
          const isTailnet = p.access === "tailnet";
          const isAllIfaces = p.bindScope === "all";
          const isSpecific = p.bindScope === "specific";
          const chipLabel = p.access === "unknown"
            ? "unknown"
            : isPublic
            ? "public"
            : p.bindLabel
              ? p.bindLabel
              : isTailnet
                ? "tailnet"
                : "local";
          const chipColor = isPublic
            ? PALETTE.danger
            : isAllIfaces
              ? PALETTE.warn
              : isTailnet || isSpecific
                ? PALETTE.text
                : p.bindLabel
                  ? PALETTE.mono
                  : PALETTE.muted;
          const chipBg = isPublic
            ? PALETTE.dangerSoft
            : isAllIfaces
              ? PALETTE.warnSoft
              : isTailnet || isSpecific
                ? PALETTE.raised
                : p.bindLabel
                  ? PALETTE.raised
                  : PALETTE.rowBg;
          const chipBorder = isPublic
            ? PALETTE.dangerBorder
            : isAllIfaces
              ? PALETTE.warnBorder
              : isTailnet || isSpecific
                ? PALETTE.lineStrong
                : p.bindLabel
                  ? PALETTE.lineStrong
                  : PALETTE.line;
          const portText = p.addr ? data.formatAddrPort(maskIp(p.addr), p.port) : `:${p.port}`;
          const funnelBadgePort = p.funnelPort ?? p.funnelDirectPort ?? null;

          return ui.miniRow({
            id: `machine-port-${p.id}`,
            danger: isPublic,
            px: 10,
            py: 7,
            gap: 8,
            children: [
              div()
                .min_w(p.addr ? 120 : 56)
                .flex_none()
                .font_family(monoFont())
                .text_size(SIZES.sm)
                .font_bold()
                .text_color(isPublic ? PALETTE.danger : PALETTE.text)
                .child(portText),
              h_flex()
                .flex_1()
                .min_w(0)
                .items_center()
                .gap(6)
                .child(
                  div()
                    .truncate()
                    .text_size(SIZES.sm)
                    .font_semibold()
                    .text_color(PALETTE.text)
                    .child(maskText(p.process)),
                )
                .when(funnelBadgePort !== null, (el) =>
                  el.child(
                    ui.chip({
                      label: `Funnel :${funnelBadgePort}`,
                      mono: true,
                      color: PALETTE.danger,
                      bg: PALETTE.dangerSoft,
                      borderColor: PALETTE.dangerBorder,
                      h: 20,
                      px: 6,
                    }),
                  ),
                )
                .when(funnelBadgePort === null && p.servePort !== null, (el) =>
                  el.child(
                    ui.chip({
                      label: `Serve :${p.servePort}`,
                      mono: true,
                      color: PALETTE.mono,
                      bg: PALETTE.raised,
                      borderColor: PALETTE.line,
                      h: 20,
                      px: 6,
                    }),
                  ),
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

  const headerMeta = !ports
    ? "—"
    : pubCount > 0
      ? `${pubCount} public`
      : countLabel(ports.length, "port");

  return ui.card({
    id: "machine-ports-card",
    padding: 14,
    gap: 10,
    children: [
      panelHead({
        ui,
        palette,
        icon: "ports",
        iconTone: pubCount > 0 ? "danger" : "normal",
        title: "Open Ports and Access",
        meta: headerMeta,
      }),
      body,
    ],
  });
}

/** Render Screen 3: Machines. */
export function renderMachines({
  data,
  ui,
  palette,
  jump,
  maskHost,
  maskIp,
  maskTailnet,
  maskPath,
  maskContainer = (x) => x,
  limits = {},
  collectEntries = [],
  localEntry = null,
  selectedMachine = null,
  onSelectMachine = () => {},
  pingHistory = null,
  machinesList = [],
  spacesList = [],
  agentsList = [],
  narrow = false,
  streaming = isStreaming(),
  dockerLogError = null,
  onOpenContainerLogs = null,
}) {
  const { models, tailnetName, latestCollectAt } = data.buildMachineModels({
    machinesList,
    agentsList,
    spacesList,
    collectEntries,
    localEntry,
    limitsMap: limits,
    now: dashboardNow(),
  });

  const selected =
    models.find((m) => m.key === selectedMachine) ??
    models.find((m) => m.isLocal) ??
    models[0] ??
    null;

  const listPanel = renderMachineListPanel({
    ui,
    palette,
    maskHost,
    maskTailnet,
    models,
    selectedKey: selected?.key ?? null,
    onSelectMachine,
    tailnetName,
    latestCollectAt,
    narrow,
  });

  if (!selected) {
    const emptyDetail = ui.emptyState({
      icon: "machines",
      title: "No machine selected",
      description: "Select a machine from Herdr or Tailscale to see its details.",
    });
    return narrow
      ? v_flex().w_full().gap(16).child(listPanel).child(emptyDetail)
      : h_flex().w_full().items_start().gap(16).child(listPanel).child(emptyDetail.flex_1().min_w(0));
  }

  const openSupportsMachine = terminalOpenSupportsMachine();
  const canOpenTerminal =
    !isDemo() && (selected.isLocal || (selected.isHerdrMachine && openSupportsMachine));
  const canOpenRemoteTab = remoteTabCommandSupported();

  const heroBand = renderMachineHeroBand({
    ui,
    palette,
    jump,
    maskHost,
    maskIp,
    machine: selected,
    canOpenTerminal,
  });

  const showDockerPanel = Boolean(selected.remote || (!selected.isLocal && selected.isHerdrMachine));
  const dockerPanel = showDockerPanel
    ? renderDockerPanel({
        ui,
        palette,
        maskContainer,
        machine: selected,
        narrow,
        streaming,
        canOpenRemoteTab,
        dockerLogError,
        onOpenContainerLogs,
      })
    : null;

  const resourcesPanel = renderResourcesPanel({ ui, palette, machine: selected });
  const latencyPanel = renderLatencyPanel({ ui, palette, machine: selected, pingHistory });
  const trafficPanel = renderTrafficPanel({ data, ui, palette, machine: selected, narrow });
  const agentsPanel = renderMachineAgentsPanel({ ui, palette, jump, maskPath, machine: selected });
  const portsPanel = renderMachinePortsPanel({ data, ui, palette, maskIp, machine: selected });

  const telemetryRow = narrow
    ? v_flex().w_full().gap(14).child(resourcesPanel.w_full()).child(latencyPanel.w_full())
    : h_flex()
        .w_full()
        .items_stretch()
        .gap(14)
        .child(resourcesPanel.flex_1().min_w(0))
        .child(latencyPanel.flex_1().min_w(0));

  const bottomRow = narrow
    ? v_flex().w_full().gap(14).child(agentsPanel.w_full()).child(portsPanel.w_full())
    : h_flex()
        .w_full()
        .items_stretch()
        .gap(14)
        .child(agentsPanel.flex_1().min_w(0))
        .child(portsPanel.flex_1().min_w(0));

  const detailCol = v_flex()
    .id("machine-detail-panel")
    .flex_1()
    .min_w(0)
    .gap(14)
    .child(heroBand)
    .when(Boolean(dockerPanel), (el) => el.child(dockerPanel))
    .child(telemetryRow)
    .child(trafficPanel)
    .child(bottomRow);

  return narrow
    ? v_flex().w_full().gap(16).child(listPanel).child(detailCol.w_full())
    : h_flex().w_full().items_start().gap(16).child(listPanel).child(detailCol);
}
