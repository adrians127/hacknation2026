import type {
  ServiceGroup,
  Technology,
  TechnologyCategory,
  TechnologyConfidence,
  TechnologyInstance,
  TechnologySource,
} from "@subsurf/contracts/reports/reports.schema";
import type { HttpEndpoint } from "@subsurf/contracts/workers/worker-result.schema";

import { generators } from "~backend/modules/reports/findings";
import { headerValues, type ReportService } from "~backend/modules/reports/report-data";

interface Detection {
  name: string;
  category: TechnologyCategory;
  version: string | null;
  source: TechnologySource;
}

interface Known {
  name: string;
  category: TechnologyCategory;
}

const known = (name: string, category: TechnologyCategory): Known => ({ name, category });

/** Lowercase aliases (header tokens, product names) to one name per technology. */
const ALIASES = new Map<string, Known>([
  ["nginx", known("nginx", "web-server")],
  ["openresty", known("OpenResty", "web-server")],
  ["apache", known("Apache httpd", "web-server")],
  ["apache httpd", known("Apache httpd", "web-server")],
  ["microsoft-iis", known("Microsoft IIS", "web-server")],
  ["microsoft iis httpd", known("Microsoft IIS", "web-server")],
  ["lighttpd", known("lighttpd", "web-server")],
  ["caddy", known("Caddy", "web-server")],
  ["jetty", known("Jetty", "web-server")],
  ["gunicorn", known("Gunicorn", "web-server")],
  ["wsgiserver", known("WSGIServer", "web-server")],
  ["werkzeug", known("Werkzeug", "web-server")],
  ["kestrel", known("Kestrel", "web-server")],
  ["cpython", known("Python", "language")],
  ["python", known("Python", "language")],
  ["php", known("PHP", "language")],
  ["asp.net", known("ASP.NET", "framework")],
  ["express", known("Express", "framework")],
  ["next.js", known("Next.js", "framework")],
  ["servlet", known("Java Servlet", "framework")],
  ["apache tomcat", known("Apache Tomcat", "application")],
  ["apache tomcat/coyote jsp engine", known("Apache Tomcat", "application")],
  ["wordpress", known("WordPress", "cms")],
  ["joomla!", known("Joomla!", "cms")],
  ["joomla", known("Joomla!", "cms")],
  ["drupal", known("Drupal", "cms")],
  ["mediawiki", known("MediaWiki", "cms")],
  ["moodle", known("Moodle", "cms")],
  ["typo3", known("TYPO3", "cms")],
  ["typo3 cms", known("TYPO3", "cms")],
  ["ghost", known("Ghost", "cms")],
  ["roundcube", known("Roundcube", "application")],
  ["nextcloud", known("Nextcloud", "application")],
  ["jenkins", known("Jenkins", "application")],
  ["gitlab", known("GitLab", "application")],
  ["grafana", known("Grafana", "application")],
  ["kibana", known("Kibana", "application")],
  ["zabbix", known("Zabbix", "application")],
  ["phpmyadmin", known("phpMyAdmin", "application")],
  ["swagger ui", known("Swagger UI", "application")],
  ["django", known("Django", "framework")],
  ["laravel", known("Laravel", "framework")],
  ["elasticsearch", known("Elasticsearch", "service")],
  ["boa", known("Boa", "device")],
  ["boa httpd", known("Boa", "device")],
  ["allegro-software-rompager", known("RomPager", "device")],
  ["allegro rompager", known("RomPager", "device")],
  ["cisco-ios", known("Cisco IOS", "device")],
  ["cisco ios http config", known("Cisco IOS", "device")],
  ["hp http server", known("HP printer web server", "device")],
  ["hp printer http config", known("HP printer web server", "device")],
  ["mikrotik router config httpd", known("MikroTik RouterOS", "device")],
  ["elasticsearch rest api", known("Elasticsearch", "service")],
  ["node.js express framework", known("Express", "framework")],
  ["synology diskstation", known("Synology DSM", "device")],
  ["idrac", known("Dell iDRAC", "device")],
  ["routeros", known("MikroTik RouterOS", "device")],
]);

const DEVICE_PRODUCT = /mikrotik|cisco|hp (http|jetdirect)|printer|rompager|\bboa\b|synology|idrac|hikvision|dahua|ubiquiti|apc |ups|camera/i;

function lookup(name: string, fallback: TechnologyCategory): Known {
  return ALIASES.get(name.trim().toLowerCase()) ?? known(name.trim(), fallback);
}

function detect(name: string, version: string | null, source: TechnologySource, fallback: TechnologyCategory): Detection {
  const { name: canonical, category } = lookup(name, fallback);
  return { name: canonical, category, version: version || null, source };
}

/** `nginx/1.18.0 (Ubuntu)`, `Jetty(10.0.20)`, `WSGIServer/0.2 CPython/3.11.4`. */
function serverTokens(value: string): Detection[] {
  if (/^hp http server/i.test(value)) return [detect("hp http server", null, "header", "device")];
  const withoutComments = value.replaceAll(/\([^)]*\)(?=\s|$)/g, " ");
  const jetty = /^jetty\(([^)]+)\)/i.exec(value);
  if (jetty) return [detect("jetty", jetty[1] ?? null, "header", "web-server")];
  return withoutComments
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const [name = token, version = null] = token.split("/");
      return detect(name, version, "header", "web-server");
    });
}

