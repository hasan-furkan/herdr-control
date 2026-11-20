// Screen 6: Approvals (blocked agents requiring a user decision).

import { dashboardNow, isDemo } from "../demo-mode.js";
import { dashboardAgents } from "../source.js";
import { DEMO_DECISIONS } from "../demo.js";
import { maskError, maskProgram, maskText, maskTitle } from "../mask.js";
import { countLabel } from "../data.js";
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { hc } from "herdr";

const DECISIONS_STORAGE_KEY = "herdr-control.approvals-today";

function todayIsoDate() {
  const d = dashboardNow();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function readTodayDecisions() {
  if (isDemo()) return DEMO_DECISIONS;
  try {
    const raw = JSON.parse(localStorage.getItem(DECISIONS_STORAGE_KEY) ?? "null");
    if (raw && raw.date === todayIsoDate()) {
      return {
        approved: Number(raw.approved) || 0,
        rejected: Number(raw.rejected) || 0,
      };
    }
  } catch {}
  return { approved: 0, rejected: 0 };
}

function recordTodayDecision(kind) {
  const cur = readTodayDecisions();
  const next = {
    date: todayIsoDate(),
    approved: cur.approved + (kind === "approve" ? 1 : 0),
    rejected: cur.rejected + (kind === "reject" ? 1 : 0),
  };
  try {
    localStorage.setItem(DECISIONS_STORAGE_KEY, JSON.stringify(next));
  } catch {}
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

function maskAddress(address, maskHost) {
  if (!address || typeof address !== "string") return "—";
  const slash = address.indexOf("/");
  if (slash === -1) return maskText(address);
  return `${maskHost(address.slice(0, slash))}/${maskText(address.slice(slash + 1))}`;
}

function actionButton({ PALETTE, SIZES, RADII, id, label, primary = false, danger = false, disabled = false, compact = false, onClick }) {
  const bg = primary
    ? PALETTE.accent
    : danger
      ? PALETTE.dangerSoft
      : PALETTE.raised;
  const text = primary
    ? PALETTE.onAccent
    : danger
      ? PALETTE.danger
      : PALETTE.text;
  const border = primary
    ? PALETTE.accent
    : danger
      ? PALETTE.dangerBorder
      : PALETTE.lineStrong;
  const hoverBg = primary
    ? PALETTE.accentHover
    : danger
      ? PALETTE.dangerSoft
      : PALETTE.raisedHover;

  return h_flex()
    .id(id)
    .h(compact ? 28 : 32)
    .px(compact ? 10 : 12)
    .rounded(RADII.chip)
    .bg(bg)
    .border(1)
    .border_color(border)
    .items_center()
    .justify_center()
    .text_size(SIZES.xs)
    .font_bold()
    .text_color(text)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(hoverBg)).on_click(onClick))
    .when(disabled, (el) => el.opacity(0.6))
    .child(label);
}

/** Shared inline "Are you sure? Yes / Cancel" confirmation bar reused across screens. */
export function renderInlineConfirm({
  palette,
  idPrefix,
  text = "Are you sure?",
  confirmLabel = "Yes",
  cancelLabel = "Cancel",
  confirmPrimary = false,
  confirmDanger = false,
  disabled = false,
  compact = false,
  borderColor = null,
  onConfirm,
  onCancel,
}) {
  const { PALETTE, SIZES } = palette;
  const stop = (_e, cx) => cx.stop_propagation();

  return (compact ? v_flex() : h_flex())
    .w_full()
    .when(compact, (b) => b.items_stretch().gap(6))
    .when(!compact, (b) => b.items_center().justify_end().gap(8))
    .pt(8)
    .border_t(1)
    .border_color(borderColor ?? PALETTE.lineStrong)
    .on_mouse_down("left", stop)
    .on_click(stop)
    .child(
      div()
        .text_size(SIZES.xs)
        .font_semibold()
        .text_color(PALETTE.text)
        .child(text),
    )
    .child(
      h_flex()
        .items_center()
        .justify_end()
        .gap(compact ? 6 : 8)
        .child(
          actionButton({
            PALETTE,
            SIZES,
            RADII: palette.RADII,
            id: `${idPrefix}-yes`,
            label: confirmLabel,
            primary: confirmPrimary,
            danger: confirmDanger,
            disabled,
            compact,
            onClick: (e, cx) => {
              cx.stop_propagation();
              onConfirm(e, cx);
            },
          }),
        )
        .child(
          actionButton({
            PALETTE,
            SIZES,
            RADII: palette.RADII,
            id: `${idPrefix}-cancel`,
            label: cancelLabel,
            disabled,
            compact,
            onClick: (e, cx) => {
              cx.stop_propagation();
              onCancel(e, cx);
            },
          }),
        ),
    );
}

