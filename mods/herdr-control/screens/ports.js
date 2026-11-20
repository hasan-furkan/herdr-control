// Screen 4: Ports (public exposure risk hero + grouped ports table).

import { maskText } from "../mask.js";
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

const ACCESS_FILTERS = [
  { id: "all", label: "All" },
  { id: "public", label: "Public only" },
  { id: "tailnet", label: "tailnet" },
  { id: "local", label: "local" },
];

/** Shorten OS string for compact server group headers. */
function shortOsLabel(osStr) {
  if (!osStr || typeof osStr !== "string") return null;
  const lower = osStr.toLowerCase();
  if (lower.includes("windows")) return "Windows";
  if (lower.includes("macos") || lower.includes("darwin")) return "macOS";
  if (lower.includes("linux") || lower.includes("ubuntu") || lower.includes("debian")) return "Linux";
  return maskText(osStr.split(/\s+/)[0]) || null;
}

/** Merge Herdr machines, collector results, and Tailscale nodes into server port groups. */
function buildPortGroups({ data, machinesList, spacesList, collectEntries, localEntry }) {
  const entries = collectEntries ?? [];
  const localRes = localEntry?.result ?? null;
  const ts = localRes?.tailscale ?? null;
  const localHostname = localRes?.system?.hostname || null;
  const localTsName = ts?.self?.name || null;

  let selfPingMs = null;
  const selfNames = new Set(
    [localTsName, localHostname].filter(Boolean).map((n) => String(n).toLowerCase()),
  );
  for (const e of entries) {
    if (!e || e.machine === null) continue;
    for (const peer of e.result?.tailscale?.peers ?? []) {
      if (
        peer?.name &&
        selfNames.has(String(peer.name).toLowerCase()) &&
        typeof peer.ping_ms === "number"
      ) {
        selfPingMs = selfPingMs === null ? peer.ping_ms : Math.min(selfPingMs, peer.ping_ms);
      }
    }
  }

  const entryMap = new Map();
  for (const e of entries) {
    if (!e) continue;
    const key = e.machine === null ? "local" : String(e.machine).toLowerCase();
    entryMap.set(key, e);
  }

  const remoteMap = new Map();
  for (const [rName, rEntry] of Object.entries(localRes?.remote ?? {})) {
    if (rName) remoteMap.set(String(rName).toLowerCase(), { name: rName, entry: rEntry });
  }

  const merged = new Map();

  for (const hm of machinesList ?? []) {
    if (!hm) continue;
    const isLocal = hm.name == null;
    const key = isLocal ? "local" : String(hm.name).toLowerCase();
    const cEntry = entryMap.get(key) ?? (isLocal ? localEntry : null);
    const res = cEntry?.result ?? null;
    const sys = res?.system ?? null;
    const tsSelf = res?.tailscale?.self ?? (isLocal ? ts?.self : null);
    const host = isLocal
      ? tsSelf?.name || sys?.hostname || "This computer"
      : hm.name;

    merged.set(key, {
      key,
      isLocal,
      isHerdrMachine: true,
      herdrName: hm.name ?? null,
      herdrLayout: hm.layout ?? null,
      host,
      online: isLocal ? true : hm.layout === "ready",
      os: sys?.os || tsSelf?.os || null,
      pingMs: isLocal ? selfPingMs : null,
      collectorEntry: cEntry,
    });
  }

  if (ts?.self) {
    const prev = merged.get("local");
    merged.set("local", {
      key: "local",
      isLocal: true,
      isHerdrMachine: prev?.isHerdrMachine ?? true,
      herdrName: null,
      herdrLayout: prev?.herdrLayout ?? "ready",
      host: ts.self.name || prev?.host || localHostname || "This computer",
      online: true,
      os: prev?.collectorEntry?.result?.system?.os || ts.self.os || prev?.os || null,
      pingMs: prev?.pingMs ?? selfPingMs,
      collectorEntry: prev?.collectorEntry ?? localEntry,
    });
  }

  for (const peer of ts?.peers ?? []) {
    if (!peer?.name) continue;
    const key = String(peer.name).toLowerCase();
    const prev = merged.get(key);
    const cEntry = prev?.collectorEntry ?? entryMap.get(key) ?? null;
    const sys = cEntry?.result?.system ?? null;
    merged.set(key, {
      key,
      isLocal: Boolean(prev?.isLocal),
      isHerdrMachine: Boolean(prev?.isHerdrMachine),
      herdrName: prev?.herdrName ?? null,
      herdrLayout: prev?.herdrLayout ?? null,
      host: prev?.host || peer.name,
      online: Boolean(peer.online || prev?.online),
      os: sys?.os || peer.os || prev?.os || null,
      pingMs: typeof peer.ping_ms === "number" ? peer.ping_ms : (prev?.pingMs ?? null),
      collectorEntry: cEntry,
    });
  }

  for (const [key, rItem] of remoteMap.entries()) {
    if (!merged.has(key)) {
      const cEntry = entryMap.get(key) ?? null;
      const sys = cEntry?.result?.system ?? null;
      merged.set(key, {
        key,
        isLocal: false,
        isHerdrMachine: true,
        herdrName: rItem.name,
        herdrLayout: rItem.entry?.error ? "unavailable" : "ready",
        host: rItem.name,
        online: !rItem.entry?.error,
        os: sys?.os || "Linux",
        pingMs: null,
        collectorEntry: cEntry,
      });
    }
  }

  const groups = Array.from(merged.values()).map((m) => {
    const res = m.collectorEntry?.result ?? null;
    const serveList = data.tailscaleRoutes(res?.tailscale ?? (m.isLocal ? ts : null));
    const rawPorts = Array.isArray(res?.ports) ? res.ports : null;
    const spacesForMachine = (spacesList ?? []).filter((sp) =>
      m.isLocal ? sp?.machine == null : sp?.machine === m.herdrName,
    );

    const remoteRaw = m.collectorEntry?.error === data.INVALID_COLLECTOR_RESULT
      ? null : remoteMap.get(m.key)?.entry ?? null;
    const remoteInfo = remoteRaw ? data.parseRemoteMachineEntry(remoteRaw) : null;
    const isRemoteSs = Boolean(!rawPorts && remoteInfo?.ports);

    let ports = data.summarizePorts(rawPorts, serveList, spacesForMachine);
    if (!ports && remoteInfo?.ports) {
      ports = remoteInfo.ports.map((p, idx) => ({
        id: `${p.port}-${p.addr}-${idx}`,
        port: p.port,
        addr: p.addr,
        process: p.process || "—",
        access: p.access,
        bindScope: p.bindScope,
        bindLabel: p.bindLabel,
        cwd: null,
        spaceName: "—",
        funnelPort: null,
        servePort: null,
        listenerNote: null,
        since: "—",
      }));
    }

    const counts = { public: 0, tailnet: 0, local: 0, allIfaces: 0, specific: 0, unknown: 0, total: 0 };
    if (ports) {
      for (const p of ports) {
        if (p.access === "public") counts.public += 1;
        else if (p.access === "tailnet") counts.tailnet += 1;
        else if (p.access === "all_interfaces") counts.allIfaces += 1;
        else if (p.access === "specific") counts.specific += 1;
        else if (p.access === "local") counts.local += 1;
        else counts.unknown += 1;
        counts.total += 1;
      }
    }

    const online = Boolean(m.online || remoteInfo?.ok);
    const osShort = shortOsLabel(m.os);
    const baseMeta = m.isLocal
      ? "this computer"
      : osShort || (m.isHerdrMachine ? (online ? "SSH · connected" : "unreachable") : "Tailscale only");
    const pingLabel = m.pingMs !== null && m.pingMs !== undefined ? `${Math.round(m.pingMs)} ms` : "—";

    return {
      ...m,
      online,
      isRemoteSs,
      ports,
      counts,
      baseMeta,
      pingLabel,
    };
  });

  groups.sort((a, b) => {
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
    const aHas = a.ports !== null;
    const bHas = b.ports !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (a.counts.public !== b.counts.public) return b.counts.public - a.counts.public;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return String(a.host).localeCompare(String(b.host));
  });

  return groups;
}

