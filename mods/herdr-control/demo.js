// Synthetic dashboard data with timestamps relative to the current time.

export const DEMO_KEY = "herdr-control.demo";
export const DEMO_TABS_KEY = "herdr-control.demoTabs";
export const TOGGLE_DEMO_COMMAND = "toggle-demo";
export const DEMO_DECISIONS = { approved: 3, rejected: 1 };

const MIN = 60000;
const GB = 10 ** 9;

const programs = {
  claude: "Claude Code", codex: "Codex", agy: "Antigravity", opencode: "OpenCode",
};
const projects = [
  {
    name: "api", machine: "build-server", branch: "feature/api-cache",
    tabs: [
      ["claude", "Trace API cache misses", "working", 42],
      ["codex", "Approve database migration", "blocked", 12],
    ],
  },
  {
    name: "web-app", machine: "workstation", branch: "feature/navigation",
    tabs: [
      ["claude", "Review production build", "blocked", 6],
      ["agy", "Finish navigation updates", "done", 23],
    ],
  },
  {
    name: "docs", machine: null, branch: "main",
    tabs: [["opencode", "Update the release guide", "idle", 71]],
  },
];

const hosts = [
  { name: "control-desk", ip: "100.64.10.10", os: "Windows", cpu: 18, cores: 12, ram: 32, disk: 512 },
  { name: "workstation", ip: "100.64.10.11", os: "Linux", cpu: 29, cores: 16, ram: 64, disk: 1024, ping: 14 },
  { name: "build-server", ip: "100.64.10.12", os: "Linux", cpu: 46, cores: 24, ram: 64, disk: 2048, ping: 27 },
  { name: "laptop", ip: "100.64.10.13", os: "macOS", cpu: 12, cores: 8, ram: 24, disk: 512, ping: 38 },
  { name: "staging", ip: "100.64.10.14", os: "Linux", ping: null },
];

const port = (number, process, project, addr = "127.0.0.1", access = "local") => ({
  port: number, addr, process, access, ...(project ? { cwd: "/demo/projects/" + project } : {}),
});
const routes = [
  { port: 443, proto: "https", target: "http://127.0.0.1:8080", funnel: true },
  { port: 8443, proto: "https", target: "http://127.0.0.1:4173", funnel: true },
];
const hostPorts = [
  [port(8080, "docs-preview", "docs", "127.0.0.1", "public"), port(4173, "release-preview", "docs", "127.0.0.1", "public"), port(4321, "docs-dev", "docs"), port(8000, "metrics", null, hosts[0].ip, "tailnet")],
  [port(5173, "vite", "web-app"), port(9229, "node", "web-app"), port(3000, "web", "web-app", hosts[1].ip, "tailnet")],
  [port(8001, "api", "api", hosts[2].ip, "tailnet"), port(5432, "postgres", "api"), port(6379, "redis", "api"), port(9090, "prometheus", null, hosts[2].ip, "tailnet"), port(22, "sshd", null, hosts[2].ip, "tailnet")],
  [port(3001, "preview", null), port(8888, "jupyter", null, hosts[3].ip, "tailnet")],
];
const docker = ["api", "postgres", "web", "worker"].map((name, index) => ({
  id: "demo-" + name, name,
  image: ["example/api:1.4", "postgres:16", "example/web:1.4", "example/worker:1.4"][index],
  state: "running", status: "Up " + (index + 2) + " days",
  publishedPorts: index < 3 ? [
    { hostAddr: index === 0 ? hosts[2].ip : "127.0.0.1", hostPort: ["8001", "5432", "8081"][index], containerPort: ["8001/tcp", "5432/tcp", "80/tcp"][index] },
  ] : [],
  cpuPerc: [14.3, 2.7, 5.2, 8.4][index] + "%",
  memUsage: [426, 654, 172, 308][index] + "MiB / 2GiB",
  memPerc: [21, 32, 8, 15][index] + "%",
  hasNetIo: true, netRx: (125 + index * 68) + "MB", netTx: (60 + index * 23) + "MB",
}));
const providers = [
  ["claude", "claude-sonnet-4-6", "api", 15300],
  ["codex", "gpt-5.4", "api", 20400],
  ["antigravity", "gemini-3-pro-preview", "web-app", 12200],
  ["opencode", "deepseek-v4.1-flash", "docs", 8900],
];

const installed = { claude: true, codex: true, agy: true, opencode: true, pi: false, gemini: false };