/** Render a single blocked agent approval card with Inspect and (for Claude) Approve/Reject + inline confirm. */
export function renderApprovalItem({
  agent,
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
  onSetError = null,
  compact = false,
  idPrefix = "approval",
}) {
  const { PALETTE, SIZES, RADII, monoFont } = palette;
  const a = agent;
  const progName = maskProgram(a.program?.name || a.app || "Agent");
  const pic = ui.programIcon(a.program, compact ? 14 : 16, PALETTE.text);
  const spaceLabel = maskPath(a.space_name || "—");
  const tabTitle = maskTitle(a.title || a.tab_name || "—");
  const sinceTs = blockedSinceMap?.get(a.address) ?? tabChangedAt?.get(a.tab) ?? null;
  const sinceLabel = formatSince(sinceTs);
  const canDecide = a.program?.key === "claude";
  const isConfirming = confirming && confirming.address === a.address;
  const isSending = sendingAddress === a.address;

  const sendDecision = (action, cx) => {
    if (isDemo() || isSending) return;
    onSetError?.(null, cx);
    onSetSending(a.address, cx);
    cx.spawn(async (asyncCx) => {
      try {
        if (isDemo()) return;
        const live = (dashboardAgents() ?? []).find((x) => x.address === a.address);
        if (!live || live.status !== "blocked") {
          return;
        }
        const keyName = action === "approve" ? "enter" : "esc";
        const res = await hc(["keys", a.address, keyName]);
        if (res && res.code === 0) {
          recordTodayDecision(action);
        } else {
          const reason = String(res?.stderr || res?.stdout || "").trim().split(/\r?\n/)[0] || `exit code ${res?.code ?? "?"}`;
          onSetError?.(`Could not send approval: ${reason}`, asyncCx);
        }
      } catch (err) {
        const reason = String(err?.message ?? err ?? "command failed").trim().split(/\r?\n/)[0];
        onSetError?.(`Could not send approval: ${reason}`, asyncCx);
      } finally {
        onClearConfirm(asyncCx);
        onSetSending(null, asyncCx);
      }
    });
  };

  const infoBlock = h_flex()
    .when(!compact, (el) => el.flex_1())
    .min_w(0)
    .items_center()
    .gap(compact ? 8 : 10)
    .when(Boolean(pic), (el) => el.child(pic))
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .gap(3)
        .child(
          h_flex()
            .items_center()
            .gap(compact ? 6 : 8)
            .min_w(0)
            .child(
              div()
                .flex_1()
                .min_w(0)
                .text_size(compact ? SIZES.xs : SIZES.sm)
                .font_bold()
                .text_color(PALETTE.text)
                .truncate()
                .child(tabTitle),
            )
            .when(!compact, (el) => el.child(ui.statusWithWord("blocked"))),
        )
        .child(
          div()
            .text_size(SIZES.xs)
            .font_family(monoFont())
            .text_color(PALETTE.mono)
            .truncate()
            .child(
              compact
                ? `${progName} · ${sinceLabel}`
                : `${progName} · ${spaceLabel} · ${sinceLabel} · ${maskAddress(a.address, maskHost)}`,
            ),
        ),
    );

  const actionsBlock = h_flex()
    .flex_none()
    .when(compact, (el) => el.w_full().flex_wrap())
    .items_center()
    .gap(compact ? 6 : 8)
    .child(
      actionButton({
        PALETTE,
        SIZES,
        RADII,
        id: `${idPrefix}-inspect-${a.address}`,
        label: "Inspect",
        primary: !canDecide,
        onClick: () => jump("agent.focus", { terminal: a.address }),
      }),
    )
    .when(canDecide && !isConfirming, (el) =>
      el
        .child(
          actionButton({
            PALETTE,
            SIZES,
            RADII,
            id: `${idPrefix}-approve-${a.address}`,
            label: "Approve",
            primary: true,
            disabled: isSending,
            onClick: (_e, cx) => onSetConfirm({ address: a.address, action: "approve" }, cx),
          }),
        )
        .child(
          actionButton({
            PALETTE,
            SIZES,
            RADII,
            id: `${idPrefix}-reject-${a.address}`,
            label: "Reject",
            danger: true,
            disabled: isSending,
            onClick: (_e, cx) => onSetConfirm({ address: a.address, action: "reject" }, cx),
          }),
        ),
    );

  const confirmText = isConfirming
    ? confirming.action === "approve"
      ? "Send approval (Enter)?"
      : "Send rejection (Esc)?"
    : "";

  return v_flex()
    .id(`${idPrefix}-${a.address}`)
    .w_full()
    .p(compact ? 10 : 12)
    .gap(compact ? 8 : 10)
    .rounded(RADII.inner)
    .bg(PALETTE.warnSoft)
    .border(1)
    .border_color(PALETTE.warnBorder)
    .child(
      compact
        ? v_flex().w_full().gap(8).child(infoBlock).child(actionsBlock)
        : h_flex().w_full().items_center().justify_between().gap(12).child(infoBlock).child(actionsBlock),
    )
    .when(canDecide && isConfirming, (el) =>
      el.child(
        renderInlineConfirm({
          palette,
          idPrefix: `${idPrefix}-confirm-${a.address}`,
          text: confirmText,
          confirmPrimary: confirming.action === "approve",
          confirmDanger: confirming.action === "reject",
          disabled: isSending,
          compact,
          borderColor: PALETTE.warnBorder,
          onConfirm: (_e, cx) => sendDecision(confirming.action, cx),
          onCancel: (_e, cx) => onClearConfirm(cx),
        }),
      ),
    );
}

