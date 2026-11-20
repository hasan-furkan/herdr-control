// The dashboard reads either one synthetic snapshot or Herdr's live data.

import * as herdr from "herdr";
import { allCollected } from "./collector.js";
import { TRAFFIC_LIMITS } from "./limits.js";
import { getDemoData } from "./demo.js";
import { isDemo } from "./demo-mode.js";

export function readDashboard() {
  if (isDemo()) return getDemoData();
  return {
    ...readMachineSources(),
    spacesList: herdr.spaces(),
    agentsList: herdr.agents(),
    terminalsList: herdr.terminals(),
    panesList: herdr.panes(),
    focusedInfo: herdr.focused(),
    limits: TRAFFIC_LIMITS,
  };
}

export function readMachineSources() {
  if (isDemo()) return getDemoData();
  const collectEntries = allCollected();
  return {
    machinesList: herdr.machines(),
    collectEntries,
    localEntry: collectEntries.find(({ machine }) => machine === null) ?? null,
  };
}

export const dashboardSpaces = () => isDemo() ? getDemoData().spacesList : herdr.spaces();
export const dashboardFocus = () => isDemo() ? getDemoData().focusedInfo : herdr.focused();
export const dashboardAgents = () => isDemo() ? getDemoData().agentsList : herdr.agents();
export const dashboardCommands = () => isDemo() ? [] : herdr.commands();
export function setDashboardAgentOrder(addresses) {
  if (!isDemo()) herdr.setAgentOrder(addresses);
}
