// Runs the bundled Python collector locally and on ready remote Herdr machines.
// Publishes results to shared("herdr-control.collect") so all mod copies stay in sync.

import { exec, machines, shared, setShared, checking } from "herdr";
import { inControlLayout } from "./nav.js";
import { isDemo } from "./demo-mode.js";
import { INVALID_COLLECTOR_RESULT, validateCollectorResult } from "./data.js";
// The bootstrap contains the source of collector/collect.py.
import { COLLECTOR_BOOTSTRAP, COLLECTOR_PYTHON_FLAGS } from "./collector/packed.js";

export const COLLECT_KEY = "herdr-control.collect";
const COLLECT_SCHEMA = 1;
const COLLECT_INTERVAL_MS = 60000;
const COLLECT_TIMEOUT_MS = 50000;

const PYTHON_CANDIDATES = [
  { id: "python3", cmd: "python3", prefix: [] },
  { id: "py-3", cmd: "py", prefix: ["-3"] },
  { id: "python", cmd: "python", prefix: [] },
];

function machineKey(machine) {
  return machine == null || machine === "" || machine === "local" ? "local" : String(machine);
}

function normalizeError(err) {
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  if (
    msg.includes("unreachable") ||
    msg.includes("connect") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("ssh")
  ) {
    return "unreachable";
  }
  return "Python unavailable";
}

function parseCollectorOutput(stdout, remote) {
  if (!stdout || typeof stdout !== "string") return null;
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return validateCollectorResult(JSON.parse(trimmed), { remote });
  } catch {
    return null;
  }
}

function storedMachines() {
  const data = shared(COLLECT_KEY);
  const map = data?.machines;
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  if (data.schema === COLLECT_SCHEMA) return map;

  // Herdr persists shared state across mod upgrades. Sanitize older snapshots
  // before any screen can use them or a refresh republishes them.
  return Object.fromEntries(Object.entries(map).map(([key, entry]) => {
    const result = validateCollectorResult(entry?.result, { remote: key !== "local" });
    const invalid = entry?.result != null && !result;
    return [key, {
      result,
      at: result && Number.isFinite(entry?.at) ? entry.at : null,
      error: invalid ? INVALID_COLLECTOR_RESULT : (entry?.error ? normalizeError(entry.error) : null),
    }];
  }));
}

function writeMachineEntry(key, result, at, error) {
  const prevMachines = storedMachines();
  const prev = Object.hasOwn(prevMachines, key) ? prevMachines[key] : null;
  const nextMachines = {
    ...prevMachines,
    [key]: {
      result: result !== undefined ? result : (prev?.result ?? null),
      at: at !== undefined ? at : (prev?.at ?? null),
      error: error ?? null,
    },
  };
  setShared(COLLECT_KEY, { schema: COLLECT_SCHEMA, machines: nextMachines });
}

export function shouldRunCollector(part) {
  return part === "nav" || (part === null && !inControlLayout());
}

export function startCollector(part, cx) {
  if (checking()) return null;

  const inFlight = new Set();
  const rememberedPython = new Map();

  async function tryPython(candidate, machineName) {
    const opts = machineName
      ? { on: machineName, timeout: COLLECT_TIMEOUT_MS }
      : { timeout: COLLECT_TIMEOUT_MS };
    const argv = [...candidate.prefix, ...COLLECTOR_PYTHON_FLAGS, "-c", COLLECTOR_BOOTSTRAP];
    if (machineName) argv.push("--remote");
    const res = await exec(candidate.cmd, argv, opts);
    if (res && res.code === 0) {
      return { ok: true, result: parseCollectorOutput(res.stdout, Boolean(machineName)) };
    }
    return { ok: false, err: res?.stderr || `exit code ${res?.code ?? "unknown"}` };
  }

  async function collectOne(machineName) {
    if (isDemo()) return;
    const key = machineKey(machineName);
    if (inFlight.has(key)) return;
    inFlight.add(key);

    try {
      const remembered = rememberedPython.get(key);
      const candidates = remembered
        ? [remembered, ...PYTHON_CANDIDATES.filter((c) => c.id !== remembered.id)]
        : PYTHON_CANDIDATES;

      let lastErr = null;
      for (const candidate of candidates) {
        if (isDemo()) return;
        try {
          const attempt = await tryPython(candidate, machineName);
          if (isDemo()) return;
          if (attempt.ok) {
            rememberedPython.set(key, candidate);
            writeMachineEntry(
              key,
              attempt.result,
              attempt.result ? Date.now() : null,
              attempt.result ? null : INVALID_COLLECTOR_RESULT,
            );
            return;
          }
          lastErr = attempt.err;
        } catch (err) {
          lastErr = err;
          if (remembered && candidate.id === remembered.id) {
            rememberedPython.delete(key);
          }
        }
      }

      if (!isDemo()) writeMachineEntry(key, undefined, undefined, normalizeError(lastErr));
    } finally {
      inFlight.delete(key);
    }
  }

  function runAll(taskCx) {
    if (isDemo() || !shouldRunCollector(part)) return;
    taskCx.spawn(async () => {
      if (isDemo()) return;
      const targets = [null];
      try {
        for (const m of machines() ?? []) {
          if (m && m.name != null && m.layout === "ready") {
            targets.push(m.name);
          }
        }
      } catch {}
      await Promise.allSettled(targets.map((name) => collectOne(name)));
    });
  }

  runAll(cx);
  const timer = cx.timer.every(COLLECT_INTERVAL_MS, (tickCx) => runAll(tickCx));
  return { timer, trigger: runAll };
}

export function collectedEntry(machine = null) {
  const map = storedMachines();
  const key = machineKey(machine);
  return Object.hasOwn(map, key) ? map[key] : null;
}

export function collected() {
  return collectedEntry("local")?.result ?? null;
}

export function collectedAgeMin(machine = null) {
  const entry = collectedEntry(machine);
  if (!entry || typeof entry.at !== "number") return null;
  return Math.max(0, Math.floor((Date.now() - entry.at) / 60000));
}

export function collectedFor(machine) {
  return collectedEntry(machine)?.result ?? null;
}

export function allCollected() {
  const map = storedMachines();
  const entries = Object.entries(map).map(([key, val]) => ({
    machine: key === "local" ? null : key,
    result: val?.result ?? null,
    at: val?.at ?? null,
    error: val?.error ?? null,
  }));
  entries.sort((a, b) => {
    if (a.machine === null) return -1;
    if (b.machine === null) return 1;
    return String(a.machine).localeCompare(String(b.machine));
  });
  return entries;
}