/** Build the hero exposure banner ("EXPOSED TO NETWORK"). */
function renderRiskHero({ ui, palette, maskHost, maskPath, groups, narrow }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;

  const scannedGroups = groups.filter((g) => g.ports !== null);
  const unknownGroups = groups.filter((g) => g.ports === null);
  const hasAnyScan = scannedGroups.length > 0;
  const hasUnknownAccess = scannedGroups.some((g) => g.counts.unknown > 0);

  const publicItems = [];
  let totalPublic = 0;
  let totalTailnet = 0;
  let totalAllIfaces = 0;
  let totalSpecific = 0;
  let totalLocal = 0;

  for (const g of scannedGroups) {
    totalPublic += g.counts.public;
    totalTailnet += g.counts.tailnet;
    totalAllIfaces += g.counts.allIfaces;
    totalSpecific += g.counts.specific;
    totalLocal += g.counts.local;
    for (const p of g.ports) {
      if (p.access === "public") {
        publicItems.push({
          id: `${g.key}-${p.id}`,
          machineHost: g.host,
          port: p.port,
          funnelPort: p.funnelPort,
          process: p.process,
          spaceName: p.spaceName,
        });
      }
    }
  }

  const eyebrowDotColor = !hasAnyScan || (totalPublic === 0 && hasUnknownAccess)
    ? PALETTE.heroMuted
    : totalPublic > 0
      ? PALETTE.danger
      : PALETTE.heroGreen;

  const heroNumber = hasAnyScan && (totalPublic > 0 || !hasUnknownAccess) ? String(totalPublic) : "—";
  const heroTitle = !hasAnyScan
    ? "Waiting for port data"
    : totalPublic === 0
      ? hasUnknownAccess ? "Exposure unknown" : "No public ports"
      : "public ports";
  const heroTitleColor = !hasAnyScan
    ? PALETTE.heroText
    : totalPublic === 0 && !hasUnknownAccess
      ? PALETTE.heroGreen
      : PALETTE.heroText;
  const heroNote = !hasAnyScan
    ? "Waiting for the collector"
    : totalPublic === 0
      ? hasUnknownAccess ? "Some ports have unknown access" : "No ports reachable from the internet"
      : "Reachable from the internet";
  const heroNoteColor = totalPublic > 0 ? PALETTE.heroWarn : PALETTE.heroMuted;

  const summaryBlock = v_flex()
    .when(!narrow, (el) =>
      el
        .w(310)
        .flex_none()
        .pr(18)
        .gap(8)
        .border_r(1)
        .border_color(PALETTE.heroLine),
    )
    .when(narrow, (el) =>
      el
        .w_full()
        .pb(12)
        .gap(8)
        .border_b(1)
        .border_color(PALETTE.heroLine),
    )
    .child(
      h_flex()
        .items_center()
        .gap(8)
        .child(
          div()
            .size(8)
            .flex_none()
            .rounded(8)
            .bg(eyebrowDotColor)
            .when(totalPublic > 0, (el) =>
              el.loop("opacity", { from: 0.4, to: 1, period: 1400 }),
            ),
        )
        .child(
          div()
            .text_size(SIZES.xs)
            .font_bold()
            .text_color(PALETTE.heroMuted)
            .child("EXPOSED TO NETWORK"),
        ),
    )
    .child(
      h_flex()
        .items_center()
        .gap(14)
        .child(
          div()
            .text_size(SIZES.hero)
            .font_bold()
            .font_family(monoFont())
            .text_color(hasAnyScan && totalPublic === 0 ? PALETTE.heroGreen : PALETTE.heroText)
            .child(heroNumber),
        )
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .gap(3)
            .child(
              div()
                .text_size(SIZES.lg)
                .font_bold()
                .text_color(heroTitleColor)
                .child(heroTitle),
            )
            .child(
              div()
                .text_size(SIZES.sm)
                .font_semibold()
                .text_color(heroNoteColor)
                .child(heroNote),
            ),
        ),
    );

  const summaryParts = [];
  if (totalPublic > 0 || totalTailnet > 0 || !hasAnyScan) {
    summaryParts.push(`${totalTailnet} tailnet`);
  }
  if (totalAllIfaces > 0) summaryParts.push(`${totalAllIfaces} all interfaces`);
  if (totalSpecific > 0) summaryParts.push(`${totalSpecific} specific interfaces`);
  summaryParts.push(`${totalLocal} local`);
  const summaryLine = summaryParts.join(" · ");

  let detailMain;
  if (!hasAnyScan || (totalPublic === 0 && hasUnknownAccess)) {
    detailMain = h_flex()
      .w_full()
      .items_center()
      .gap(10)
      .px(14)
      .py(12)
      .rounded(RADII.inner)
      .bg(PALETTE.onAccentSoft)
      .border(1)
      .border_color(PALETTE.heroLine)
      .child(ui.iconOf("ports", 16, PALETTE.heroMuted))
      .child(
        div()
          .text_size(SIZES.sm)
          .font_semibold()
          .text_color(PALETTE.heroMuted)
          .child(hasAnyScan ? heroNote : "Open ports and Funnel status appear after the collector runs."),
      );
  } else if (totalPublic === 0) {
    detailMain = h_flex()
      .w_full()
      .items_center()
      .justify_between()
      .flex_wrap()
      .gap(10)
      .px(14)
      .py(12)
      .rounded(RADII.inner)
      .bg(PALETTE.okSoft)
      .border(1)
      .border_color(PALETTE.okBorder)
      .child(
        h_flex()
          .items_center()
          .gap(9)
          .child(div().size(8).flex_none().rounded(8).bg(PALETTE.heroGreen))
          .child(
            div()
              .text_size(SIZES.md)
              .font_bold()
              .text_color(PALETTE.heroGreen)
              .child("No public ports"),
          ),
      )
      .child(
        div()
          .font_family(monoFont())
          .text_size(SIZES.xs)
          .font_semibold()
          .text_color(PALETTE.heroMuted)
          .child(summaryLine),
      );
  } else {
    detailMain = v_flex()
      .w_full()
      .gap(8)
      .children(
        publicItems.map((item) => {
          const routeLabel = item.funnelPort
            ? `${maskHost(item.machineHost)} :${item.port} → Funnel ${item.funnelPort} · ${maskText(item.process)}`
            : `${maskHost(item.machineHost)} :${item.port} · ${maskText(item.process)}`;
          return h_flex()
            .id(`hero-public-${item.id}`)
            .w_full()
            .items_center()
            .justify_between()
            .flex_wrap()
            .gap(10)
            .px(14)
            .py(10)
            .rounded(RADII.inner)
            .bg(PALETTE.dangerSoft)
            .border(1)
            .border_color(PALETTE.dangerBorder)
            .child(
              h_flex()
                .flex_1()
                .min_w(0)
                .items_center()
                .gap(9)
                .child(ui.iconOf("alert", 16, PALETTE.danger))
                .child(
                  div()
                    .flex_1()
                    .min_w(0)
                    .truncate()
                    .font_family(monoFont())
                    .text_size(SIZES.md)
                    .font_bold()
                    .text_color(PALETTE.heroText)
                    .tooltip(routeLabel)
                    .child(routeLabel),
                ),
            )
            .child(
              ui.chip({
                label: "public",
                color: PALETTE.onAccent,
                bg: PALETTE.danger,
                borderColor: PALETTE.danger,
                h: 24,
                px: 10,
              }),
            );
        }),
      );
  }

  const footItems = [];
  if (publicItems.length > 0 && publicItems[0].spaceName !== "—") {
    footItems.push(`Space: ${maskPath(publicItems[0].spaceName)}`);
  }
  if (hasAnyScan) {
    footItems.push(`Total: ${totalPublic} public · ${summaryLine}`);
  }
  if (unknownGroups.length > 0) {
    footItems.push(`No port data for ${unknownGroups.length} servers`);
  }

  const detailBlock = v_flex()
    .flex_1()
    .min_w(0)
    .justify_center()
    .gap(10)
    .child(detailMain)
    .when(footItems.length > 0, (el) =>
      el.child(
        div()
          .font_family(monoFont())
          .text_size(SIZES.xs)
          .text_color(PALETTE.heroMuted)
          .child(footItems.join("  ·  ")),
      ),
    );

  return ui.heroCard({
    id: "ports-hero",
    padding: narrow ? 16 : 18,
    gap: 14,
    children: [
      narrow
        ? v_flex().w_full().gap(12).child(summaryBlock).child(detailBlock)
        : h_flex().w_full().items_center().gap(20).child(summaryBlock).child(detailBlock),
    ],
  });
}

