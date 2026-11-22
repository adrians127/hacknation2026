import type { ScanJobHost } from "@subsurf/contracts/scans/scans.schema";
import { intToIpv4, ipv4ToInt } from "@subsurf/contracts/targets/ipv4";

import type { DemoChange } from "~backend/demo/ports";
import type { ProfileKey } from "~backend/demo/profiles";
import { createRandom } from "~backend/demo/random";

export const DEMO_NETWORK = "10.40.0.0/18";
export const DEMO_DOMAIN = "campus.example";
/** The default `SCAN_DEFAULT_PORTS`, pinned so the demo does not depend on the local `.env`. */
export const DEMO_SCAN_PORTS =
  "21,22,23,25,53,80,110,111,135,139,143,443,445,993,995,1433,1521,2049,3306,3389,5432,5900,6379,8000,8080,8443,9200,27017";

export type DemoHostState = "up" | "down" | "timeout";

/** Four runs: nights of 20 and 21 November, the afternoon of the 21st, and the night of the 22nd. */
export type DemoRunNumber = 1 | 2 | 3 | 4;

export interface DemoHost {
  ip: string;
  profile: ProfileKey;
  variant: number;
  label: string;
  /** Domains given as targets that resolve to this IP: one HTTP endpoint (`vhost`) each. */
  domains: string[];
  ptr: string | null;
  states: Record<DemoRunNumber, DemoHostState>;
  /** How the host differs from the first run, from run `changesFrom` on. */
  changes: DemoChange[];
  changesFrom: DemoRunNumber;
}

interface HostOptions {
  domains?: string[];
  ptr?: string;
  label?: string;
  variant?: number;
  /** The first two runs default to `up`; later ones to the run before, a timeout to `up`. */
  run1?: DemoHostState;
  run2?: DemoHostState;
  run3?: DemoHostState;
  run4?: DemoHostState;
  changes?: DemoChange[];
  changesFrom?: DemoRunNumber;
}

const RUN_OPTIONS = ["run1", "run2", "run3", "run4"] as const;

function states(options: HostOptions): Record<DemoRunNumber, DemoHostState> {
  const list: DemoHostState[] = [];
  for (const [index, key] of RUN_OPTIONS.entries()) {
    const previous = list.at(-1);
    const fallback = index < 2 || previous === undefined || previous === "timeout" ? "up" : previous;
    list.push(options[key] ?? fallback);
  }
  const [run1 = "up", run2 = "up", run3 = "up", run4 = "up"] = list;
  return { 1: run1, 2: run2, 3: run3, 4: run4 };
}

const d = (name: string) => `${name}.${DEMO_DOMAIN}`;

function host(ip: string, profile: ProfileKey, options: HostOptions = {}): DemoHost {
  const domains = options.domains ?? [];
  return {
    ip,
    profile,
    variant: options.variant ?? 0,
    label: options.label ?? domains[0] ?? options.ptr ?? ip,
    domains,
    ptr: options.ptr ?? null,
    states: states(options),
    changes: options.changes ?? [],
    changesFrom: options.changesFrom ?? 2,
  };
}