/** `Drupal 10 (https://www.drupal.org)`, `WordPress 6.7.1`, `Joomla! - ... - Version 3.9.28`. */
function nameAndVersion(value: string, source: TechnologySource, fallback: TechnologyCategory): Detection {
  const trimmed = value.replace(/\s*\(https?:[^)]*\)/, "").trim();
  const joomla = /^joomla!?/i.exec(trimmed);
  if (joomla) return detect("joomla", /version (\d[\w.]*)/i.exec(trimmed)?.[1] ?? null, source, "cms");
  const match = /^(.+?)\s+v?(\d[\w.-]*)$/.exec(trimmed);
  return match ? detect(match[1] ?? trimmed, match[2] ?? null, source, fallback) : detect(trimmed, null, source, fallback);
}

const COOKIES: readonly [RegExp, string][] = [
  [/^phpsessid$/i, "php"],
  [/^jsessionid/i, "servlet"],
  [/^asp\.net_sessionid$/i, "asp.net"],
  [/^laravel_session$/i, "laravel"],
  [/^csrftoken$/i, "django"],
  [/^(wordpress_|wp-settings)/i, "wordpress"],
  [/^moodlesession/i, "moodle"],
  [/^_gitlab_session$/i, "gitlab"],
  [/^roundcube_sessid$/i, "roundcube"],
  [/^zbx_session$/i, "zabbix"],
  [/^grafana_session$/i, "grafana"],
  [/^nc_session_id$|^oc_sessionpassphrase$/i, "nextcloud"],
];

const TITLES: readonly [RegExp, string, RegExp?][] = [
  [/phpmyadmin/i, "phpmyadmin"],
  [/^grafana$/i, "grafana"],
  [/^zabbix/i, "zabbix"],
  [/^nextcloud/i, "nextcloud"],
  [/^swagger ui$/i, "swagger ui"],
  [/synology diskstation/i, "synology diskstation"],
  [/idrac/i, "idrac", /idrac\s?(\d+)/i],
  [/\[jenkins\]/i, "jenkins"],
  [/gitlab/i, "gitlab"],
  [/roundcube webmail/i, "roundcube"],
  [/routeros/i, "routeros", /routeros v?(\d[\d.]*)/i],
  [/^apache tomcat/i, "apache tomcat", /tomcat\/(\d[\d.]*)/i],
  [/: log in to the site$/i, "moodle"],
  [/^iis windows server$/i, "microsoft-iis"],
  [/^welcome to nginx!?$/i, "nginx"],
  [/apache2 (ubuntu|debian) default page/i, "apache"],
];

const HEADER_MARKERS: readonly [string, string, boolean][] = [
  ["x-drupal-cache", "drupal", false],
  ["x-drupal-dynamic-cache", "drupal", false],
  ["x-jenkins", "jenkins", true],
  ["x-gitlab-meta", "gitlab", false],
  ["kbn-name", "kibana", false],
  ["kbn-version", "kibana", true],
  ["x-elastic-product", "elasticsearch", false],
];

