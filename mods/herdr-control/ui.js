// Shared UI building blocks built strictly from palette.js tokens.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  PALETTE,
  SIZES,
  RADII,
  statusColor,
  statusWord,
  textFont,
  monoFont,
} from "./palette.js";

export { textFont, monoFont };

export function dash(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function iconOf(name, size = 16, color = null) {
  const el = svg(`mods/herdr-control/icons/${name}.svg`).size(size).flex_none();
  return color ? el.text_color(color) : el;
}

export function programIcon(program, size = 16, fallbackColor = PALETTE.text) {
  if (!program?.icon) return null;
  return program.tint
    ? svg(program.icon).size(size).flex_none().text_color(fallbackColor)
    : image(program.icon).w(size).h(size).flex_none();
}

export function statusDot(statusOrTheme, maybeStatus, size = 8) {
  let status = statusOrTheme;
  let dotSize = maybeStatus;
  if (typeof statusOrTheme === "object" && statusOrTheme !== null) {
    status = maybeStatus;
    dotSize = size;
  } else if (typeof maybeStatus !== "number") {
    dotSize = 8;
  }

  const color = statusColor(status);
  if (status === "idle") {
    return div()
      .size(dotSize)
      .flex_none()
      .rounded(dotSize)
      .border(1.5)
      .border_color(color);
  }
  const dot = div()
    .size(dotSize)
    .flex_none()
    .rounded(dotSize)
    .bg(color);
  return status === "working"
    ? dot.loop("opacity", { from: 0.35, to: 1, period: 1200 })
    : dot;
}

export function statusWithWord(status, { dotSize = 7, textSize = SIZES.xs, onHero = false } = {}) {
  const word = statusWord(status);
  if (status === "done") {
    const col = onHero ? PALETTE.heroMuted : PALETTE.muted;
    return h_flex()
      .flex_none()
      .items_center()
      .gap(5)
      .text_size(textSize)
      .font_semibold()
      .text_color(col)
      .child("✓")
      .child(word);
  }

  const dotCol =
    onHero && status === "working"
      ? PALETTE.heroGreen
      : onHero && status === "blocked"
        ? PALETTE.heroWarn
        : statusColor(status);
  const textCol = onHero ? PALETTE.heroText : dotCol;

  const dot =
    status === "idle"
      ? div().size(dotSize).flex_none().rounded(dotSize).border(1.5).border_color(dotCol)
      : status === "working"
        ? div()
            .size(dotSize)
            .flex_none()
            .rounded(dotSize)
            .bg(dotCol)
            .loop("opacity", { from: 0.35, to: 1, period: 1200 })
        : div().size(dotSize).flex_none().rounded(dotSize).bg(dotCol);

  return h_flex()
    .flex_none()
    .items_center()
    .gap(6)
    .text_size(textSize)
    .font_semibold()
    .text_color(textCol)
    .child(dot)
    .child(div().whitespace_nowrap().child(word));
}

export function chip({
  label,
  color = null,
  bg = null,
  borderColor = null,
  mono = false,
  dotStatus = null,
  dotColor = null,
  active = false,
  id = null,
  onClick = null,
  h = 24,
  px = 9,
} = {}) {
  const textCol = active ? PALETTE.onAccent : (color ?? PALETTE.muted);
  const bgCol = active ? PALETTE.accent : (bg ?? PALETTE.raised);
  const bCol = active ? PALETTE.accent : (borderColor ?? PALETTE.line);

  const el = h_flex()
    .when(Boolean(id), (e) => e.id(id))
    .flex_none()
    .items_center()
    .gap(6)
    .h(h)
    .px(px)
    .rounded(RADII.chip)
    .bg(bgCol)
    .border(1)
    .border_color(bCol)
    .text_size(SIZES.xs)
    .font_semibold()
    .text_color(textCol)
    .when(mono, (e) => e.font_family(monoFont()))
    .when(Boolean(dotStatus), (e) => e.child(statusDot(dotStatus, 7)))
    .when(!dotStatus && Boolean(dotColor), (e) =>
      e.child(div().size(7).flex_none().rounded(7).bg(dotColor)),
    )
    .child(div().whitespace_nowrap().child(String(label ?? "")));

  if (onClick) {
    return el
      .cursor_pointer()
      .hover((s) => s.bg(active ? PALETTE.accentHover : PALETTE.raisedHover))
      .on_click(onClick);
  }
  return el;
}

export function card({
  children = [],
  padding = 20,
  gap = 12,
  active = false,
  id = null,
  onClick = null,
} = {}) {
  const el = v_flex()
    .when(Boolean(id), (e) => e.id(id))
    .rounded(RADII.card)
    .bg(active ? PALETTE.accentSoft : PALETTE.surface)
    .border(1)
    .border_color(active ? PALETTE.accentBorder : PALETTE.line)
    .p(padding)
    .gap(gap)
    .children(children);

  if (onClick) {
    return el
      .cursor_pointer()
      .hover((s) => s.bg(active ? PALETTE.accentSoft : PALETTE.raised).border_color(PALETTE.lineStrong))
      .on_click(onClick);
  }
  return el;
}

export function heroCard({ children = [], padding = 20, gap = 14, id = null } = {}) {
  return v_flex()
    .when(Boolean(id), (e) => e.id(id))
    .rounded(RADII.card)
    .bg(PALETTE.heroBg)
    .text_color(PALETTE.heroText)
    .border(1)
    .border_color(PALETTE.lineStrong)
    .p(padding)
    .gap(gap)
    .children(children);
}

export function cardTitleRow({
  title,
  meta = null,
  moreLabel = "all →",
  onMore = null,
  moreId = null,
  icon = null,
  iconBg = null,
  iconColor = null,
  iconBorder = null,
} = {}) {
  return h_flex()
    .w_full()
    .items_center()
    .justify_between()
    .gap(10)
    .child(
      h_flex()
        .flex_1()
        .min_w(0)
        .items_center()
        .gap(9)
        .when(Boolean(icon), (e) =>
          e.child(
            h_flex()
              .size(28)
              .flex_none()
              .rounded(RADII.chip)
              .bg(iconBg ?? PALETTE.raised)
              .border(1)
              .border_color(iconBorder ?? PALETTE.lineStrong)
              .items_center()
              .justify_center()
              .child(iconOf(icon, 15, iconColor ?? PALETTE.text)),
          ),
        )
        .child(
          div()
            .min_w(0)
            .truncate()
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
        .gap(8)
        .when(meta !== null && meta !== undefined && meta !== "", (e) =>
          e.child(
            div()
              .text_size(SIZES.xs)
              .font_family(monoFont())
              .text_color(PALETTE.muted)
              .whitespace_nowrap()
              .child(String(meta)),
          ),
        )
        .when(Boolean(onMore), (e) =>
          e.child(
            div()
              .when(Boolean(moreId), (b) => b.id(moreId))
              .px(6)
              .py(3)
              .rounded(RADII.chip)
              .text_size(SIZES.xs)
              .font_semibold()
              .text_color(PALETTE.muted)
              .cursor_pointer()
              .hover((s) => s.text_color(PALETTE.text).bg(PALETTE.raised))
              .on_click(onMore)
              .child(moreLabel),
          ),
        ),
    );
}

export function horizontalBar({
  ratio = 0,
  height = 8,
  color = PALETTE.accent,
  trackColor = PALETTE.track,
  radius = RADII.pill,
} = {}) {
  const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
  const pct = clamped * 100;
  return div()
    .w_full()
    .h(height)
    .rounded(radius)
    .bg(trackColor)
    .overflow_hidden()
    .when(pct > 0, (e) =>
      e.child(
        div()
          .h_full()
          .w(`${pct.toFixed(1)}%`)
          .rounded(radius)
          .bg(color),
      ),
    );
}

export function progressBar({
  label,
  valueLabel = null,
  ratio = 0,
  height = 8,
  color = null,
  warnAt = 0.8,
  dangerAt = 0.95,
} = {}) {
  const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
  const barColor =
    color ??
    (clamped >= dangerAt
      ? PALETTE.danger
      : clamped >= warnAt
        ? PALETTE.warn
        : PALETTE.ok);

  return v_flex()
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
            .min_w(0)
            .truncate()
            .text_size(SIZES.xs)
            .font_semibold()
            .text_color(PALETTE.text)
            .child(dash(label)),
        )
        .when(valueLabel !== null && valueLabel !== undefined, (e) =>
          e.child(
            div()
              .flex_none()
              .text_size(SIZES.xs)
              .font_family(monoFont())
              .text_color(PALETTE.mono)
              .whitespace_nowrap()
              .child(String(valueLabel)),
          ),
        ),
    )
    .child(horizontalBar({ ratio: clamped, height, color: barColor }));
}