export function renderApprovals({
  ui,
  palette,
  jump,
  maskHost,
  maskPath,
  agentsList,
  spacesList,
  blockedSinceMap,
  confirming,
  sendingAddress,
  actionError = null,
  onSetConfirm,
  onClearConfirm,
  onSetSending,
  onSetError = null,
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

  const todayStats = readTodayDecisions();
  const hasTodayDecisions = todayStats.approved > 0 || todayStats.rejected > 0;

  const hero = ui.heroCard({
    id: "approvals-hero",
    padding: 20,
    gap: 10,
    children: [
      h_flex()
        .w_full()
        .items_center()
        .justify_between()
        .gap(12)
        .child(
          h_flex()
            .items_center()
            .gap(8)
            .child(
              div()
                .size(8)
                .rounded(8)
                .bg(blocked.length > 0 ? PALETTE.heroWarn : PALETTE.heroGreen),
            )
            .child(
              div()
                .text_size(SIZES.xs)
                .font_bold()
                .text_color(PALETTE.heroMuted)
                .child("APPROVAL QUEUE"),
            ),
        )
        .when(hasTodayDecisions, (el) =>
          el.child(
            div()
              .text_size(SIZES.xs)
              .font_semibold()
              .text_color(PALETTE.heroMuted)
              .child(`Approved today: ${todayStats.approved} · rejected: ${todayStats.rejected}`),
          ),
        ),
      h_flex()
        .items_baseline()
        .gap(10)
        .child(
          div()
            .text_size(SIZES.stat)
            .font_bold()
            .font_family(monoFont())
            .text_color(PALETTE.heroText)
            .child(String(blocked.length)),
        )
        .child(
          div()
            .text_size(SIZES.md)
            .font_semibold()
            .text_color(PALETTE.heroMuted)
            .child(
              blocked.length === 0
                ? "No pending approvals"
                : `${countLabel(blocked.length, "agent")} awaiting a decision`,
            ),
        ),
    ],
  });

  const rows = blocked.map((a) =>
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
      compact: false,
      idPrefix: "approval",
    }),
  );

  const listCard = ui.card({
    id: "approvals-card",
    padding: 20,
    gap: 14,
    children: [
      ui.cardTitleRow({
        icon: "approvals",
        iconBg: blocked.length > 0 ? PALETTE.warnSoft : PALETTE.okSoft,
        iconColor: blocked.length > 0 ? PALETTE.warn : PALETTE.ok,
        iconBorder: blocked.length > 0 ? PALETTE.warnBorder : PALETTE.okBorder,
        title: "Pending Approvals",
        meta: `${blocked.length} pending`,
      }),
      ...(actionError
        ? [
            div()
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
              .child(maskError(actionError)),
          ]
        : []),
      blocked.length === 0
        ? ui.emptyState({
            icon: "approvals",
            title: "No pending approvals",
            description: "Agents awaiting a decision or approval appear here.",
          })
        : v_flex().w_full().gap(10).children(rows),
    ],
  });

  return v_flex().w_full().gap(16).child(hero).child(listCard);
}
