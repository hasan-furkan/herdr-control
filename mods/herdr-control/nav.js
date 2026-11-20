// Shared navigation between the nav part and the content part (herdr-control layout).

import { run, shared, setShared, layout } from "herdr";
import { isDemo } from "./demo-mode.js";

export const STACK = "work-stack";
export const SCREEN_KEY = "herdr-control.screen";
export const VIEW_KEY = "herdr-control.view";
export const RANGE_KEY = "herdr-control.range";
export const AGENTS_TAB_KEY = "herdr-control.agentsTab";
export const MACHINE_KEY = "herdr-control.machine";

/** True when the herdr-control layout (nav sidebar + work stack) is shown. */
export function inControlLayout() {
  if (shared("layout") === "herdr-control") return true;
  const root = layout();
  const sidebar = findNode(root, "sidebar")?.content;
  const screen = findNode(findNode(root, STACK), "screen")?.content;
  return sidebar?.mod === "herdr-control" && sidebar?.props?.part === "nav"
    && screen?.mod === "herdr-control" && screen?.props?.part === "content";
}

export function showView(view) {
  if (isDemo() && view === "terminal") return;
  setShared(VIEW_KEY, view);
  if (inControlLayout()) run("layout.select", { stack: STACK, child: view });
}

/** Run a jump command (focus an agent, show a terminal, select a space) and,
 *  in the herdr-control layout, bring the terminal view to the front so the jump is seen. */
export function jump(command, args) {
  if (isDemo()) return;
  run(command, args);
  if (inControlLayout()) showView("terminal");
}

function findNode(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  const kids = Array.isArray(node.children) ? node.children : [];
  for (const k of kids) {
    const hit = findNode(k, id);
    if (hit) return hit;
  }
  return null;
}

/** The child the work stack shows now ("terminal" or "screen"), read from the live layout. */
export function currentView() {
  const view = shared(VIEW_KEY);
  if (view === "terminal" || view === "screen") return view;
  return startView();
}

/** The stack child the herdr-control layout file starts on. */
export function startView() {
  const active = inControlLayout() ? findNode(layout(), STACK)?.active : null;
  return active === "terminal" ? "terminal" : "screen";
}