export function miniRow({
  id = null,
  onClick = null,
  active = false,
  urgent = false,
  danger = false,
  children = [],
  gap = 10,
  px = 10,
  py = 7,
} = {}) {
  const bg = danger
    ? PALETTE.dangerSoft
    : urgent
      ? PALETTE.warnSoft
      : active
        ? PALETTE.accentSoft
        : PALETTE.rowBg;
  const border = danger
    ? PALETTE.dangerBorder
    : urgent
      ? PALETTE.warnBorder
      : active
        ? PALETTE.accentBorder
        : PALETTE.line;

  const el = h_flex()
    .when(Boolean(id), (e) => e.id(id))
    .w_full()
    .items_center()
    .gap(gap)
    .px(px)
    .py(py)
    .rounded(RADII.inner)
    .bg(bg)
    .border(1)
    .border_color(border)
    .children(children);

  if (onClick) {
    return el
      .cursor_pointer()
      .hover((s) => s.bg(urgent ? PALETTE.warnHover : PALETTE.rowHover).border_color(PALETTE.lineStrong))
      .on_click(onClick);
  }
  return el;
}

export function emptyState({ icon = "overview", title, description } = {}) {
  return v_flex()
    .w_full()
    .items_center()
    .justify_center()
    .gap(8)
    .px(24)
    .py(28)
    .rounded(RADII.card)
    .bg(PALETTE.surface)
    .border(1)
    .border_color(PALETTE.line)
    .child(
      h_flex()
        .size(40)
        .rounded(RADII.inner)
        .bg(PALETTE.raised)
        .border(1)
        .border_color(PALETTE.lineStrong)
        .items_center()
        .justify_center()
        .child(iconOf(icon, 20, PALETTE.muted)),
    )
    .when(Boolean(title), (e) =>
      e.child(
        div()
          .text_size(SIZES.md)
          .font_bold()
          .text_color(PALETTE.text)
          .text_center()
          .child(title),
      ),
    )
    .when(Boolean(description), (e) =>
      e.child(
        div()
          .max_w(460)
          .text_size(SIZES.xs)
          .text_color(PALETTE.muted)
          .text_center()
          .child(description),
      ),
    );
}

