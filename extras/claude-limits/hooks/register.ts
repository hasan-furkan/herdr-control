import type { Register, SessionRateLimit } from "claude-code";

type Window = { remaining: number; resets_at?: number };

function fromClaude(limits: SessionRateLimit[]) {
  const out: { five?: Window; week?: Window } = {};
  for (const limit of limits) {
    const key = limit.kind === "five_hour" ? "five" : limit.kind === "seven_day" ? "week" : null;
    if (!key || !Number.isFinite(limit.percentUsed)) continue;
    const reset = limit.resetsAt ? Date.parse(limit.resetsAt) / 1000 : NaN;
    out[key] = {
      remaining: Math.max(0, Math.min(100, 100 - limit.percentUsed)),
      ...(Number.isFinite(reset) ? { resets_at: reset } : {}),
    };
  }
  return Object.keys(out).length ? out : null;
}

async function resolveHome($: { env: { get(name: string): Promise<string | undefined> } }) {
  return (await $.env.get("HOME")) ?? (await $.env.get("USERPROFILE"));
}

export const register: Register = (on) => {
  on("session.start", async ($, event, next) => {
    const result = await next(event);
    const tick = async () => {
      try {
        const home = await resolveHome($);
        const limits = fromClaude((await $.session.usage()).rateLimits);
        if (home && limits) {
          const at = await $.clock.now() / 1000;
          await $.fs.write(`${home}/.claude/limits-claude.json`, JSON.stringify({ at, claude: limits }));
        }
      } catch {
        // Best effort: Claude sessions continue even when sharing is unavailable.
      }
    };
    await tick();
    $.clock.every(60_000, tick);
    return result;
  });

  on("session.measure", async ($, event, next) => {
    const result = await next(event);
    try {
      const home = await resolveHome($);
      const limits = fromClaude(event.rateLimits ?? (await $.session.usage()).rateLimits);
      if (home && limits) {
        const at = await $.clock.now() / 1000;
        await $.fs.write(`${home}/.claude/limits-claude.json`, JSON.stringify({ at, claude: limits }));
      }
    } catch {
      // Best effort: sharing never interrupts a session.
    }
    return result;
  });
};