function endpointDetections(endpoint: HttpEndpoint): Detection[] {
  const found: Detection[] = [];
  for (const value of headerValues(endpoint, "server")) found.push(...serverTokens(value));
  for (const value of headerValues(endpoint, "x-powered-by")) {
    found.push(...value.split(/[,;]\s*/).map((part) => nameAndVersion(part.replace("/", " "), "header", "framework")));
  }
  for (const value of headerValues(endpoint, "x-aspnet-version")) found.push(detect("asp.net", value, "header", "framework"));
  for (const value of headerValues(endpoint, "x-generator")) found.push(nameAndVersion(value, "header", "cms"));
  for (const [header, name, isVersion] of HEADER_MARKERS) {
    for (const value of headerValues(endpoint, header)) {
      found.push(detect(name, isVersion ? value : null, "header", "application"));
    }
  }
  for (const value of generators(endpoint)) found.push(nameAndVersion(value, "meta-generator", "cms"));

  const content = endpoint.body?.content ?? "";
  if (/\/wp-(content|includes)\//i.test(content)) found.push(detect("wordpress", null, "body", "cms"));
  if (/\/media\/jui\/|\/media\/system\/js\/core\.js/i.test(content)) found.push(detect("joomla", null, "body", "cms"));
  if (/drupal-settings-json|\/sites\/default\/files\//i.test(content)) found.push(detect("drupal", null, "body", "cms"));

  for (const cookie of endpoint.cookies) {
    const match = COOKIES.find(([pattern]) => pattern.test(cookie.name));
    if (match) found.push(detect(match[1], null, "cookie", "framework"));
  }
  const title = endpoint.title ?? "";
  for (const [pattern, name, versionPattern] of TITLES) {
    if (pattern.test(title)) found.push(detect(name, versionPattern?.exec(title)?.[1] ?? null, "title", "application"));
  }
  for (const probe of endpoint.probes) {
    if (probe.path === "/wp-login.php" && probe.statusCode === 200) found.push(detect("wordpress", null, "probe", "cms"));
    if (probe.path === "/manager/html" && probe.statusCode === 401) found.push(detect("apache tomcat", null, "probe", "application"));
    if (probe.path === "/server-status" && probe.title === "Apache Status") found.push(detect("apache", null, "probe", "web-server"));
  }
  return found;
}

function serviceDetections(service: ReportService): Detection[] {
  const found: Detection[] = [];
  const { product, version } = service.identity;
  if (product) {
    const category: TechnologyCategory = DEVICE_PRODUCT.test(product) ? "device" : service.details.http.length > 0 ? "web-server" : "service";
    const alias = ALIASES.get(product.toLowerCase());
    found.push(alias ? { ...alias, version, source: "service-detection" } : { name: product, category, version, source: "service-detection" });
  }
  return [...found, ...service.details.http.flatMap(endpointDetections)];
}

const EXPLICIT_SOURCES = new Set<TechnologySource>(["service-detection", "header", "meta-generator"]);

function confidence(sources: ReadonlySet<TechnologySource>): TechnologyConfidence {
  if (sources.size >= 2) return "high";
  return [...sources].some((source) => EXPLICIT_SOURCES.has(source)) ? "medium" : "low";
}

/** The most specific version any source gave (`6.7.1` over `6`). */
function bestVersion(versions: readonly (string | null)[]): string | null {
  return versions.filter((version) => version !== null).toSorted((a, b) => b.length - a.length)[0] ?? null;
}

export interface ServiceTechnology {
  name: string;
  category: TechnologyCategory;
  instance: TechnologyInstance;
}

/** What runs on one service, one entry per technology. */
export function technologiesOf(service: ReportService): ServiceTechnology[] {
  const merged = new Map<string, { category: TechnologyCategory; versions: (string | null)[]; sources: Set<TechnologySource> }>();
  for (const detection of serviceDetections(service)) {
    if (!/[a-z]/i.test(detection.name)) continue;
    const entry = merged.get(detection.name) ?? { category: detection.category, versions: [], sources: new Set() };
    entry.versions.push(detection.version);
    entry.sources.add(detection.source);
    merged.set(detection.name, entry);
  }
  return [...merged].map(([name, entry]) => ({
    name,
    category: entry.category,
    instance: {
      hostId: service.hostId,
      serviceId: service.serviceId,
      ip: service.ip,
      port: service.port,
      version: bestVersion(entry.versions),
      sources: [...entry.sources].toSorted(),
      confidence: confidence(entry.sources),
    },
  }));
}

export function inventory(services: readonly ReportService[]): Technology[] {
  const byName = new Map<string, { category: TechnologyCategory; instances: TechnologyInstance[] }>();
  for (const service of services) {
    for (const { name, category, instance } of technologiesOf(service)) {
      const entry = byName.get(name) ?? { category, instances: [] };
      entry.instances.push(instance);
      byName.set(name, entry);
    }
  }
  return [...byName]
    .map(([name, { category, instances }]): Technology => {
      const versions = new Map<string | null, number>();
      for (const instance of instances) versions.set(instance.version, (versions.get(instance.version) ?? 0) + 1);
      return {
        name,
        category,
        hosts: new Set(instances.map((instance) => instance.hostId)).size,
        services: instances.length,
        versions: [...versions]
          .map(([version, count]) => ({ version, services: count }))
          .toSorted((a, b) => b.services - a.services),
        instances,
      };
    })
    .toSorted((a, b) => b.hosts - a.hosts || a.name.localeCompare(b.name));
}

export function serviceGroups(services: readonly ReportService[]): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>();
  const add = (kind: ServiceGroup["kind"], key: string, label: string, service: ReportService) => {
    const id = `${kind}\u0000${key}`;
    const group = groups.get(id) ?? { kind, label, services: 0, members: [] };
    if (group.members.some((member) => member.serviceId === service.serviceId)) return;
    group.members.push({ hostId: service.hostId, serviceId: service.serviceId, ip: service.ip, port: service.port });
    group.services = group.members.length;
    groups.set(id, group);
  };
  for (const service of services) {
    const { name, product, version } = service.identity;
    const software = product ? [product, version].filter(Boolean).join(" ") : null;
    if (software) add("software", `${name ?? ""}|${software}`, name ? `${software} (${name})` : software, service);
    for (const endpoint of service.details.http) {
      if (!endpoint.title) continue;
      const favicon = endpoint.favicon?.mmh3;
      add("web-page", `${endpoint.title}|${favicon ?? ""}`, favicon === undefined ? endpoint.title : `${endpoint.title} · favicon ${favicon}`, service);
    }
  }
  return [...groups.values()]
    .filter((group) => group.services >= 2)
    .toSorted((a, b) => b.services - a.services || a.label.localeCompare(b.label));
}
