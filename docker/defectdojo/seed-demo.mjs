#!/usr/bin/env node
/**
 * Fills the local DefectDojo with fictional demo data: people, organizations, assets with
 * owners and an SLA, two scan runs of SubSurf findings (import + reimport) and triage
 * decisions (verified, false positive, out of scope, risk accepted, mitigated, notes,
 * reviewers). Findings go through POST /import-scan/ and /reimport-scan/ as
 * `Generic Findings Import`, the same path the backend export will use.
 *
 * Findings sit on hosts of SubSurf's own demo scans (`pnpm db:seed:hosts`, 10.40.0.0/18,
 * campus.example), so a DefectDojo sync in SubSurf matches them. People and the university
 * are made up. See docker/README.md#demo-data.
 *
 * Run via `pnpm dojo:seed` (`-- --reset` deletes the demo organizations first).
 * Env: DD_URL, DD_API_TOKEN (defaults match docker-compose.yml), DD_DEMO_PASSWORD.
 */

const DD_URL = (process.env.DD_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const DD_API_TOKEN = process.env.DD_API_TOKEN ?? "943acbe9baff8da06895e4349f3d06ee293189e8";
const DEMO_PASSWORD = process.env.DD_DEMO_PASSWORD ?? "SubSurf-demo-2026!";
const RESET = process.argv.includes("--reset");

const ENGAGEMENT = "SubSurf continuous discovery";
const TEST_TITLE = "SubSurf discovery scan";
const RUN_1 = "2026-11-20";
const RUN_2 = "2026-11-21";

const PEOPLE = [
  { username: "anna.nowak", first_name: "Anna", last_name: "Nowak", title: "Security analyst" },
  { username: "piotr.kowalski", first_name: "Piotr", last_name: "Kowalski", title: "Network administrator" },
  { username: "marta.wisniewska", first_name: "Marta", last_name: "Wiśniewska", title: "Web team lead" },
  { username: "tomasz.zielinski", first_name: "Tomasz", last_name: "Zieliński", title: "CISO (risk owner)" },
  { username: "ewa.lewandowska", first_name: "Ewa", last_name: "Lewandowska", title: "Research lab IT" },
];

const ORGANIZATIONS = [
  { name: "Demo University · Core Infrastructure", description: "Core network, DevOps and monitoring of the fictional Demo University (SubSurf demo data).", critical_product: true },
  { name: "Demo University · Research Networks", description: "Database servers and lab networks (SubSurf demo data)." },
  { name: "Demo University · Public Web", description: "Public websites and staging under campus.example (SubSurf demo data).", key_product: true },
];

// Hosts, ports and versions match `pnpm db:seed:hosts` (apps/backend/src/demo), so a
// DefectDojo sync in SubSurf finds every one of these services.
const ASSETS = [
  {
    key: "core",
    organization: 0,
    name: "Campus core and DevOps 10.40.0.0/22",
    description: "Routers, switches, mail, UPS and BMCs (10.40.0.0/24) and the DevOps network (10.40.2.0/24). Scanned nightly by SubSurf.",
    business_criticality: "high",
    internet_accessible: true,
    product_manager: "tomasz.zielinski",
    technical_contact: "piotr.kowalski",
    team_manager: "anna.nowak",
    tags: ["subsurf", "core-network", "internet-facing"],
  },
  {
    key: "data",
    organization: 1,
    name: "Databases and labs 10.40.8.0/21",
    description: "Database servers and lab machines reachable from the campus network.",
    business_criticality: "medium",
    internet_accessible: false,
    product_manager: "tomasz.zielinski",
    technical_contact: "ewa.lewandowska",
    team_manager: "anna.nowak",
    tags: ["subsurf", "research", "internal"],
  },
  {
    key: "web",
    organization: 2,
    name: "Public websites *.campus.example",
    description: "University websites (10.40.1.0/24) and the staging network (10.40.4.0/24).",
    business_criticality: "high",
    internet_accessible: true,
    product_manager: "tomasz.zielinski",
    technical_contact: "marta.wisniewska",
    team_manager: "anna.nowak",
    tags: ["subsurf", "web", "cms"],
  },
];

// `runs` marks the scan runs that report the finding: run 2 drops what got fixed and adds new ones.
const FINDINGS = [
  // Campus core and DevOps
  {
    asset: "core", runs: [1, 2], host: "10.40.0.30", port: 80, url: "http://10.40.0.30:80",
    id: "rompager-cve-2014-9222",
    title: "Allegro RomPager 4.01 cookie handling memory corruption (Misfortune Cookie, CVE-2014-9222)",
    severity: "Critical",
    vulnerability_ids: ["CVE-2014-9222"],
    component_name: "allegrosoft:rompager", component_version: "4.01", fix_available: true, fix_version: "4.34",
    detail: "Server header Allegro-Software-RomPager/4.01 on the UPS management card ups-srv1.campus.example. Version-based match; not verified by exploitation.",
    mitigation: "Update the management card firmware and move the web interface to the management VLAN.",
    references: "https://nvd.nist.gov/vuln/detail/CVE-2014-9222",
    extraTags: ["embedded", "management"],
  },
  {
    asset: "core", runs: [1, 2], host: "10.40.0.1", port: 23, url: "telnet://10.40.0.1:23",
    id: "telnet-exposed",
    title: "Telnet management enabled on the edge router",
    severity: "Medium", cwe: 319,
    component_name: "mikrotik:routeros",
    detail: "MikroTik router telnetd answers on 23 (gw.campus.example). No login was attempted.",
    mitigation: "Disable telnet (/ip service disable telnet) and manage the router over SSH from the admin VLAN.",
    extraTags: ["cleartext", "remote-access", "network-device"],
  },
  {
    asset: "core", runs: [1, 2], host: "10.40.0.2", port: 23, url: "telnet://10.40.0.2:23",
    id: "telnet-exposed",
    title: "Telnet management enabled on a core switch",
    severity: "Medium", cwe: 319,
    component_name: "cisco:ios",
    detail: "Cisco router telnetd answers on 23 (core-sw1.campus.example). No login was attempted.",
    mitigation: "Set transport input ssh on the VTY lines.",
    extraTags: ["cleartext", "remote-access", "network-device"],
  },
  {
    asset: "core", runs: [1, 2], host: "10.40.0.1", port: 21, url: "ftp://10.40.0.1:21",
    id: "ftp-cleartext",
    title: "FTP service with cleartext authentication",
    severity: "Low", cwe: 319,
    component_name: "mikrotik:routeros", component_version: "6.49.10",
    detail: "Banner: MikroTik router ftpd 6.49.10 (gw.campus.example). AUTH TLS is not offered.",
    mitigation: "Disable the router's FTP service; use SFTP for backups.",
    extraTags: ["cleartext", "network-device"],
  },
  {
    asset: "core", runs: [1, 2], host: "10.40.0.40", port: 443, url: "https://10.40.0.40:443",
    id: "bmc-exposed",
    title: "Server BMC (iDRAC) web interface reachable from the campus network",
    severity: "Medium", cwe: 668,
    detail: "iDRAC9 login page on idrac-vh01.campus.example. No login was attempted.",
    mitigation: "Move the BMCs to an isolated management VLAN.",
    extraTags: ["management", "exposure"],
  },
  {
    asset: "core", runs: [1, 2], host: "10.40.2.14", port: 9200, url: "http://10.40.2.14:9200",
    id: "elasticsearch-exposed",
    title: "Elasticsearch HTTP API reachable without authentication",
    severity: "High", cwe: 306,
    component_name: "elastic:elasticsearch", component_version: "7.17.9",
    detail: "GET / on es01.campus.example returns the cluster banner (version 7.17.9). No data was read.",
    mitigation: "Enable Elasticsearch security (TLS and authentication) and bind it to the logging VLAN.",
    extraTags: ["exposure", "database"],
  },
  {
    asset: "core", runs: [1, 2], host: "10.40.2.17", port: 8080, url: "http://10.40.2.17:8080/manager/html",
    id: "tomcat-manager-exposed",
    title: "Tomcat Manager application exposed",
    severity: "Medium", cwe: 668,
    component_name: "apache:tomcat", component_version: "9.0.65",
    detail: "/manager/html on aplikacje.campus.example answers 401 with a Basic auth challenge. No credentials were tried.",
    mitigation: "Remove the manager webapp or allow it from the admin VLAN only (RemoteAddrValve).",
    extraTags: ["admin-panel", "app-server"],
  },
  {
    asset: "core", runs: [1, 2], host: "10.40.2.16", port: 443, url: "https://10.40.2.16:443",
    id: "phpmyadmin-exposed",
    title: "phpMyAdmin login page exposed",
    severity: "Medium", cwe: 668,
    component_name: "phpmyadmin:phpmyadmin",
    detail: "pma.campus.example serves the phpMyAdmin login form. No login was attempted.",
    mitigation: "Put phpMyAdmin behind the VPN or SSO.",
    extraTags: ["admin-panel", "database"],
  },
  {
    asset: "core", runs: [1], host: "10.40.2.11", port: 8080, url: "http://10.40.2.11:8080",
    id: "jenkins-outdated",
    title: "Jenkins LTS 2.426.3 is outdated",
    severity: "Medium", cwe: 1104,
    component_name: "jenkins:jenkins", component_version: "2.426.3", fix_available: true, fix_version: "2.452.4",
    detail: "X-Jenkins header on jenkins.campus.example reports 2.426.3; later LTS releases fix several security advisories.",
    mitigation: "Upgrade to the current Jenkins LTS.",
    extraTags: ["ci-cd", "outdated"],
  },
  {
    asset: "core", runs: [2], host: "10.40.4.14", port: 8080, url: "http://10.40.4.14:8080",
    id: "jenkins-exposed",
    title: "Unknown Jenkins server on the staging network",
    severity: "Medium", cwe: 668,
    component_name: "jenkins:jenkins", component_version: "2.462.3",
    detail: "New in this scan: ci-staging.campus.example answers with a Jenkins login page (X-Jenkins 2.462.3).",
    mitigation: "Identify the owner; CI servers belong in the DevOps network behind SSO.",
    extraTags: ["ci-cd", "new"],
  },

  // Databases and labs
  {
    asset: "data", runs: [1, 2], host: "10.40.8.72", port: 22, url: "ssh://10.40.8.72:22",
    id: "openssh-cve-2024-6387",
    title: "OpenSSH 8.7 signal handler race (regreSSHion, CVE-2024-6387)",
    severity: "High", cvssv3: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H", cvssv3_score: 8.1,
    vulnerability_ids: ["CVE-2024-6387"], cwe: 364,
    component_name: "openbsd:openssh", component_version: "8.7", fix_available: true, fix_version: "9.8p1",
    detail: "SSH banner reports OpenSSH 8.7 (db01.campus.example). Distribution packages may carry the backported fix.",
    mitigation: "Install the patched openssh package; set LoginGraceTime 0 as a stopgap.",
    references: "https://nvd.nist.gov/vuln/detail/CVE-2024-6387",
    extraTags: ["ssh"],
  },
  {
    asset: "data", runs: [1], host: "10.40.9.64", port: 6379, url: "redis://10.40.9.64:6379",
    id: "redis-exposed",
    title: "Redis reachable from the campus network",
    severity: "High", cwe: 306,
    component_name: "redis:redis",
    detail: "TCP 6379 answers with a Redis protocol banner. No commands were sent.",
    mitigation: "Firewall the port and enable protected-mode with a password.",
    extraTags: ["exposure", "database"],
  },
  {
    asset: "data", runs: [1, 2], host: "10.40.10.65", port: 3306, url: "mysql://10.40.10.65:3306",
    id: "mysql-eol",
    title: "MySQL 5.7 is end of life",
    severity: "Medium", cwe: 1104,
    component_name: "oracle:mysql", component_version: "5.7.44",
    detail: "Handshake reports 5.7.44. MySQL 5.7 has had no security updates since October 2023.",
    mitigation: "Migrate to MySQL 8.0 or 8.4 LTS.",
    extraTags: ["eol", "database"],
  },
  {
    asset: "data", runs: [1, 2], host: "10.40.8.223", port: 5432, url: "postgresql://10.40.8.223:5432",
    id: "postgres-exposed",
    title: "PostgreSQL reachable from the campus network",
    severity: "Medium", cwe: 668,
    detail: "TCP 5432 accepts connections and requests authentication. No login was attempted.",
    mitigation: "Restrict pg_hba.conf and the firewall to the lab application servers.",
    extraTags: ["exposure", "database"],
  },
  {
    asset: "data", runs: [1, 2], host: "10.40.9.139", port: 27017, url: "mongodb://10.40.9.139:27017",
    id: "mongodb-exposed",
    title: "MongoDB reachable from the campus network",
    severity: "Medium", cwe: 668,
    component_name: "mongodb:mongodb", component_version: "6.0.13",
    detail: "Wire protocol handshake reports MongoDB 6.0.13. No database was listed.",
    mitigation: "Enable authentication and bind to the lab VLAN only.",
    extraTags: ["exposure", "database"],
  },
  {
    asset: "data", runs: [1, 2], host: "10.40.9.179", port: 3389, url: "rdp://10.40.9.179:3389",
    id: "rdp-exposed",
    title: "Remote Desktop (RDP) reachable from the campus network",
    severity: "Medium", cwe: 668,
    detail: "TCP 3389 answers with an RDP negotiation response. No login was attempted.",
    mitigation: "Move RDP behind the VPN or a bastion host; restrict the source addresses.",
    extraTags: ["exposure", "remote-access"],
  },
  {
    asset: "data", runs: [1, 2], host: "10.40.9.179", port: 1433, url: "mssql://10.40.9.179:1433",
    id: "mssql-exposed",
    title: "Microsoft SQL Server reachable from the campus network",
    severity: "Medium", cwe: 668,
    component_name: "microsoft:sql_server",
    detail: "TDS pre-login response on 1433. No login was attempted.",
    mitigation: "Allow 1433 from the application servers only.",
    extraTags: ["exposure", "database"],
  },

  // Public websites
  {
    asset: "web", runs: [1, 2], host: "10.40.1.10", port: 443, url: "https://www.campus.example:443",
    id: "wordpress-detected",
    title: "WordPress detected",
    severity: "Info",
    component_name: "wordpress:wordpress",
    detail: "Detected from the generator meta tag and /wp-content/ asset paths on www.campus.example.",
    mitigation: "Keep WordPress core and plugins up to date; hide the version string.",
    extraTags: ["cms", "fingerprint"],
  },
  {
    asset: "web", runs: [1, 2], host: "10.40.1.10", port: 443, url: "https://www.campus.example:443/wp-login.php",
    id: "wp-login-exposed",
    title: "WordPress login page exposed",
    severity: "Info",
    detail: "/wp-login.php on www.campus.example answers 200. Passive signature; no login was attempted.",
    mitigation: "Restrict /wp-login.php and /wp-admin/ to the staff network or add SSO in front of them.",
    extraTags: ["cms", "admin-panel"],
  },
  {
    asset: "web", runs: [1, 2], host: "10.40.1.11", port: 443, url: "https://aktualnosci.campus.example:443",
    id: "php-eol",
    title: "PHP 7.4 is end of life",
    severity: "Medium", cwe: 1104,
    component_name: "php:php", component_version: "7.4.33",
    detail: "X-Powered-By: PHP/7.4.33 on aktualnosci.campus.example. PHP 7.4 has had no security updates since November 2022.",
    mitigation: "Upgrade to a supported PHP release and remove the X-Powered-By header.",
    extraTags: ["eol", "headers"],
  },
  {
    asset: "web", runs: [1, 2], host: "10.40.1.11", port: 443, url: "https://aktualnosci.campus.example:443",
    id: "cookie-no-secure",
    title: "Session cookie without Secure flag",
    severity: "Low", cwe: 614,
    detail: "Set-Cookie: PHPSESSID on aktualnosci.campus.example lacks the Secure and HttpOnly attributes.",
    mitigation: "Set session.cookie_secure and session.cookie_httponly in php.ini.",
    extraTags: ["headers", "cookies"],
  },
  {
    asset: "web", runs: [2], host: "10.40.1.11", port: 3306, url: "mysql://10.40.1.11:3306",
    id: "mysql-exposed",
    title: "MySQL port opened on a web server",
    severity: "Medium", cwe: 668,
    component_name: "oracle:mysql", component_version: "8.0.39",
    detail: "New in this scan: 3306 is open on aktualnosci.campus.example (MySQL 8.0.39). No login was attempted.",
    mitigation: "Bind MySQL to localhost; the site connects locally.",
    extraTags: ["exposure", "database", "new"],
  },
  {
    asset: "web", runs: [1], host: "10.40.1.22", port: 443, url: "https://stara-strona.campus.example:443",
    id: "tls-cert-expired",
    title: "TLS certificate expired",
    severity: "Medium", cwe: 298,
    detail: "The certificate for stara-strona.campus.example has expired.",
    mitigation: "Renew the certificate or retire the site.",
    extraTags: ["tls", "certificate"],
  },
  {
    asset: "web", runs: [1], host: "10.40.1.22", port: 443, url: "https://stara-strona.campus.example:443",
    id: "joomla-eol",
    title: "Joomla 3.9 is end of life",
    severity: "Medium", cwe: 1104,
    component_name: "joomla:joomla", component_version: "3.9.28",
    detail: "Generator meta tag on stara-strona.campus.example reports Joomla 3.9.28; Joomla 3 has had no updates since August 2023.",
    mitigation: "Migrate the site to Joomla 5 or archive it as static HTML.",
    extraTags: ["cms", "eol"],
  },
  {
    asset: "web", runs: [1, 2], host: "10.40.1.17", port: 80, url: "http://10.40.1.17:80",
    id: "apache-outdated",
    title: "Apache httpd 2.4.29 is outdated",
    severity: "Medium", cwe: 1104,
    component_name: "apache:http_server", component_version: "2.4.29", fix_available: true, fix_version: "2.4.62",
    detail: "Server banner reports Apache/2.4.29 (web-old.campus.example), the Ubuntu 18.04 package.",
    mitigation: "Upgrade the host to a supported Ubuntu release.",
    extraTags: ["outdated", "web-server"],
  },
  {
    asset: "web", runs: [1, 2], host: "10.40.4.12", port: 8000, url: "http://10.40.4.12:8000",
    id: "django-debug",
    title: "Django debug mode enabled",
    severity: "High", cwe: 489,
    component_name: "djangoproject:django",
    detail: "dev.campus.example returns the Django debug 404 page (DEBUG = True), which lists the URL configuration.",
    mitigation: "Set DEBUG = False and keep development servers off the campus network.",
    extraTags: ["staging", "misconfiguration"],
  },
  {
    asset: "web", runs: [1, 2], host: "10.40.4.11", port: 8000, url: "http://10.40.4.11:8000",
    id: "swagger-exposed",
    title: "Swagger UI of a test API exposed",
    severity: "Low", cwe: 200,
    detail: "api-test.campus.example serves Swagger UI with the full API description.",
    mitigation: "Put the test API behind authentication.",
    extraTags: ["staging", "api"],
  },
];

// Triage decisions applied after both runs, by host:port and finding id.
const TRIAGE = {
  "10.40.0.30:80:rompager-cve-2014-9222": {
    verified: true, reviewers: ["piotr.kowalski", "anna.nowak"], planned_remediation_date: "2026-11-27",
    note: "Confirmed: the UPS card still runs the 2019 firmware. Vendor update scheduled for the Friday maintenance window; web interface blocked at the core switch until then.",
  },
  "10.40.4.12:8000:django-debug": {
    verified: true, reviewers: ["marta.wisniewska"], planned_remediation_date: "2026-11-24",
    note: "Development server left running by a student project. Owner asked to set DEBUG = False today.",
  },
  "10.40.2.17:8080:tomcat-manager-exposed": {
    verified: true, reviewers: ["piotr.kowalski"], planned_remediation_date: "2026-12-05",
  },
  "10.40.2.14:9200:elasticsearch-exposed": { reviewers: ["piotr.kowalski"], planned_remediation_date: "2026-12-01" },
  "10.40.8.72:22:openssh-cve-2024-6387": {
    under_review: true, reviewers: ["ewa.lewandowska"],
    note: "Rocky Linux 9 package openssh-8.7p1-38.el9_4.1 contains the backported fix. Checking the installed package before closing as a false positive.",
  },
  "10.40.8.223:5432:postgres-exposed": {
    falsePositive: true,
    note: "10.40.8.223 is the lab's PostgreSQL honeypot (approved by the CISO). Exposure is intentional.",
  },
  "10.40.9.139:27017:mongodb-exposed": {
    outOfScope: true,
    note: "Host belongs to a student project VLAN that is out of scope for this asset.",
  },
  "10.40.9.179:3389:rdp-exposed": {
    riskAccepted: {
      name: "RDP on 10.40.9.179 until the VPN migration",
      decision_details: "The SQL Server vendor connects over RDP from two fixed addresses. Accepted until the VPN migration is finished.",
      expiration_date: "2026-12-31",
      owner: "tomasz.zielinski",
    },
  },
  "10.40.0.1:21:ftp-cleartext": {
    close: "FTP disabled on the router on 2026-11-21 (closed manually before the next scan).",
  },
  "10.40.4.14:8080:jenkins-exposed": {
    reviewers: ["piotr.kowalski"],
    note: "New host found in the 2026-11-21 run. Owner unknown; asked the network team to identify it.",
  },
};

async function api(path, init = {}) {
  const method = init.method ?? "GET";
  const headers = { Authorization: `Token ${DD_API_TOKEN}`, Accept: "application/json" };
  let body = init.body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`${DD_URL}/api/v2${path}`, { method, headers, body });
  } catch (error) {
    throw new Error(`${method} ${path}: cannot reach ${DD_URL} (is it up? pnpm dojo:up)`, { cause: error });
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : null;
}