/** Build an exposure badge chip for a single listening port row. */
function renderExposureChip({ ui, palette, portItem }) {
  const { PALETTE } = palette;
  const access = portItem.access;
  if (access === "public") {
    return ui.chip({
      label: "public",
      color: PALETTE.onAccent,
      bg: PALETTE.danger,
      borderColor: PALETTE.danger,
      h: 22,
      px: 8,
    });
  }
  if (portItem.bindLabel && access !== "unknown") {
    if (portItem.bindScope === "all") {
      return ui.chip({
        label: portItem.bindLabel,
        color: PALETTE.warn,
        bg: PALETTE.warnSoft,
        borderColor: PALETTE.warnBorder,
        h: 22,
        px: 8,
      });
    }
    if (portItem.bindScope === "specific") {
      return ui.chip({
        label: portItem.bindLabel,
        color: PALETTE.text,
        bg: PALETTE.accentSoft,
        borderColor: PALETTE.accentBorder,
        h: 22,
        px: 8,
      });
    }
    return ui.chip({
      label: portItem.bindLabel,
      color: PALETTE.mono,
      bg: PALETTE.raised,
      borderColor: PALETTE.lineStrong,
      h: 22,
      px: 8,
    });
  }
  if (access === "tailnet") {
    return ui.chip({
      label: "tailnet",
      color: PALETTE.text,
      bg: PALETTE.accentSoft,
      borderColor: PALETTE.accentBorder,
      h: 22,
      px: 8,
    });
  }
  return ui.chip({
    label: access === "unknown" ? "unknown" : "local",
    color: PALETTE.mono,
    bg: PALETTE.raised,
    borderColor: PALETTE.lineStrong,
    h: 22,
    px: 8,
  });
}

