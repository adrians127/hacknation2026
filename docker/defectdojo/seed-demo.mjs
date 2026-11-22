#!/usr/bin/env node
/**
 * Fills the local DefectDojo with fictional demo data: people, organizations, assets with
 * owners and an SLA, two scan runs of SubSurf findings (import + reimport) and triage
 * decisions (verified, false positive, out of scope, risk accepted, mitigated, notes,
 * reviewers). Findings go through POST /import-scan/ and /reimport-scan/ as
 * `Generic Findings Import`, the same path the backend export will use.
 *
 * Addresses are RFC 5737 documentation ranges, domains are `.example`, people and the
 * university are made up. See docker/README.md#demo-data.
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
  { name: "Demo University · Core Infrastructure", description: "Campus DMZ and core network of the fictional Demo University (SubSurf demo data).", critical_product: true },
  { name: "Demo University · Research Networks", description: "Faculty and research lab networks (SubSurf demo data)." },
  { name: "Demo University · Public Web", description: "Public websites under uni.example (SubSurf demo data).", key_product: true },
];

const ASSETS = [
  {
    key: "dmz",
    organization: 0,
    name: "Campus DMZ 192.0.2.0/24",
    description: "Internet-facing servers in the campus DMZ. Scanned daily by SubSurf.",
    business_criticality: "high",
    internet_accessible: true,
    product_manager: "tomasz.zielinski",
    technical_contact: "piotr.kowalski",
    team_manager: "anna.nowak",
    tags: ["subsurf", "dmz", "internet-facing"],
  },
  {
    key: "research",
    organization: 1,
    name: "Research Lab Network 198.51.100.0/24",
    description: "Lab servers and workstations reachable from the campus network.",
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
    name: "Public Websites *.uni.example",
    description: "University websites, intranet and staging environments (203.0.113.0/24).",
    business_criticality: "high",
    internet_accessible: true,
    product_manager: "tomasz.zielinski",
    technical_contact: "marta.wisniewska",
    team_manager: "anna.nowak",
    tags: ["subsurf", "web", "cms"],
  },
];

const KEV = { known_exploited: true, tags: ["kev"] };

// `runs` marks the scan runs that report the finding: run 2 drops what got fixed and adds new ones.
const FINDINGS = [
  // Campus DMZ
  {
    asset: "dmz", runs: [1, 2], host: "192.0.2.10", port: 443, url: "https://192.0.2.10:443",
    id: "apache-cve-2021-41773",
    title: "Apache httpd 2.4.49 path traversal (CVE-2021-41773)",
    severity: "High", cvssv3: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N", cvssv3_score: 7.5,
    vulnerability_ids: ["CVE-2021-41773"], cwe: 22, epss_score: 0.944, epss_percentile: 0.999, ...KEV, kev_date: "2021-11-03",
    component_name: "apache:http_server", component_version: "2.4.49", fix_available: true, fix_version: "2.4.51",
    detail: "Server banner reports Apache/2.4.49. Version-based match against NVD; not verified by exploitation.",
    mitigation: "Upgrade Apache httpd to 2.4.51 or later.",
    references: "https://nvd.nist.gov/vuln/detail/CVE-2021-41773\nhttps://httpd.apache.org/security/vulnerabilities_24.html",
    extraTags: ["internet-facing", "web-server"],
  },
  {
    asset: "dmz", runs: [1, 2], host: "192.0.2.10", port: 443, url: "https://192.0.2.10:443",
    id: "apache-cve-2021-42013",
    title: "Apache httpd 2.4.49 path traversal and RCE (CVE-2021-42013)",
    severity: "Critical", cvssv3: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", cvssv3_score: 9.8,
    vulnerability_ids: ["CVE-2021-42013"], cwe: 22, epss_score: 0.943, epss_percentile: 0.999, ...KEV, kev_date: "2021-11-03",
    component_name: "apache:http_server", component_version: "2.4.49", fix_available: true, fix_version: "2.4.51",
    detail: "Same host and banner as CVE-2021-41773; the fix in 2.4.50 was incomplete.",
    mitigation: "Upgrade Apache httpd to 2.4.51 or later.",
    references: "https://nvd.nist.gov/vuln/detail/CVE-2021-42013",
    extraTags: ["internet-facing", "web-server"],
  },
  {
    asset: "dmz", runs: [1, 2], host: "192.0.2.15", port: 22, url: "ssh://192.0.2.15:22",
    id: "openssh-cve-2024-6387",
    title: "OpenSSH 8.9p1 signal handler race (regreSSHion, CVE-2024-6387)",
    severity: "High", cvssv3: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H", cvssv3_score: 8.1,
    vulnerability_ids: ["CVE-2024-6387"], cwe: 364, epss_score: 0.61, epss_percentile: 0.98,
    component_name: "openbsd:openssh", component_version: "8.9p1", fix_available: true, fix_version: "9.8p1",
    detail: "SSH banner: SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.1. Distribution backports may already fix it; check the package changelog.",
    mitigation: "Upgrade OpenSSH to 9.8p1 or the patched distribution package; set LoginGraceTime 0 as a stopgap.",
    references: "https://nvd.nist.gov/vuln/detail/CVE-2024-6387",
    extraTags: ["internet-facing", "ssh"],
  },
  {
    asset: "dmz", runs: [1, 2], host: "192.0.2.20", port: 3389, url: "rdp://192.0.2.20:3389",
    id: "rdp-exposed",
    title: "Remote Desktop (RDP) reachable from the internet",
    severity: "Medium", cwe: 668,
    detail: "TCP 3389 answers with an RDP negotiation response. No login was attempted.",
    mitigation: "Move RDP behind the VPN or a bastion host; restrict the source addresses.",
    extraTags: ["internet-facing", "exposure", "remote-access"],
  },
  {
    asset: "dmz", runs: [1, 2], host: "192.0.2.25", port: 21, url: "ftp://192.0.2.25:21",
    id: "ftp-cleartext",
    title: "FTP service with cleartext authentication",
    severity: "Low", cwe: 319,
    detail: "Banner: 220 ProFTPD Server (Demo University). AUTH TLS is not offered.",
    mitigation: "Replace FTP with SFTP or require FTPS.",
    extraTags: ["exposure", "cleartext"],
  },
  {
    asset: "dmz", runs: [1], host: "192.0.2.30", port: 443, url: "https://192.0.2.30:443",
    id: "tls10-enabled",
    title: "TLS 1.0 still enabled",
    severity: "Low", cwe: 327,
    detail: "The server accepts a TLS 1.0 handshake.",
    mitigation: "Disable TLS 1.0 and 1.1; allow TLS 1.2+ only.",
    extraTags: ["tls"],
  },
  {
    asset: "dmz", runs: [1, 2], host: "192.0.2.30", port: 443, url: "https://192.0.2.30:443",
    id: "tls-cert-expired",
    title: "TLS certificate expired",
    severity: "Medium", cwe: 298,
    detail: "Certificate for vpn.uni.example expired on 2026-10-31 (issuer: Demo University CA).",
    mitigation: "Renew the certificate and enable automated renewal.",
    extraTags: ["tls", "certificate"],
  },
  {
    asset: "dmz", runs: [1, 2], host: "192.0.2.40", port: 9200, url: "http://192.0.2.40:9200",
    id: "elasticsearch-exposed",
    title: "Elasticsearch HTTP API reachable from the internet",
    severity: "High", cwe: 668,
    component_name: "elastic:elasticsearch", component_version: "7.10.2",
    detail: "GET / returns the cluster banner (version 7.10.2). No data was read.",
    mitigation: "Bind Elasticsearch to internal interfaces and enable authentication.",
    extraTags: ["internet-facing", "exposure", "database"],
  },
  {
    asset: "dmz", runs: [1], host: "192.0.2.50", port: 6379, url: "redis://192.0.2.50:6379",
    id: "redis-exposed",
    title: "Redis reachable from the internet",
    severity: "High", cwe: 668,
    component_name: "redis:redis", component_version: "6.0.9",
    detail: "TCP 6379 answers with a Redis protocol error banner. No commands were sent.",
    mitigation: "Firewall the port and enable protected-mode with a password.",
    extraTags: ["internet-facing", "exposure", "database"],
  },
  {
    asset: "dmz", runs: [2], host: "192.0.2.60", port: 8080, url: "http://192.0.2.60:8080",
    id: "jenkins-cve-2024-23897",
    title: "Jenkins 2.440 arbitrary file read (CVE-2024-23897)",
    severity: "Critical", cvssv3: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", cvssv3_score: 9.8,
    vulnerability_ids: ["CVE-2024-23897"], cwe: 22, epss_score: 0.97, epss_percentile: 0.999, ...KEV, kev_date: "2024-08-19",
    component_name: "jenkins:jenkins", component_version: "2.440", fix_available: true, fix_version: "2.442",
    detail: "New in this scan. X-Jenkins header reports 2.440. Version-based match; not verified by exploitation.",
    mitigation: "Upgrade Jenkins to 2.442 (or LTS 2.426.3) and take it off the internet.",
    references: "https://nvd.nist.gov/vuln/detail/CVE-2024-23897",
    extraTags: ["internet-facing", "ci-cd", "new"],
  },

  // Research networks
  {
    asset: "research", runs: [1, 2], host: "198.51.100.12", port: 8009, url: "ajp13://198.51.100.12:8009",
    id: "tomcat-ghostcat",
    title: "Apache Tomcat 9.0.30 AJP file read (Ghostcat, CVE-2020-1938)",
    severity: "Critical", cvssv3: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", cvssv3_score: 9.8,
    vulnerability_ids: ["CVE-2020-1938"], cwe: 269, epss_score: 0.944, epss_percentile: 0.999, ...KEV, kev_date: "2022-03-03",
    component_name: "apache:tomcat", component_version: "9.0.30", fix_available: true, fix_version: "9.0.31",
    detail: "AJP connector open on 8009; the HTTP connector on 8080 reports Apache Tomcat/9.0.30.",
    mitigation: "Upgrade Tomcat to 9.0.31+ and disable the AJP connector if unused.",
    references: "https://nvd.nist.gov/vuln/detail/CVE-2020-1938",
    extraTags: ["app-server"],
  },
  {
    asset: "research", runs: [1, 2], host: "198.51.100.20", port: 5432, url: "postgresql://198.51.100.20:5432",
    id: "postgres-exposed",
    title: "PostgreSQL reachable from the campus network",
    severity: "Medium", cwe: 668,
    detail: "TCP 5432 accepts connections and requests authentication. No login was attempted.",
    mitigation: "Restrict pg_hba.conf and the firewall to the lab application servers.",
    extraTags: ["exposure", "database"],
  },
  {
    asset: "research", runs: [1, 2], host: "198.51.100.33", port: 27017, url: "mongodb://198.51.100.33:27017",
    id: "mongodb-exposed",
    title: "MongoDB reachable from the campus network",
    severity: "Medium", cwe: 668,
    component_name: "mongodb:mongodb", component_version: "4.4.6",
    detail: "Wire protocol handshake reports MongoDB 4.4.6. No database was listed.",
    mitigation: "Enable authentication and bind to localhost or the lab VLAN only.",
    extraTags: ["exposure", "database"],
  },
  {
    asset: "research", runs: [1, 2], host: "198.51.100.40", port: 3306, url: "mysql://198.51.100.40:3306",
    id: "mysql-eol",
    title: "MySQL 5.5 is end of life",
    severity: "Medium", cwe: 1104,
    component_name: "oracle:mysql", component_version: "5.5.62",
    detail: "Handshake reports 5.5.62. MySQL 5.5 has had no security updates since 2018.",
    mitigation: "Migrate to a supported MySQL or MariaDB release.",
    extraTags: ["eol", "database"],
  },
  {
    asset: "research", runs: [1, 2], host: "198.51.100.45", port: 5900, url: "vnc://198.51.100.45:5900",
    id: "vnc-exposed",
    title: "VNC server reachable from the campus network",
    severity: "High", cwe: 668,
    detail: "RFB 003.008 handshake on 5900. No authentication was attempted.",
    mitigation: "Tunnel VNC over SSH or the VPN and close the port.",
    extraTags: ["exposure", "remote-access"],
  },

  // Public web
  {
    asset: "web", runs: [1, 2], host: "203.0.113.10", port: 443, url: "https://www.uni.example:443",
    id: "wordpress-detected",
    title: "WordPress 5.8.1 detected",
    severity: "Info",
    component_name: "wordpress:wordpress", component_version: "5.8.1",
    detail: "Detected from the generator meta tag and /wp-includes/ asset paths on www.uni.example.",
    mitigation: "Keep WordPress core and plugins up to date; hide the version string.",
    extraTags: ["cms", "fingerprint"],
  },
  {
    asset: "web", runs: [1, 2], host: "203.0.113.10", port: 443, url: "https://www.uni.example:443/wp-admin/",
    id: "wp-admin-exposed",
    title: "WordPress admin panel exposed",
    severity: "Info",
    detail: "HTTP 302 from /wp-admin/ to the login page on www.uni.example. Passive signature; no login was attempted.",
    mitigation: "Restrict /wp-admin/ to the staff network or add SSO in front of it.",
    extraTags: ["cms", "admin-panel"],
  },
  {
    asset: "web", runs: [1, 2], host: "203.0.113.10", port: 443, url: "https://www.uni.example:443",
    id: "hsts-missing",
    title: "Strict-Transport-Security header missing",
    severity: "Low", cwe: 319,
    detail: "HTTPS responses from www.uni.example have no Strict-Transport-Security header.",
    mitigation: "Send Strict-Transport-Security: max-age=31536000; includeSubDomains.",
    extraTags: ["headers"],
  },
  {
    asset: "web", runs: [1, 2], host: "203.0.113.10", port: 443, url: "https://www.uni.example:443",
    id: "cookie-no-secure",
    title: "Session cookie without Secure flag",
    severity: "Low", cwe: 614,
    detail: "Set-Cookie: PHPSESSID on www.uni.example lacks the Secure and HttpOnly attributes.",
    mitigation: "Set session.cookie_secure and session.cookie_httponly in php.ini.",
    extraTags: ["headers", "cookies"],
  },
  {
    asset: "web", runs: [1, 2], host: "203.0.113.10", port: 443, url: "https://www.uni.example:443",
    id: "php-eol",
    title: "PHP 7.4 is end of life",
    severity: "Medium", cwe: 1104,
    component_name: "php:php", component_version: "7.4.3",
    detail: "X-Powered-By: PHP/7.4.3 on www.uni.example. PHP 7.4 has had no security updates since November 2022.",
    mitigation: "Upgrade to a supported PHP release and remove the X-Powered-By header.",
    extraTags: ["eol", "headers"],
  },
  {
    asset: "web", runs: [1, 2], host: "203.0.113.20", port: 443, url: "https://intranet.uni.example:443",
    id: "confluence-cve-2022-26134",
    title: "Atlassian Confluence 7.13.0 OGNL injection (CVE-2022-26134)",
    severity: "Critical", cvssv3: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", cvssv3_score: 9.8,
    vulnerability_ids: ["CVE-2022-26134"], cwe: 917, epss_score: 0.944, epss_percentile: 0.999, ...KEV, kev_date: "2022-06-02",
    component_name: "atlassian:confluence_server", component_version: "7.13.0", fix_available: true, fix_version: "7.13.7",
    detail: "Footer and the ajs-version-number meta tag on intranet.uni.example report 7.13.0. Version-based match.",
    mitigation: "Upgrade Confluence to 7.13.7 or a later supported release.",
    references: "https://nvd.nist.gov/vuln/detail/CVE-2022-26134\nhttps://confluence.atlassian.com/doc/confluence-security-advisory-2022-06-02-1130377146.html",
    extraTags: ["internet-facing", "wiki"],
  },
  {
    asset: "web", runs: [1, 2], host: "203.0.113.30", port: 443, url: "https://staging.uni.example:443/uploads/",
    id: "directory-listing",
    title: "Directory listing enabled",
    severity: "Low", cwe: 548,
    detail: "GET /uploads/ on staging.uni.example returns an auto-generated index page.",
    mitigation: "Disable autoindex and keep staging behind authentication.",
    extraTags: ["staging", "misconfiguration"],
  },
  {
    asset: "web", runs: [1, 2], host: "203.0.113.30", port: 443, url: "https://staging.uni.example:443",
    id: "nginx-version-disclosed",
    title: "Server header discloses nginx version",
    severity: "Info",
    component_name: "nginx:nginx", component_version: "1.18.0",
    detail: "Server: nginx/1.18.0 (Ubuntu) on staging.uni.example.",
    mitigation: "Set server_tokens off.",
    extraTags: ["headers", "fingerprint"],
  },
];

// Triage decisions applied after both runs, by finding id.
const TRIAGE = {
  "apache-cve-2021-42013": {
    verified: true, reviewers: ["anna.nowak", "piotr.kowalski"], planned_remediation_date: "2026-11-28",
    note: "Confirmed with the web team: the DMZ reverse proxy still runs the 2.4.49 package. Upgrade scheduled for the Thursday maintenance window.",
  },
  "apache-cve-2021-41773": { verified: true, reviewers: ["anna.nowak", "piotr.kowalski"], planned_remediation_date: "2026-11-28" },
  "openssh-cve-2024-6387": {
    under_review: true, reviewers: ["piotr.kowalski"],
    note: "Ubuntu 22.04 package 1:8.9p1-3ubuntu0.10 contains the backported fix. Checking the installed package version before closing as a false positive.",
  },
  "tomcat-ghostcat": {
    verified: true, reviewers: ["ewa.lewandowska"], planned_remediation_date: "2026-11-25",
    note: "Legacy LIMS server. AJP disabled as a stopgap; the Tomcat upgrade needs the vendor's approval.",
  },
  "confluence-cve-2022-26134": {
    verified: true, reviewers: ["marta.wisniewska", "anna.nowak"], planned_remediation_date: "2026-11-23",
    note: "Critical and in CISA KEV. Intranet moved behind the VPN today; upgrade to 7.13.7 tonight.",
  },
  "postgres-exposed": {
    falsePositive: true,
    note: "198.51.100.20 is the lab's PostgreSQL honeypot (approved by the CISO). Exposure is intentional.",
  },
  "mongodb-exposed": {
    outOfScope: true,
    note: "Host belongs to a student project VLAN that is out of scope for this asset.",
  },
  "rdp-exposed": {
    riskAccepted: {
      name: "RDP on 192.0.2.20 until the VPN migration",
      decision_details: "The building automation vendor connects over RDP from two fixed addresses. Accepted until the VPN migration is finished.",
      expiration_date: "2026-12-31",
      owner: "tomasz.zielinski",
    },
  },
  "ftp-cleartext": {
    close: "FTP replaced by SFTP on 2026-11-21; port 21 now closed on the host firewall (closed manually before the next scan).",
  },
  "jenkins-cve-2024-23897": {
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
      email: `${person.username}@uni.example`,
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

async function findingIn(testId, id) {
  const f = FINDINGS.find((x) => x.id === id);
  const uid = `subsurf:${f.host}:${f.port}:${id}`;
  return findOne(`/findings/?test=${testId}&unique_id_from_tool=${encodeURIComponent(uid)}`);
}

async function applyTriage(tests, people) {
  for (const [id, decision] of Object.entries(TRIAGE)) {
    const asset = FINDINGS.find((f) => f.id === id).asset;
    const finding = await findingIn(tests[asset], id);
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