const findOne = async (path) => (await api(path)).results[0];

// DefectDojo silently ignores unknown filters (e.g. `name` on /sla_configurations/) and returns
// the whole list, so always match the field exactly instead of trusting the filter.
async function findBy(collection, field, value) {
  const page = await api(`/${collection}/?${field}=${encodeURIComponent(value)}&limit=200`);
  return page.results.find((item) => item[field] === value);
}

async function getOrCreate(collection, field, body) {
  return (await findBy(collection, field, body[field])) ?? api(`/${collection}/`, { method: "POST", body });
}

async function ensurePeople() {
  const ids = {};
  for (const person of PEOPLE) {
    const user = await getOrCreate("users", "username", {
      username: person.username,
      first_name: person.first_name,
      last_name: person.last_name,
      email: `${person.username}@campus.example`,
      is_active: true,
      password: DEMO_PASSWORD,
    });
    ids[person.username] = user.id;
    const contact = await findBy("user_contact_infos", "user", user.id);
    if (!contact) await api("/user_contact_infos/", { method: "POST", body: { user: user.id, title: person.title } });
  }
  console.log(`People: ${Object.keys(ids).join(", ")}`);
  return ids;
}

async function ensureSla() {
  return getOrCreate("sla_configurations", "name", {
    name: "SubSurf demo SLA",
    description: "Days to fix by severity for the demo assets.",
    critical: 3, enforce_critical: true,
    high: 14, enforce_high: true,
    medium: 60, enforce_medium: true,
    low: 180, enforce_low: true,
  });
}