// Legacy helpers kept for existing screens until they are rewritten.
export function screenHeader({ eyebrow, title, description, right = null }) {
  return h_flex()
    .w_full()
    .items_start()
    .justify_between()
    .gap(16)
    .pb(14)
    .border_b(1)
    .border_color(PALETTE.line)
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .gap(4)
        .child(
          div()
            .text_size(SIZES.xs)
            .font_semibold()
            .font_family(monoFont())
            .text_color(PALETTE.muted)
            .child(eyebrow),
        )
        .child(
          div()
            .text_size(SIZES.lg)
            .font_bold()
            .text_color(PALETTE.text)
            .child(title),
        )
        .child(
          div()
            .text_size(SIZES.sm)
            .text_color(PALETTE.muted)
            .child(description),
        ),
    )
    .when(Boolean(right), (e) => e.child(right));
}

export function sectionHeader({ title, count = null, right = null }) {
  return h_flex()
    .w_full()
    .items_center()
    .justify_between()
    .gap(10)
    .child(
      h_flex()
        .items_center()
        .gap(8)
        .min_w(0)
        .child(
          div()
            .text_size(SIZES.sm)
            .font_bold()
            .text_color(PALETTE.text)
            .truncate()
            .child(title),
        )
        .when(count !== null && count !== undefined, (e) =>
          e.child(
            div()
              .px(7)
              .py(2)
              .rounded(RADII.chip)
              .bg(PALETTE.raised)
              .border(1)
              .border_color(PALETTE.line)
              .text_size(SIZES.xs)
              .font_family(monoFont())
              .text_color(PALETTE.mono)
              .child(String(count)),
          ),
        ),
    )
    .when(Boolean(right), (e) => e.child(right));
}

export function row({ id, onClick = null, active = false, children = [], gap = 12, px = 14, py = 10 }) {
  return miniRow({ id, onClick, active, children, gap, px, py });
}
