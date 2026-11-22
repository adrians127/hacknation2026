// Imports the lab subnet as a target and starts a scan of it, as the admin would in the UI
// (Targets -> Import -> "Start a scan right away"). Waits for worker-manager to register masscan
// first: the import queues the default steps (masscan -> nmap) only for registered workers.
const { BACKEND_URL, ADMIN_EMAIL, ADMIN_PASSWORD, LAB_TARGET } = process.env;
const WAIT_SECONDS = 600;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(path, { cookie, body, method = body ? "POST" : "GET" } = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: {
      ...(body && { "content-type": "application/json" }),
      ...(cookie && { cookie }),
    },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res;
}

async function login() {
  const res = await call("/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  const cookie = res.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .find((pair) => pair.startsWith("subsurf_access="));
  if (!cookie) throw new Error("Login returned no subsurf_access cookie");
  return cookie;
}

// The access token lasts 15 minutes, longer than the whole wait.
async function waitForWorkers(cookie) {
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  while (Date.now() < deadline) {
    const { items } = await (await call("/workers", { cookie })).json();
    const online = (name) => items.some((w) => w.name === name && w.onlineManagers > 0);
    if (online("masscan")) {
      if (!online("nmap")) console.warn("nmap is not registered: the scan runs masscan only");
      return;
    }
    console.log("Waiting for worker-manager to register its workers…");
    await sleep(5000);
  }
  throw new Error(`No worker-manager registered masscan within ${WAIT_SECONDS} s`);
}

const cookie = await login();
await waitForWorkers(cookie);
const res = await call("/targets/import", {
  cookie,
  body: {
    entries: [{ value: LAB_TARGET, note: "Docker lab (docker/lab/docker-compose-all.yml)" }],
    startScan: true,
    tags: ["lab"],
  },
});
const { scan, warnings } = await res.json();
for (const warning of warnings ?? []) console.warn("Import warning:", JSON.stringify(warning));
if (!scan) throw new Error("The import queued no scan (see the warnings above)");
console.log(
  `Scan ${scan.id} queued: ${scan.addressCount} addresses, ports ${scan.ports}, ` +
    `${scan.maxRate} pps, ${scan.jobCount} job(s). Follow it at http://localhost:3000.`,
);