async function resetDemo() {
  // Risk acceptances outlive their findings when an organization is deleted.
  const names = new Set(Object.values(TRIAGE).flatMap((d) => (d.riskAccepted ? [d.riskAccepted.name] : [])));
  const acceptances = (await api("/risk_acceptance/?limit=200")).results.filter((ra) => names.has(ra.name));
  for (const ra of acceptances) await api(`/risk_acceptance/${ra.id}/`, { method: "DELETE" });
  for (const org of ORGANIZATIONS) {
    const existing = await findBy("product_types", "name", org.name);
    if (existing) {
      await api(`/product_types/${existing.id}/`, { method: "DELETE" });
      console.log(`Deleted organization "${org.name}"`);
    }
  }
}

async function ensureAssets(people, sla) {
  const assets = {};
  for (const [index, org] of ORGANIZATIONS.entries()) {
    const productType = await getOrCreate("product_types", "name", org);
    for (const asset of ASSETS.filter((a) => a.organization === index)) {
      const product = await getOrCreate("products", "name", {
        name: asset.name,
        description: asset.description,
        prod_type: productType.id,
        business_criticality: asset.business_criticality,
        internet_accessible: asset.internet_accessible,
        product_manager: people[asset.product_manager],
        technical_contact: people[asset.technical_contact],
        team_manager: people[asset.team_manager],
        sla_configuration: sla.id,
        enable_full_risk_acceptance: true,
        tags: asset.tags,
      });
      // The owner fields are informational only; authorized_users is what grants access in 3.5.
      const owners = [...new Set([asset.product_manager, asset.technical_contact, asset.team_manager])];
      await api(`/products/${product.id}/`, { method: "PATCH", body: { authorized_users: owners.map((u) => people[u]) } });
      assets[asset.key] = product;
    }
  }
  console.log(`Assets: ${Object.values(assets).map((p) => p.name).join(" | ")}`);
  return assets;
}