/** Build the compact dot cluster ("port map") for a server header bar. */
function renderPortDotMap({ palette, counts }) {
  const { PALETTE } = palette;
  const dots = [];
  for (let i = 0; i < Math.min(counts.public, 4); i++) dots.push(PALETTE.danger);
  for (let i = 0; i < Math.min(counts.allIfaces, 4) && dots.length < 8; i++) dots.push(PALETTE.warn);
  for (let i = 0; i < Math.min(counts.tailnet + counts.specific, 6) && dots.length < 8; i++) {
    dots.push(PALETTE.accent);
  }
  for (let i = 0; i < Math.min(counts.local, 6) && dots.length < 8; i++) dots.push(PALETTE.offline);

  if (dots.length === 0) return null;

  return h_flex()
    .flex_none()
    .items_center()
    .gap(3)
    .children(dots.map((col) => div().size(6).flex_none().rounded(6).bg(col)));
}

/** Build a single listening port row (responsive between wide table row and stacked narrow row). */
function renderPortRow({ data, ui, palette, maskIp, maskPath, groupKey, portItem, narrow }) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const isPublic = portItem.access === "public";
  const spaceDisplay = portItem.spaceName !== "—" ? maskPath(portItem.spaceName) : "—";
  const endpointLabel = portItem.addr
    ? data.formatAddrPort(maskIp(portItem.addr), portItem.port)
    : `:${portItem.port}`;

  const funnelBadge = portItem.funnelPort
    ? ui.chip({
        label: `→ Funnel ${portItem.funnelPort}`,
        mono: true,
        color: PALETTE.danger,
        bg: PALETTE.dangerSoft,
        borderColor: PALETTE.dangerBorder,
        h: 20,
        px: 6,
      })
    : portItem.servePort
      ? ui.chip({
          label: `→ Serve ${portItem.servePort}`,
          mono: true,
          color: PALETTE.mono,
          bg: PALETTE.raised,
          borderColor: PALETTE.lineStrong,
          h: 20,
          px: 6,
        })
      : portItem.listenerNote
        ? ui.chip({
            label: portItem.listenerNote,
            mono: true,
            color: PALETTE.muted,
            bg: PALETTE.rowBg,
            borderColor: PALETTE.line,
            h: 20,
            px: 6,
          })
        : null;

  if (narrow) {
    return v_flex()
      .id(`port-row-${groupKey}-${portItem.id}`)
      .w_full()
      .px(10)
      .py(8)
      .gap(6)
      .rounded(RADII.inner)
      .bg(isPublic ? PALETTE.dangerSoft : PALETTE.rowBg)
      .border(1)
      .border_color(isPublic ? PALETTE.dangerBorder : PALETTE.line)
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
                  .flex_none()
                  .font_family(monoFont())
                  .text_size(SIZES.sm)
                  .font_bold()
                  .text_color(isPublic ? PALETTE.danger : PALETTE.text)
                  .child(endpointLabel),
              )
              .child(
                div()
                  .flex_1()
                  .min_w(0)
                  .truncate()
                  .text_size(SIZES.sm)
                  .font_semibold()
                  .text_color(PALETTE.text)
                  .child(maskText(portItem.process)),
              ),
          )
          .child(renderExposureChip({ ui, palette, portItem })),
      )
      .child(
        h_flex()
          .w_full()
          .flex_wrap()
          .items_center()
          .justify_between()
          .gap(8)
          .child(
            h_flex()
              .items_center()
              .gap(6)
              .when(Boolean(funnelBadge), (el) => el.child(funnelBadge))
              .child(
                div()
                  .font_family(monoFont())
                  .text_size(SIZES.xs)
                  .text_color(PALETTE.muted)
                  .child(`Space: ${spaceDisplay}`),
              ),
          )
          .child(
            div()
              .font_family(monoFont())
              .text_size(SIZES.xs)
              .text_color(PALETTE.muted)
              .child(`Duration: ${portItem.since}`),
          ),
      );
  }

  return h_flex()
    .id(`port-row-${groupKey}-${portItem.id}`)
    .w_full()
    .px(10)
    .py(6)
    .gap(10)
    .items_center()
    .rounded(RADII.chip)
    .bg(isPublic ? PALETTE.dangerSoft : PALETTE.rowBg)
    .border(1)
    .border_color(isPublic ? PALETTE.dangerBorder : PALETTE.line)
    .child(
      div()
        .w(188)
        .flex_none()
        .truncate()
        .font_family(monoFont())
        .text_size(SIZES.sm)
        .font_bold()
        .text_color(isPublic ? PALETTE.danger : PALETTE.text)
        .child(endpointLabel),
    )
    .child(
      h_flex()
        .flex_1()
        .min_w(0)
        .items_center()
        .gap(8)
        .child(
          div()
            .min_w(0)
            .truncate()
            .text_size(SIZES.sm)
            .font_semibold()
            .text_color(portItem.process === "—" ? PALETTE.muted : PALETTE.text)
            .child(maskText(portItem.process)),
        )
        .when(Boolean(funnelBadge), (el) => el.child(funnelBadge)),
    )
    .child(
      h_flex()
        .w(136)
        .flex_none()
        .items_center()
        .child(
          spaceDisplay !== "—"
            ? div()
                .max_w(130)
                .truncate()
                .px(7)
                .py(2)
                .rounded(5)
                .bg(PALETTE.rowBg)
                .border(1)
                .border_color(PALETTE.line)
                .font_family(monoFont())
                .text_size(SIZES.xs)
                .font_semibold()
                .text_color(PALETTE.mono)
                .child(spaceDisplay)
            : div()
                .font_family(monoFont())
                .text_size(SIZES.xs)
                .text_color(PALETTE.muted)
                .child("—"),
        ),
    )
    .child(
      h_flex()
        .w(148)
        .flex_none()
        .items_center()
        .child(renderExposureChip({ ui, palette, portItem })),
    )
    .child(
      div()
        .w(84)
        .flex_none()
        .text_right()
        .font_family(monoFont())
        .text_size(SIZES.xs)
        .text_color(PALETTE.muted)
        .child(portItem.since),
    );
}

