// Streaming mode masking helpers.
// All helpers are no-ops when shared("herdr-control.stream") is falsy.

import { shared } from "herdr";
import { readMachineSources } from "./source.js";

export const STREAM_KEY = "herdr-control.stream";

export function isStreaming() {
  return Boolean(shared(STREAM_KEY));
}

function buildHostIndex() {
  const map = new Map();
  let nextIdx = 1;

  const assignGroup = (names) => {
    let existing = null;
    for (const n of names) {
      if (!n || typeof n !== "string") continue;
      const key = n.trim().toLowerCase();
      if (key && map.has(key)) {
        existing = map.get(key);
        break;
      }
    }
    const label = existing ?? `machine-${nextIdx++}`;
    for (const n of names) {
      if (!n || typeof n !== "string") continue;
      const key = n.trim().toLowerCase();
      if (key) map.set(key, label);
    }
  };

  const { localEntry, machinesList, collectEntries } = readMachineSources();
  const localCol = localEntry?.result;
  const localAliases = [
    "local",
    "This computer",
    localCol?.system?.hostname,
    localCol?.tailscale?.self?.name,
  ];
  assignGroup(localAliases);

  for (const m of machinesList ?? []) {
    if (m && m.name != null && m.name !== "") {
      assignGroup([m.name]);
    }
  }

  for (const peer of localCol?.tailscale?.peers ?? []) {
    if (peer?.name) assignGroup([peer.name]);
  }

  for (const entry of collectEntries) {
    const names = [entry.machine, entry.result?.system?.hostname, entry.result?.tailscale?.self?.name];
    if (names.some(Boolean)) assignGroup(names);
  }

  return map;
}

export function maskHost(name) {
  if (!isStreaming()) return name;
  if (!name || name === "—") return name;
  const map = buildHostIndex();
  const key = String(name).trim().toLowerCase();
  return map.get(key) ?? "machine-?";
}

export function maskIp(ip) {
  if (!isStreaming()) return ip;
  if (!ip || ip === "—") return ip;
  return "•••";
}

export function maskPath(path) {
  return maskText(path);
}

export function maskText(value, label = "hidden", streaming = isStreaming()) {
  return streaming && value && value !== "—" ? label : value;
}

export function maskTitle(value) {
  return maskText(value, "terminal");
}

export function maskBranch(value) {
  return maskText(value, "branch");
}

export function maskError(value) {
  return maskText(value, "Command failed");
}

export function maskProgram(value) {
  const publicNames = /^(?:Claude(?: Code)?|Codex|OpenCode|Antigravity|Gemini(?: CLI)?|Pi|Agent|Terminal)(?: #\d+)?$/i;
  return publicNames.test(value) ? value : maskText(value, "agent");
}

function isPortRange(value) {
  return typeof value === "string" && /^\d{1,5}(?:-\d{1,5})?$/.test(value)
    && value.split("-").every((port) => Number(port) > 0 && Number(port) <= 65535);
}

export function formatDockerPortsDisplay(container, streaming = isStreaming()) {
  const ports = container.publishedPorts ?? [];
  const shown = ports.filter((port) => {
    if (!streaming) return true;
    const match = /^(\d{1,5}(?:-\d{1,5})?)\/(?:tcp|udp|sctp)$/.exec(port.containerPort);
    return match && isPortRange(match[1]) && isPortRange(port.hostPort);
  });
  if (shown.length) {
    return shown.map((port) => {
      const host = port.hostAddr ? `${streaming ? "•••" : port.hostAddr}:` : "";
      return `${host}${port.hostPort}→${port.containerPort}`;
    }).join(", ");
  }
  return maskText(container.portsRaw || (ports.length ? "hidden" : "—"), "hidden", streaming);
}

export function maskUser(userLine) {
  if (!isStreaming()) return userLine;
  if (!userLine || userLine === "—") return userLine;
  const s = String(userLine);
  const at = s.indexOf("@");
  if (at === -1) return "•••";
  return `•••@${maskHost(s.slice(at + 1))}`;
}

export function maskTailnet(name) {
  if (!isStreaming()) return name;
  if (!name || name === "—") return name;
  return "••••.ts.net";
}

export function maskAvatar(label) {
  if (!isStreaming()) return label;
  return "•••";
}

export function maskContainer(name, index = null) {
  if (!isStreaming()) return name;
  if (!name || name === "—") return name;
  return index !== null && index !== undefined ? `container-${index + 1}` : "container-?";
}