function genericReport(assetKey, run) {
  const findings = FINDINGS.filter((f) => f.asset === assetKey && f.runs.includes(run)).map((f) => {
    const { asset, runs, host, port, url, id, detail, extraTags, tags = [], ...fields } = f;
    return {
      ...fields,
      // The hash for Generic Findings Import is title + cwe + line + file_path + description
      // (endpoints are not part of it), so the host:port must be in the description.
      description: `${host}:${port}/tcp. ${detail}`,
      date: run === 1 ? RUN_1 : RUN_2,
      active: true,
      verified: false,
      dynamic_finding: true,
      static_finding: false,
      unique_id_from_tool: `subsurf:${host}:${port}:${id}`,
      endpoints: [url],
      tags: ["subsurf", ...tags, ...extraTags],
    };
  });
  return { name: "SubSurf", type: "SubSurf discovery", version: "0.1.0", findings };
}

function reportForm(report, fields) {
  const form = new FormData();
  form.set("scan_type", "Generic Findings Import");
  form.set("file", new Blob([JSON.stringify(report)], { type: "application/json" }), "subsurf-findings.json");
  form.set("minimum_severity", "Info");
  form.set("group_by", "component_name");
  form.set("apply_tags_to_findings", "true");
  form.set("deduplication_execution_mode", "sync");
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  return form;
}