function createDemoData(now) {
  const time = (minutesAgo = 0) => now.getTime() - minutesAgo * MIN;
  const isoTime = (minutesAgo = 0) => new Date(time(minutesAgo)).toISOString();
  const day = (daysAgo) => {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0")
      + "-" + String(date.getDate()).padStart(2, "0");
  };

  const agentsList = [];
  const panesList = [];
  const terminalsList = [];
  const spacesList = projects.map(({ name, machine, branch, tabs }, index) => {
    const prefix = machine ? machine + "/" : "";
    const id = prefix + "demo-" + name;
    const folder = "/demo/projects/" + name;
    const active = index === 0;

    const tabList = tabs.map(([key, title, status, minutes], i) => {
      const tab = id + "-tab-" + (i + 1);
      const pane = tab + "-pane";
      const address = prefix + "demo-terminal-" + (index + 1) + "-" + (i + 1);
      const program = { key, name: programs[key], icon: null, agent: true };
      const focused = active && i === 0;
      agentsList.push({
        address, pane, tab, space: id, space_name: name, tab_index: i + 1,
        tab_name: title, title, app: key, program, status, seq: time(minutes), focused,
      });
      panesList.push({ pane, tab, terminal: address, title, cwd: folder, branch, app: key, program, status, focused });
      terminalsList.push({ address, name: title, title, cwd: folder, program, state: "live" });
      return {
        id: tab, name: title, named: true, index: i + 1, status, active: i === 0,
        panes: 1, changed_at: time(minutes), working_since: status === "working" ? time(minutes) : null,
      };
    });

    return { id, name, machine, folder, branch, active, index: index + 1, status: tabList.find((tab) => tab.status === "blocked")?.status ?? "idle", tabs: tabList };
  });

  const usage = {
    days: Array.from({ length: 30 }, (_, i) => providers.map(([provider, model, project, base], j) => {
      const scale = (i * 3 + j * 5) % 9 + 1;
      return {
        date: day(i), provider, model, project, input: base * scale, output: base * scale / 5,
        cache_read: base * (scale + 2), sessions: 1 + scale % 3,
        active_s: provider === "antigravity" ? 0 : 650 * scale, estimated: provider === "antigravity",
      };
    })).flat(),
    sessions: providers.filter(([provider]) => provider !== "antigravity").map(([provider, , project], i) => ({
      provider, project, start: time(130 - 22 * i), end: time(108 - 22 * i),
    })),
  };
  const windowLimit = (remaining, minutesUntilReset) => ({
    remaining, resets_at: time(-minutesUntilReset) / 1000,
  });
  const quota = (five, week, offset) => ({
    five: windowLimit(five, offset), week: windowLimit(week, 4150), read_at: time(2) / 1000,
  });
  const limits = {
    claude: quota(23, 61, 75),
    codex: quota(74, 52, 150),
    antigravity: quota(89, 72, 210),
    opencode: { reached: { window: "weekly", resets_at: time(-2 * 24 * 60) / 1000 }, source: "log" },
  };

  const tailscale = {
    tailnet: "example-tailnet.ts.net",
    self: { name: hosts[0].name, ip: hosts[0].ip, os: hosts[0].os },
    peers: hosts.slice(1).map(({ name, ip, os, ping }) => ({
      name, ip, os, online: ping !== null, ...(ping === null ? { last_seen: isoTime(3060) } : { ping_ms: ping }),
    })),
    funnel_ports: routes.map(({ port }) => port),
    serve: routes,
  };
  const collectEntries = hosts.map(({ name, os, cpu, cores, ram, disk }, i) => {
    const machine = i === 0 ? null : name;
    if (cpu === undefined) return { machine, at: null, error: "unreachable", result: null };
    const result = {
      version: 1, generated_at: isoTime(1),
      system: {
        hostname: name, username: "demo", os, cpu_pct: cpu, cpu_cores: cores,
        ram_used_b: ram * 0.57 * GB, ram_total_b: ram * GB, disk_used_b: disk * 0.43 * GB,
        disk_total_b: disk * GB, uptime_s: (i + 4) * 86429,
      },
      ports: hostPorts[i], errors: [], notes: [],
    };
    if (i === 0) Object.assign(result, { tailscale, usage, limits, installed });
    if (name === "build-server") Object.assign(result, {
      docker,
      network: {
        source: "vnstat", ifaces: ["eth0"], since: isoTime(40000), resets: 0,
        days: Array.from({ length: 18 }, (_, j) => ({
          date: day(j), rx_b: (58 + (j * 17) % 90) * GB, tx_b: (25 + (j * 11) % 37) * GB,
        })),
      },
    });
    return { machine, result, at: time(1), error: null };
  });

  return {
    demo: true,
    machinesList: hosts.map(({ name, cpu }, i) => ({ name: i === 0 ? null : name, layout: cpu === undefined ? "unavailable" : "ready" })),
    spacesList, agentsList, terminalsList, panesList,
    collectEntries, localEntry: collectEntries[0],
    focusedInfo: { space: spacesList[0].id, terminal: terminalsList[0].address },
    limits: { "build-server": { monthly_tb: 4.5, count: "total", billing_day: 1 } },
    commits: new Map(spacesList.map((space) => [space.id + "|" + (space.machine ?? "local") + "|" + space.folder, {
      commits: [
        { hash: "78f4c21", subject: "Update " + space.name + " preview", relTime: "2 hours ago" },
        { hash: "31ac815", subject: "Add regression coverage", relTime: "5 hours ago" },
        { hash: "16f68ea", subject: "Document setup steps", relTime: "yesterday" },
      ],
    }])),
    pingHistory: new Map(hosts.filter(({ ping }) => ping).map(({ name, ping }) => [
      name, Array.from({ length: 20 }, (_, i) => ({ ts: time(39 - i * 2), ms: ping + (i * 7) % 14 - 5 })),
    ])),
    blockedSince: new Map(agentsList.filter(({ status }) => status === "blocked").map(({ address, seq }) => [address, seq])),
    catalog: [{
      group: "demo", title: "Coding Agents", subtitle: "Example installations",
      agents: providers.map(([provider, model]) => {
        const key = provider === "antigravity" ? "agy" : provider;
        return { id: key, name: programs[key], provider, installedKey: key, model, appKeys: [key], roles: [], rights: {} };
      }),
    }],
    phrases: "Example phrases for reviewing code.\n\n| English | Meaning | Example | Source | Level |\n| --- | --- | --- | --- | --- |\n| Follow up | Check progress later | I will follow up after the review. | Demo | B1 |",
  };
}

let snapshotMinute;
let snapshot;

export function getDemoData(now = new Date()) {
  // Reuse one snapshot across views within the same minute.
  const minute = Math.floor(now.getTime() / MIN);
  if (minute !== snapshotMinute) {
    snapshot = createDemoData(new Date(minute * MIN));
    snapshotMinute = minute;
  }
  return snapshot;
}