/** Named servers: the hosts the demo story is about. */
const NAMED_HOSTS: DemoHost[] = [
  // Core network
  host("10.40.0.1", "router", { ptr: d("gw"), changes: ["close-port"] }),
  host("10.40.0.2", "networkSwitch", { ptr: d("core-sw1") }),
  host("10.40.0.3", "networkSwitch", { ptr: d("core-sw2") }),
  host("10.40.0.10", "dns", { ptr: d("ns1"), changes: ["upgrade"] }),
  host("10.40.0.11", "dns", { ptr: d("ns2"), variant: 2 }),
  host("10.40.0.25", "mail", { domains: [d("mail"), d("poczta")], ptr: d("mx1") }),
  host("10.40.0.30", "ups", { ptr: d("ups-srv1") }),
  host("10.40.0.40", "bmc", { domains: [d("idrac-vh01")] }),
  host("10.40.0.41", "bmc", { domains: [d("idrac-vh02")] }),

  // Public web
  host("10.40.1.10", "wordpress", {
    domains: [d("www"), DEMO_DOMAIN],
    label: "Uniwersytet Kampus",
    ptr: d("web01"),
    changes: ["upgrade", "renew-cert"],
  }),
  host("10.40.1.11", "wordpress", {
    domains: [d("aktualnosci")],
    label: "Aktualności Kampus",
    variant: 1,
    ptr: d("web02"),
    changes: ["open-port"],
  }),
  host("10.40.1.12", "joomla", { domains: [d("konferencje")], label: "Konferencje naukowe" }),
  host("10.40.1.13", "drupal", { domains: [d("fizyka")], label: "Wydział Fizyki" }),
  host("10.40.1.14", "moodle", { domains: [d("elearning")], label: "E-learning", changes: ["upgrade"] }),
  host("10.40.1.15", "mediawiki", { domains: [d("wiki")], label: "Wiki Kampus" }),
  host("10.40.1.16", "nextcloud", { domains: [d("chmura")] }),
  host("10.40.1.17", "apacheDefault", { ptr: d("web-old") }),
  host("10.40.1.18", "nginxDefault", { variant: 3 }),
  host("10.40.1.19", "iis", {
    domains: [d("rekrutacja")],
    label: "Rekrutacja",
    changes: ["maintenance"],
  }),
  host("10.40.1.21", "wordpress", {
    domains: [d("blog")],
    label: "Blog Kampus",
    variant: 1,
    run2: "down",
  }),
  host("10.40.1.22", "joomla", {
    domains: [d("stara-strona")],
    label: "Stara strona instytutu",
    variant: 1,
    run2: "down",
  }),

  // DevOps and monitoring
  host("10.40.2.10", "gitlab", { domains: [d("git")], changes: ["upgrade"] }),
  host("10.40.2.11", "jenkins", { domains: [d("jenkins")], changes: ["upgrade"] }),
  host("10.40.2.12", "grafana", { domains: [d("grafana")] }),
  host("10.40.2.13", "kibana", { domains: [d("logi")] }),
  host("10.40.2.14", "elasticsearch", { ptr: d("es01") }),
  host("10.40.2.15", "zabbix", { domains: [d("zabbix")] }),
  host("10.40.2.16", "phpmyadmin", { domains: [d("pma")] }),
  host("10.40.2.17", "tomcat", { domains: [d("aplikacje")] }),
  host("10.40.2.18", "tomcat", { ptr: d("tomcat02"), variant: 1, changes: ["close-port"] }),
  host("10.40.2.20", "linux", { ptr: d("bastion"), variant: 2 }),

  // Staging and test
  host("10.40.4.10", "stagingWordpress", {
    domains: [d("staging")],
    label: "Portal Kampus",
    changes: ["retitle"],
  }),
  host("10.40.4.11", "swagger", { domains: [d("api-test")] }),
  host("10.40.4.12", "djangoDev", { domains: [d("dev")] }),
  host("10.40.4.13", "tomcat", { domains: [d("test-aplikacje")], variant: 1 }),
  // Appears in the second run: a CI server someone exposed on the staging network.
  host("10.40.4.14", "jenkins", { domains: [d("ci-staging")], variant: 1, run1: "down" }),
  // Unstable: gone at night, back in the afternoon run.
  host("10.40.4.15", "nginxDefault", { ptr: d("test-proxy"), run2: "down", run3: "up" }),
  // Timed out in the first run: unknown, not new, in the second.
  host("10.40.4.16", "grafana", { domains: [d("grafana-test")], run1: "timeout" }),
  // Exposed in the last run: a database admin panel on the staging network.
  host("10.40.4.17", "phpmyadmin", {
    domains: [d("pma-test")],
    run1: "down",
    run2: "down",
    run3: "down",
    run4: "up",
  }),
];

interface Population {
  /** Assigned round-robin, so a fate's index always lands on the same profile. */
  profiles: readonly ProfileKey[];
  count: number;
  /** First and last address the population is scattered over. */
  from: string;
  to: string;
  ptr?: (index: number) => string;
  /** Fates by position: the k-th host of the population gets `fates[k]`. */
  fates?: Record<
    number,
    Partial<Pick<HostOptions, "run1" | "run2" | "run3" | "run4" | "changes" | "changesFrom">>
  >;
}