async function importRuns(assets, people) {
  const tests = {};
  for (const asset of ASSETS) {
    const product = assets[asset.key];
    const existing = await findOne(`/findings/?test__engagement__product=${product.id}&limit=1`);
    if (existing) {
      console.log(`  ${product.name}: already has findings, skipping the import (use --reset to start over)`);
      tests[asset.key] = existing.test;
      continue;
    }
    const first = await api("/import-scan/", {
      method: "POST",
      body: reportForm(genericReport(asset.key, 1), {
        product_name: product.name,
        engagement_name: ENGAGEMENT,
        test_title: TEST_TITLE,
        scan_date: RUN_1,
        lead: people[asset.team_manager],
        auto_create_context: true,
        close_old_findings: false,
        tags: "subsurf",
      }),
    });
    const second = await api("/reimport-scan/", {
      method: "POST",
      body: reportForm(genericReport(asset.key, 2), {
        test: first.test_id,
        scan_date: RUN_2,
        close_old_findings: true,
        do_not_reactivate: true,
      }),
    });
    tests[asset.key] = first.test_id;
    const stats = second.statistics?.delta ?? {};
    const count = (bucket) => stats[bucket]?.total?.total ?? 0;
    console.log(
      `  ${product.name}: test #${first.test_id}, run 2 delta: +${count("created")} new, ${count("closed")} closed, ${count("untouched")} unchanged`,
    );
  }
  return tests;
}