/** Build one server group (header bar + expanded listening rows, or unknown-ports line). */
function renderServerGroup({
  data,
  ui,
  palette,
  maskHost,
  maskIp,
  maskPath,
  group,
  accessFilter,
  collapsed,
  onToggleCollapse,
  narrow,
}) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const hostLabel = maskHost(group.host);

  if (group.ports === null) {
    return h_flex()
      .id(`port-group-${group.key}`)
      .w_full()
      .flex_wrap()
      .items_center()
      .justify_between()
      .gap(10)
      .px(12)
      .py(8)
      .rounded(RADII.chip)
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
              .font_family(monoFont())
              .text_size(SIZES.sm)
              .font_bold()
              .text_color(PALETTE.text)
              .truncate()
              .child(hostLabel),
          )
          .child(
            div()
              .text_size(SIZES.xs)
              .text_color(PALETTE.muted)
              .whitespace_nowrap()
              .child(`${group.baseMeta} · ${group.pingLabel}`),
          ),
      )
      .child(
        div()
          .font_family(monoFont())
          .text_size(SIZES.xs)
          .font_semibold()
          .text_color(PALETTE.muted)
          .child("No port data"),
      );
  }

  const filteredPorts =
    accessFilter === "all"
      ? group.ports
      : group.ports.filter((p) => p.access === accessFilter);

  const dotMap = renderPortDotMap({ palette, counts: group.counts });

  const countsRow = group.isRemoteSs
    ? h_flex()
        .items_center()
        .gap(5)
        .font_family(monoFont())
        .text_size(SIZES.xs)
        .child(
          div()
            .text_color(group.counts.allIfaces > 0 ? PALETTE.warn : PALETTE.muted)
            .when(group.counts.allIfaces > 0, (e) => e.font_bold())
            .whitespace_nowrap()
            .child(`${group.counts.allIfaces} all interfaces`),
        )
        .when(group.counts.specific > 0, (el) =>
          el
            .child(div().text_color(PALETTE.lineStrong).child("·"))
            .child(
              div()
                .text_color(PALETTE.mono)
                .whitespace_nowrap()
                .child(`${group.counts.specific} specific interfaces`),
            ),
        )
        .child(div().text_color(PALETTE.lineStrong).child("·"))
        .child(
          div()
            .text_color(PALETTE.muted)
            .whitespace_nowrap()
            .child(`${group.counts.local} this machine only`),
        )
    : h_flex()
        .items_center()
        .gap(5)
        .font_family(monoFont())
        .text_size(SIZES.xs)
        .child(
          div()
            .text_color(group.counts.public > 0 ? PALETTE.danger : PALETTE.muted)
            .when(group.counts.public > 0, (e) => e.font_bold())
            .whitespace_nowrap()
            .child(`${group.counts.public} public`),
        )
        .child(div().text_color(PALETTE.lineStrong).child("·"))
        .child(
          div()
            .text_color(group.counts.tailnet > 0 ? PALETTE.mono : PALETTE.muted)
            .whitespace_nowrap()
            .child(`${group.counts.tailnet} tailnet`),
        )
        .child(div().text_color(PALETTE.lineStrong).child("·"))
        .child(
          div()
            .text_color(PALETTE.muted)
            .whitespace_nowrap()
            .child(`${group.counts.local} local`),
        );

  const headerBar = h_flex()
    .id(`port-group-head-${group.key}`)
    .w_full()
    .flex_wrap()
    .items_center()
    .justify_between()
    .gap(10)
    .px(10)
    .py(7)
    .rounded(RADII.chip)
    .bg(PALETTE.raised)
    .border(1)
    .border_color(PALETTE.line)
    .cursor_pointer()
    .hover((s) => s.bg(PALETTE.raisedHover).border_color(PALETTE.lineStrong))
    .on_click((_e, cx) => onToggleCollapse(group.key, cx))
    .child(
      h_flex()
        .items_center()
        .gap(7)
        .min_w(0)
        .child(
          div()
            .w(14)
            .flex_none()
            .text_center()
            .font_family(monoFont())
            .text_size(SIZES.xs)
            .text_color(PALETTE.muted)
            .child(collapsed ? "▸" : "▾"),
        )
        .child(
          div()
            .size(7)
            .flex_none()
            .rounded(7)
            .bg(group.online ? PALETTE.ok : PALETTE.offline),
        )
        .child(
          div()
            .font_family(monoFont())
            .text_size(SIZES.sm)
            .font_bold()
            .text_color(PALETTE.text)
            .truncate()
            .child(hostLabel),
        )
        .child(
          div()
            .font_family(monoFont())
            .text_size(SIZES.xs)
            .text_color(PALETTE.muted)
            .whitespace_nowrap()
            .child(`${group.baseMeta} · ${group.pingLabel}`),
        ),
    )
    .child(
      h_flex()
        .flex_wrap()
        .items_center()
        .gap(10)
        .when(Boolean(dotMap), (el) => el.child(dotMap))
        .child(countsRow),
    );

  if (collapsed) {
    return v_flex().id(`port-group-${group.key}`).w_full().child(headerBar);
  }

  const bodyRows =
    filteredPorts.length > 0
      ? filteredPorts.map((portItem) =>
          renderPortRow({
            data,
            ui,
            palette,
            maskIp,
            maskPath,
            groupKey: group.key,
            portItem,
            narrow,
          }),
        )
      : [
          div()
            .w_full()
            .px(12)
            .py(8)
            .rounded(RADII.chip)
            .bg(PALETTE.rowBg)
            .border(1)
            .border_color(PALETTE.line)
            .text_size(SIZES.xs)
            .text_color(PALETTE.muted)
            .child(
              group.ports.length === 0
                ? "No TCP ports are listening on this server."
                : "No ports match this access filter.",
            ),
        ];

  return v_flex()
    .id(`port-group-${group.key}`)
    .w_full()
    .gap(5)
    .child(headerBar)
    .children(bodyRows);
}

