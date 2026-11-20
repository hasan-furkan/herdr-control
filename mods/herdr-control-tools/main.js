import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, closeOverlay, shared } from "herdr";

export default class WorkspaceTools extends View {
  render() {
    const t = theme();
    const close = () => closeOverlay(props().overlay);
    const row = (id, glyph, label, action) => h_flex().id(id).h(40).px(12).gap(11).items_center()
      .text_color(t.foreground).cursor_pointer().hover(e => e.bg(t.hover))
      .on_click(() => { close(); action(); }).child(svg(`mods/workspace-chrome/${glyph}.svg`).size(16)).child(label);
    return v_flex().w(360).h(320).p(16).gap(5).bg(t.popover).text_size(13).text_color(t.foreground)
      .child(h_flex().h(34).px(12).items_center().child(div().flex_1().text_size(12).text_color(t.dim).child("PERSONAL TOOLS"))
        .child(div().id("close-tools").p(4).cursor_pointer().on_click(close).child(svg("mods/workspace-chrome/x.svg").size(14))))
      .child(row("english-phrases", "file-text", "Phrasebook", () => run("mod.open", { name: "herdr-control-phrases" })))
      .child(row("toggle-demo", "monitor", "Herdr Control: Toggle demo data", () => run("herdr-control.toggle-demo")))
      .child(div().my(8).h(1).bg(t.border))
      .when(shared("herdr-control.demo") !== true, (el) => el
        .child(row("command-palette", "search", "Command palette", () => run("app.palette")))
        .child(row("workspace-settings", "settings", "Appearance and settings", () => run("app.settings")))
        .child(row("machine-settings", "monitor", "Machines", () => run("app.settings", { section: "machines" }))));
  }
}