const findingKey = (f) => `${f.host}:${f.port}:${f.id}`;

async function applyTriage(tests, people) {
  for (const [id, decision] of Object.entries(TRIAGE)) {
    const seeded = FINDINGS.find((f) => findingKey(f) === id);
    if (!seeded) throw new Error(`TRIAGE names an unknown finding: ${id}`);
    const uid = `subsurf:${id}`;
    const finding = await findOne(
      `/findings/?test=${tests[seeded.asset]}&unique_id_from_tool=${encodeURIComponent(uid)}`,
    );
    if (!finding) {
      console.log(`  ${id}: not found, skipped`);
      continue;
    }
    const patch = {};
    if (decision.verified) patch.verified = true;
    if (decision.under_review) patch.under_review = true;
    if (decision.reviewers) patch.reviewers = decision.reviewers.map((u) => people[u]);
    if (decision.planned_remediation_date) patch.planned_remediation_date = decision.planned_remediation_date;
    if (decision.falsePositive) Object.assign(patch, { false_p: true, active: false, verified: false });
    if (decision.outOfScope) Object.assign(patch, { out_of_scope: true, active: false, verified: false });
    if (Object.keys(patch).length > 0) await api(`/findings/${finding.id}/`, { method: "PATCH", body: patch });

    const hasNote = (entry) => finding.notes.some((n) => n.entry === entry);
    if (decision.note && !hasNote(decision.note)) {
      await api(`/findings/${finding.id}/notes/`, { method: "POST", body: { entry: decision.note } });
    }

    // DefectDojo sets mitigated_by to the caller and mitigated to now; it refuses or ignores both.
    if (decision.close && finding.active) {
      await api(`/findings/${finding.id}/close/`, { method: "POST", body: { is_mitigated: true, note: decision.close } });
    }

    if (decision.riskAccepted && !finding.risk_accepted) {
      const ra = decision.riskAccepted;
      await api("/risk_acceptance/", {
        method: "POST",
        body: {
          name: ra.name,
          recommendation: "A",
          recommendation_details: "Compensating control: source-IP allow list on the edge firewall.",
          decision: "A",
          decision_details: ra.decision_details,
          accepted_by: "Tomasz Zieliński (CISO)",
          expiration_date: ra.expiration_date,
          reactivate_expired: true,
          owner: people[ra.owner],
          accepted_findings: [finding.id],
        },
      });
    }
    console.log(`  ${id}: ${Object.keys(decision).join(", ")}`);
  }
}

async function main() {
  const profile = await api("/user_profile/");
  console.log(`Token OK, authenticated as '${profile.user.username}' at ${DD_URL}`);
  if (RESET) await resetDemo();

  const people = await ensurePeople();
  const sla = await ensureSla();
  const assets = await ensureAssets(people, sla);

  console.log(`Importing run 1 (${RUN_1}) and reimporting run 2 (${RUN_2}):`);
  const tests = await importRuns(assets, people);

  console.log("Triage:");
  await applyTriage(tests, people);

  const total = await api(`/findings/?test__engagement__product__tags=subsurf&limit=1`);
  console.log(`Done. ${total.count} SubSurf findings. Open ${DD_URL}/product`);
}

main().catch((error) => {
  console.error(`Demo seed failed: ${error.message}`);
  process.exitCode = 1;
});
