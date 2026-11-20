// Screen 3: Terminals.

import { maskPath, maskProgram } from "../mask.js";
import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { jump } from "../nav.js";

function terminalRow({ t, data, ui, term, narrow }) {
  const pic = ui.programIcon(term.program, 16, t.foreground);
  const progName = data.terminalProgramName(term);
  const hasStatus = Boolean(term.status);
  const sColor = hasStatus ? data.statusColor(t, term.status) : t.dim;

  return ui.row({
    t,
    id: `term-${term.address}`,
    onClick: () => jump("terminal.show", { terminal: term.address }),
    children: [
      ui.chip({
        t,
        label: maskPath(term.address),
        mono: true,
        color: t.foreground,
      }),
      ...(pic ? [pic] : []),
      div()
        .w(narrow ? 110 : 150)
        .flex_none()
        .text_size(13)
        .font_semibold()
        .text_color(t.foreground)
        .truncate()
        .child(maskProgram(progName)),
      ui.chip({
        t,
        label: data.terminalStateLabel(term.state),
        dotColor: t.ansi2,
        color: t.muted,
      }),
      ...(hasStatus
        ? [
            ui.chip({
              t,
              label: data.statusLabel(term.status),
              dotStatus: term.status,
              color: sColor,
              borderColor: sColor,
            }),
          ]
        : []),
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .text_size(12)
        .font_family(ui.monoFont())
        .text_color(t.muted)
        .child(maskPath(term.cwd || "—")),
    ],
  });
}

export function renderTerminals({ t, data, ui, terminalsList, narrow }) {
  const list = data.liveTerminals(terminalsList);

  return v_flex()
    .w_full()
    .gap(18)
    .child(
      ui.screenHeader({
        t,
        eyebrow: "TERMINALS",
        title: "Terminals",
        description: "Live Herdr terminals with their programs and folders.",
      }),
    )
    .child(
      v_flex()
        .w_full()
        .gap(10)
        .child(ui.sectionHeader({ t, title: "Live terminals", count: list.length }))
        .child(
          list.length === 0
            ? ui.emptyState({
                t,
                icon: "terminals",
                title: "No live terminals",
                description: "Terminals you open in any space appear here.",
              })
            : v_flex()
                .w_full()
                .gap(8)
                .children(list.map((term) => terminalRow({ t, data, ui, term, narrow }))),
        ),
    );
}