/** Build the grouped "Ports by Server" table card. */
function renderPortsTableCard({
  data,
  ui,
  palette,
  maskHost,
  maskIp,
  maskPath,
  groups,
  accessFilter,
  onAccessFilter,
  machineFilter,
  onMachineFilter,
  machineMenuOpen,
  onToggleMachineMenu,
  collapsedMachines,
  onToggleCollapse,
  narrow,
}) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;

  const scannedGroups = groups.filter((g) => g.ports !== null);
  const totalListening = scannedGroups.reduce((sum, g) => sum + g.counts.total, 0);

  const visibleGroups =
    machineFilter === "all"
      ? groups
      : groups.filter((g) => g.key === machineFilter);

  const selectedMachineObj = groups.find((g) => g.key === machineFilter) ?? null;
  const machineFilterLabel = selectedMachineObj ? maskHost(selectedMachineObj.host) : "all";

  const segmentedFilters = h_flex()
    .flex_wrap()
    .items_center()
    .p(3)
    .gap(2)
    .rounded(RADII.pill)
    .bg(PALETTE.surfaceDark)
    .border(1)
    .border_color(PALETTE.line)
    .children(
      ACCESS_FILTERS.map((f) => {
        const active = accessFilter === f.id;
        return h_flex()
          .id(`ports-filter-${f.id}`)
          .h(26)
          .px(10)
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
            el.text_color(PALETTE.muted).hover((s) => s.text_color(PALETTE.text)),
          )
          .on_click((_e, cx) => onAccessFilter(f.id, cx))
          .child(f.label);
      }),
    );

  const serverChip = h_flex()
    .id("ports-server-filter-btn")
    .h(32)
    .px(11)
    .gap(5)
    .rounded(RADII.pill)
    .items_center()
    .bg(machineMenuOpen || machineFilter !== "all" ? PALETTE.raised : PALETTE.surface)
    .border(1)
    .border_color(machineMenuOpen || machineFilter !== "all" ? PALETTE.lineStrong : PALETTE.line)
    .cursor_pointer()
    .hover((s) => s.bg(PALETTE.raisedHover).border_color(PALETTE.lineStrong))
    .on_click((_e, cx) => onToggleMachineMenu(cx))
    .child(
      div()
        .text_size(SIZES.xs)
        .font_semibold()
        .text_color(PALETTE.muted)
        .child("Server:"),
    )
    .child(
      div()
        .text_size(SIZES.xs)
        .font_bold()
        .font_family(monoFont())
        .text_color(PALETTE.text)
        .child(machineFilterLabel),
    )
    .child(
      div()
        .text_size(SIZES.xs)
        .text_color(PALETTE.muted)
        .child(machineMenuOpen ? "▴" : "▾"),
    );

  const headerRow = h_flex()
    .w_full()
    .flex_wrap()
    .items_center()
    .justify_between()
    .gap(10)
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
            .child(ui.iconOf("ports", 15, PALETTE.text)),
        )
        .child(
          div()
            .text_size(SIZES.title)
            .font_bold()
            .text_color(PALETTE.text)
            .child("Ports by Server"),
        )
        .child(
          ui.chip({
            label: scannedGroups.length > 0 ? `${totalListening} listening` : "—",
            mono: true,
            color: PALETTE.mono,
            bg: PALETTE.rowBg,
            borderColor: PALETTE.line,
            h: 22,
            px: 8,
          }),
        ),
    )
    .child(
      h_flex()
        .flex_wrap()
        .items_center()
        .gap(8)
        .child(segmentedFilters)
        .when(groups.length > 1, (el) => el.child(serverChip)),
    );

  const machineSelectorBar =
    machineMenuOpen && groups.length > 1
      ? h_flex()
          .id("ports-server-chips")
          .w_full()
          .flex_wrap()
          .items_center()
          .gap(6)
          .p(8)
          .rounded(RADII.inner)
          .bg(PALETTE.surfaceDark)
          .border(1)
          .border_color(PALETTE.line)
          .child(
            ui.chip({
              id: "ports-srv-all",
              label: "All",
              active: machineFilter === "all",
              onClick: (_e, cx) => onMachineFilter("all", cx),
            }),
          )
          .children(
            groups.map((g) =>
              ui.chip({
                id: `ports-srv-${g.key}`,
                label: maskHost(g.host),
                mono: true,
                active: machineFilter === g.key,
                onClick: (_e, cx) => onMachineFilter(g.key, cx),
              }),
            ),
          )
      : null;

  const columnHeaderRow =
    !narrow && visibleGroups.length > 0
      ? h_flex()
          .w_full()
          .px(10)
          .pb(6)
          .gap(10)
          .border_b(1)
          .border_color(PALETTE.lineStrong)
          .text_size(SIZES.xs)
          .font_bold()
          .text_color(PALETTE.muted)
          .child(div().w(188).flex_none().child("Address : Port"))
          .child(div().flex_1().min_w(0).child("Process / Service"))
          .child(div().w(136).flex_none().child("Space"))
          .child(div().w(148).flex_none().text_color(PALETTE.text).child("Access"))
          .child(div().w(84).flex_none().text_right().child("Duration"))
      : null;

  const honestNote = div()
    .id("ports-honest-note")
    .w_full()
    .px(10)
    .py(7)
    .rounded(RADII.chip)
    .bg(PALETTE.rowBg)
    .border(1)
    .border_color(PALETTE.line)
    .text_size(SIZES.xs)
    .text_color(PALETTE.muted)
    .child(
      "For ports listening on all interfaces (0.0.0.0 / ::), internet access depends on the firewall and provider.",
    );

  const expandedScannedCount = visibleGroups.filter(
    (g) => g.ports !== null && !collapsedMachines?.has(g.key),
  ).length;
  const collapsedScannedCount = visibleGroups.filter(
    (g) => g.ports !== null && collapsedMachines?.has(g.key),
  ).length;

  const legend = h_flex()
    .flex_wrap()
    .items_center()
    .gap(10)
    .px(10)
    .py(4)
    .rounded(RADII.pill)
    .bg(PALETTE.rowBg)
    .border(1)
    .border_color(PALETTE.line)
    .text_size(SIZES.xs)
    .child(div().font_semibold().text_color(PALETTE.muted).child("port map:"))
    .child(
      h_flex()
        .items_center()
        .gap(5)
        .child(div().size(7).rounded(7).bg(PALETTE.danger))
        .child(div().font_semibold().text_color(PALETTE.mono).child("public")),
    )
    .child(
      h_flex()
        .items_center()
        .gap(5)
        .child(div().size(7).rounded(7).bg(PALETTE.warn))
        .child(div().font_semibold().text_color(PALETTE.mono).child("all interfaces")),
    )
    .child(
      h_flex()
        .items_center()
        .gap(5)
        .child(div().size(7).rounded(7).bg(PALETTE.accent))
        .child(div().font_semibold().text_color(PALETTE.mono).child("tailnet")),
    )
    .child(
      h_flex()
        .items_center()
        .gap(5)
        .child(div().size(7).rounded(7).bg(PALETTE.offline))
        .child(div().font_semibold().text_color(PALETTE.mono).child("local / this machine only")),
    );

  const footSummary =
    collapsedScannedCount > 0
      ? `${expandedScannedCount} expanded · ${collapsedScannedCount} collapsed`
      : `${visibleGroups.length} servers`;

  const bodyContent =
    visibleGroups.length === 0
      ? ui.emptyState({
          icon: "ports",
          title: "No servers found",
          description: "Machines and listening ports appear after the collector runs.",
        })
      : v_flex()
          .w_full()
          .gap(10)
          .children(
            visibleGroups.map((group) =>
              renderServerGroup({
                data,
                ui,
                palette,
                maskHost,
                maskIp,
                maskPath,
                group,
                accessFilter,
                collapsed: Boolean(collapsedMachines?.has(group.key)),
                onToggleCollapse,
                narrow,
              }),
            ),
          );

  return ui.card({
    id: "ports-table-card",
    padding: narrow ? 14 : 16,
    gap: 10,
    children: [
      headerRow,
      machineSelectorBar,
      honestNote,
      columnHeaderRow,
      bodyContent,
      h_flex()
        .w_full()
        .flex_wrap()
        .items_center()
        .justify_between()
        .gap(10)
        .pt(8)
        .border_t(1)
        .border_color(PALETTE.line)
        .child(legend)
        .child(
          div()
            .font_family(monoFont())
            .text_size(SIZES.xs)
            .text_color(PALETTE.muted)
            .child(footSummary),
        ),
    ].filter(Boolean),
  });
}

export function renderPorts({
  data,
  ui,
  palette,
  maskHost,
  maskIp = (x) => x,
  maskPath,
  collectEntries = [],
  localEntry = null,
  machinesList = [],
  spacesList = [],
  accessFilter = "all",
  onAccessFilter = () => {},
  machineFilter = "all",
  onMachineFilter = () => {},
  machineMenuOpen = false,
  onToggleMachineMenu = () => {},
  collapsedMachines = new Set(),
  onToggleCollapse = () => {},
  narrow = false,
}) {
  const groups = buildPortGroups({
    data,
    machinesList,
    spacesList,
    collectEntries,
    localEntry,
  });

  const hero = renderRiskHero({
    ui,
    palette,
    maskHost,
    maskPath,
    groups,
    narrow,
  });

  const tableCard = renderPortsTableCard({
    data,
    ui,
    palette,
    maskHost,
    maskIp,
    maskPath,
    groups,
    accessFilter,
    onAccessFilter,
    machineFilter,
    onMachineFilter,
    machineMenuOpen,
    onToggleMachineMenu,
    collapsedMachines,
    onToggleCollapse,
    narrow,
  });

  return v_flex().w_full().gap(14).child(hero).child(tableCard);
}