/** Bulk hosts: a realistic background of lab machines, Windows hosts, devices and databases. */
const POPULATIONS: Population[] = [
  {
    profiles: ["mysql", "mysql", "postgres", "postgres", "redis", "mongodb", "mssql", "oracle"],
    count: 19,
    from: "10.40.8.1",
    to: "10.40.11.254",
    ptr: (i) => d(`db${String(i + 1).padStart(2, "0")}`),
    // 4 and 12 are Redis: the port closes.
    fates: { 4: { changes: ["close-port"] }, 12: { changes: ["close-port"] }, 9: { run2: "timeout" } },
  },
  {
    profiles: ["linux", "linux", "linux", "linux", "linux", "linuxNfs", "linuxVnc"],
    count: 75,
    from: "10.40.16.1",
    to: "10.40.23.254",
    ptr: (i) => d(`lab-${String(i + 1).padStart(3, "0")}`),
    fates: {
      3: { changes: ["upgrade"] },
      11: { changes: ["upgrade"] },
      19: { changes: ["upgrade"] },
      27: { changes: ["upgrade"] },
      35: { changes: ["upgrade", "open-port"] },
      43: { changes: ["upgrade"] },
      7: { run2: "down" },
      23: { run2: "down" },
      51: { run2: "down" },
      14: { run2: "timeout" },
      30: { run2: "timeout" },
      46: { run2: "timeout" },
      60: { run2: "timeout" },
      38: { run1: "timeout" },
      66: { run1: "timeout" },
      70: { run1: "down" },
      72: { run1: "down" },
      74: { run1: "down" },
    },
  },
  {
    profiles: ["windows", "windows", "windows", "iis"],
    count: 40,
    from: "10.40.24.1",
    to: "10.40.27.254",
    ptr: (i) => d(`srv-win${String(i + 1).padStart(2, "0")}`),
    fates: {
      5: { changes: ["close-port"] },
      17: { changes: ["close-port"] },
      12: { run2: "down" },
      29: { run2: "timeout" },
      33: { run1: "down" },
    },
  },
  {
    profiles: ["camera"],
    count: 20,
    from: "10.40.32.10",
    to: "10.40.32.250",
    fates: {
      2: { changes: ["open-port"] },
      9: { changes: ["open-port"] },
      15: { changes: ["open-port"] },
      6: { run2: "timeout" },
      12: { run2: "timeout" },
      19: { run1: "down" },
    },
  },
  {
    profiles: ["printer"],
    count: 10,
    from: "10.40.33.10",
    to: "10.40.33.250",
    ptr: (i) => d(`drukarka-${i + 1}`),
    fates: { 3: { changes: ["renew-cert"] } },
  },
  {
    profiles: ["nas", "nas", "nas", "ups", "networkSwitch", "networkSwitch", "networkSwitch"],
    count: 11,
    from: "10.40.34.1",
    to: "10.40.35.254",
  },
  {
    profiles: ["workstation"],
    count: 40,
    from: "10.40.40.1",
    to: "10.40.62.254",
    ptr: (i) => d(`ws-${String(i + 1).padStart(3, "0")}`),
    fates: {
      4: { changes: ["open-port"] },
      21: { changes: ["open-port"] },
      8: { run2: "down" },
      16: { run2: "down" },
      26: { run1: "down" },
      33: { run1: "down" },
      // Left on some nights, switched off on others, always on in the afternoon: unstable.
      10: { run2: "down", run3: "up", run4: "down" },
      12: { run2: "down", run3: "up", run4: "down" },
      30: { run1: "down", run2: "down", run3: "up", run4: "down" },
      // Remote desktop enabled before the last run.
      35: { changes: ["open-port"], changesFrom: 4 },
    },
  },
  {
    // The last job of the second run hits its deadline: the upper half goes unscanned.
    profiles: ["linux"],
    count: 6,
    from: "10.40.63.20",
    to: "10.40.63.240",
    ptr: (i) => d(`archiwum-${i + 1}`),
  },
];

const SEED = 0x5eed2026;

function scatter(random: ReturnType<typeof createRandom>, population: Population, taken: Set<string>) {
  const from = ipv4ToInt(population.from);
  const to = ipv4ToInt(population.to);
  const picked: string[] = [];
  while (picked.length < population.count) {
    const ip = intToIpv4(random.int(from, to));
    const lastOctet = Number(ip.split(".")[3]);
    if (lastOctet === 0 || lastOctet === 255 || taken.has(ip)) continue;
    taken.add(ip);
    picked.push(ip);
  }
  return picked.toSorted((a, b) => ipv4ToInt(a) - ipv4ToInt(b));
}

function buildNetwork(): DemoHost[] {
  const random = createRandom(SEED);
  const taken = new Set(NAMED_HOSTS.map((named) => named.ip));
  const hosts = [...NAMED_HOSTS];
  for (const population of POPULATIONS) {
    scatter(random, population, taken).forEach((ip, index) => {
      hosts.push(
        host(ip, population.profiles[index % population.profiles.length], {
          ptr: population.ptr?.(index),
          variant: random.int(0, 11),
          ...population.fates?.[index],
        }),
      );
    });
  }
  return hosts.toSorted((a, b) => ipv4ToInt(a.ip) - ipv4ToInt(b.ip));
}

let network: DemoHost[] | undefined;

/** Every host that answers in at least one run; any other address of the /18 is `down`. */
export function demoNetwork(): readonly DemoHost[] {
  network ??= buildNetwork();
  return network;
}

/** The domain targets: what a resolver would return for each of them. */
export function demoDomainHosts(): ScanJobHost[] {
  return demoNetwork().flatMap((demoHost) =>
    demoHost.domains.map((domain) => ({ ip: demoHost.ip, domain })),
  );
}
