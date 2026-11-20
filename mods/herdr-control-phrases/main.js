import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, TextView, ScrollHandle } from "gpui-base";
import { checking, exec, readTextFile, theme, props, closeOverlay, shared, window } from "herdr";

const SOURCE_ENV = "HERDR_CONTROL_PHRASES_FILE";
const isDemo = () => shared("herdr-control.demo") === true;

async function configuredSource() {
  const windows = window().platform === "windows";
  const result = windows
    ? await exec("powershell.exe", ["-NoProfile", "-Command",
        `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::Write($env:${SOURCE_ENV})`])
    : await exec("printenv", [SOURCE_ENV]);
  if (result.code !== 0) return null;
  return windows ? result.stdout : result.stdout.replace(/\n$/, "");
}

export default class EnglishPhrases extends View {
  init(_props, cx) {
    this.content = null;
    this.error = false;
    this.scroll = ScrollHandle.new();
    if (!checking() && !isDemo()) this.load(cx);
  }

  load(cx) {
    if (isDemo()) return;
    this.error = false;
    cx.spawn(async cx => {
      if (isDemo()) return;
      try {
        const source = await configuredSource();
        if (isDemo()) return;
        const text = source ? await readTextFile(source) : null;
        this.error = text === null;
        this.content = text?.replace(/^\uFEFF/, "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "") ?? null;
        if (!this.error) this.scroll.scroll_to_item(0);
      } catch {
        this.content = null;
        this.error = true;
      }
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const demo = isDemo();
    const content = demo ? shared("herdr-control.demoPhrases") ?? "" : this.content;
    const action = (id, glyph, title, callback) => h_flex().id(id).h(36).px(12).gap(7).items_center().rounded(10)
      .border(1).border_color(t.border).text_color(t.foreground).cursor_pointer()
      .hover(e => e.bg(t.hover)).on_click(callback)
      .child(svg(`mods/workspace-chrome/${glyph}.svg`).size(14)).child(title);
    // The source remains the only copy of the note; no write or model calls.
    const rows = (content ?? "").split(/\r?\n/).filter(line => line.startsWith("|")).slice(2)
      .map(line => line.split("|").slice(1, -1).map(cell => cell.trim()));
    const intro = (content ?? "").split(/\r?\n/).filter(line => !line.startsWith("|")).join("\n").trim();
    return v_flex().w(920).h(660).bg(t.canvas).text_color(t.foreground)
      .child(h_flex().p(22).gap(12).items_center().border_b(1).border_color(t.border)
        .child(div().size(38).rounded(12).bg(t.accent).text_color(t.accent_foreground).flex().items_center().justify_center().child(svg("mods/workspace-chrome/file-text.svg").size(20)))
        .child(v_flex().gap(3).child(div().text_size(21).font_semibold().child("Phrasebook"))
          .child(div().text_size(12).text_color(t.muted).child("Read-only")))
        .child(div().flex_1())
        .when(!demo, (e) => e.child(action("refresh", "clock", "Refresh", (_event, cx) => this.load(cx))))
        .child(action("close", "x", "Close", () => closeOverlay(props().overlay))))
      .child(v_flex().id("phrase-scroll").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).p(24).gap(16)
        .when(!demo && this.error, e => e.child(div().text_color(t.blocked).child(`Set ${SOURCE_ENV} to the path of a readable Markdown file.`)))
        .when(!demo && content === null && !this.error, e => e.child("Loading phrases…"))
        .when(Boolean(content), e => e.child(div().text_size(14).text_color(t.muted).child(TextView.markdown("phrase-intro", intro).selectable(true))))
        .children(rows.map((cells, index) => v_flex().id(`phrase-${index}`).p(20).gap(9).rounded(16).bg(t.surface).border(1).border_color(t.border)
          .child(h_flex().gap(16).items_center()
            .child(div().flex_1().text_size(19).text_color(t.foreground).child(TextView.markdown(`en-${index}`, cells[0] ?? "").selectable(true)))
            .child(div().px(10).py(5).rounded(20).bg(t.raised).text_size(12).text_color(t.muted).child(cells[4] ?? "")))
          .child(div().text_size(14).text_color(t.accent).child(cells[1] ?? ""))
          .child(div().text_size(15).child(TextView.markdown(`example-${index}`, cells[2] ?? "").selectable(true)))
          .child(div().text_size(12).text_color(t.muted).child(`Source: ${cells[3] ?? ""}`)))))
      .child(h_flex().px(24).h(36).gap(12).items_center().border_t(1).border_color(t.border).text_size(12).text_color(t.muted)
        .child(`${rows.length} phrases`).child(div().flex_1()).child(demo ? "Demo data · Esc to close" : "Read from file on open · Esc to close"));
  }
}
