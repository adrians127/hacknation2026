import type {
  SignatureCategory,
  SignatureConfidence,
  SignatureSeverity,
} from "@subsurf/contracts/signatures/detection.schema";
import type {
  SignatureCondition,
  SignatureDefinition,
  SignatureMatchOp,
  SignatureMatcher,
} from "@subsurf/contracts/signatures/signatures.schema";

/**
 * Signatures shipped with SubSurf. `syncBuiltInSignatures()` writes them by `key` at startup:
 * changing one here changes it everywhere, and users can only switch them on or off.
 * Technology signatures declare `low`: their confidence comes from how many kinds of evidence match.
 */
export interface BuiltInSignature {
  key: string;
  name: string;
  description: string;
  category: SignatureCategory;
  product: string | null;
  severity: SignatureSeverity | null;
  confidence: SignatureConfidence;
  definition: SignatureDefinition;
}

const m = (op: SignatureMatchOp, value: string): SignatureMatcher => ({ op, value });

const header = (name: SignatureMatcher, value?: SignatureMatcher, version?: string): SignatureCondition => ({
  target: "header",
  name,
  ...(value && { value }),
  ...(version && { version }),
});
const cookie = (name: SignatureMatcher): SignatureCondition => ({ target: "cookie", name });
const title = (value: SignatureMatcher, version?: string): SignatureCondition => ({
  target: "title",
  value,
  ...(version && { version }),
});
const body = (value: SignatureMatcher, version?: string): SignatureCondition => ({
  target: "body",
  value,
  ...(version && { version }),
});
const probe = (path: string, status: number[], extra: { title?: SignatureMatcher } = {}): SignatureCondition => ({
  target: "probe",
  path,
  status,
  ...extra,
});

const favicon = (...mmh3: number[]): SignatureCondition => ({ target: "favicon", mmh3 });
const banner = (value: SignatureMatcher, version?: string): SignatureCondition => ({
  target: "banner",
  value,
  ...(version && { version }),
});
const service = (value: SignatureMatcher): SignatureCondition => ({ target: "service", field: "product", value });

const any = (...conditions: SignatureCondition[]): SignatureDefinition => ({ match: "any", conditions });

// Favicon hashes measured on the images of docker/lab (Shodan's mmh3 of the base64 icon), 2026-11-22.
const PHPMYADMIN_FAVICON = -476231906;
const RABBITMQ_FAVICON = -1015107330;
const DVWA_FAVICON = -231109625;

/** A version-like token at the start of a header value (`2.426.1`). */
const LEADING_VERSION = String.raw`^\s*v?(\d[\w.+-]*)`;

function technology(
  key: string,
  product: string,
  category: SignatureCategory,
  description: string,
  definition: SignatureDefinition,
): BuiltInSignature {
  return { key, name: product, description, category, product, severity: null, confidence: "low", definition };
}

function finding(
  key: string,
  name: string,
  category: SignatureCategory,
  severity: SignatureSeverity,
  description: string,
  definition: SignatureDefinition,
): BuiltInSignature {
  return { key, name, description, category, product: null, severity, confidence: "low", definition };
}

const TECHNOLOGIES: BuiltInSignature[] = [
  technology("wordpress", "WordPress", "cms", "WordPress paths in the page, its cookies or its login page.", any(
    body(m("regex", String.raw`/wp-(content|includes)/`)),
    cookie(m("regex", "^(wordpress_|wp-settings)")),
    probe("/wp-login.php", [200]),
  )),
  technology("joomla", "Joomla!", "cms", "Joomla! scripts in the page.", any(
    body(m("regex", String.raw`/media/jui/|/media/system/js/core\.js`)),
  )),
  technology("drupal", "Drupal", "cms", "Drupal cache headers or settings in the page.", any(
    header(m("regex", "^x-drupal-(dynamic-)?cache$")),
    body(m("regex", "drupal-settings-json|/sites/default/files/")),
  )),
  technology("moodle", "Moodle", "cms", "Moodle session cookie or login page title.", any(
    cookie(m("prefix", "moodlesession")),
    title(m("regex", ": log in to the site$")),
  )),
  technology("nextcloud", "Nextcloud", "application", "Nextcloud session cookies or page title.", any(
    cookie(m("regex", "^(nc_session_id|oc_sessionpassphrase)$")),
    title(m("prefix", "nextcloud")),
  )),
  technology("roundcube", "Roundcube", "application", "Roundcube Webmail cookie or title.", any(
    cookie(m("equals", "roundcube_sessid")),
    title(m("contains", "roundcube webmail")),
  )),
  technology("jenkins", "Jenkins", "application", "X-Jenkins header (with the version) or a Jenkins page title.", any(
    header(m("equals", "x-jenkins"), undefined, LEADING_VERSION),
    title(m("contains", "[jenkins]")),
  )),
  technology("gitlab", "GitLab", "application", "GitLab header, session cookie or page title.", any(
    header(m("equals", "x-gitlab-meta")),
    cookie(m("equals", "_gitlab_session")),
    title(m("contains", "gitlab")),
  )),
  technology("kibana", "Kibana", "application", "Kibana's kbn-name and kbn-version headers.", any(
    header(m("equals", "kbn-name")),
    header(m("equals", "kbn-version"), undefined, LEADING_VERSION),
  )),
  technology("elasticsearch", "Elasticsearch", "service", "The X-Elastic-Product header.", any(
    header(m("equals", "x-elastic-product")),
  )),
  technology("php", "PHP", "language", "The default PHP session cookie.", any(cookie(m("equals", "phpsessid")))),
  technology("java-servlet", "Java Servlet", "framework", "A Java servlet session cookie (JSESSIONID).", any(
    cookie(m("prefix", "jsessionid")),
  )),
  technology("aspnet", "ASP.NET", "framework", "The ASP.NET session cookie.", any(
    cookie(m("equals", "asp.net_sessionid")),
  )),
  technology("laravel", "Laravel", "framework", "The Laravel session cookie.", any(cookie(m("equals", "laravel_session")))),
  technology("django", "Django", "framework", "Django's CSRF cookie.", any(cookie(m("equals", "csrftoken")))),
  technology("zabbix", "Zabbix", "application", "Zabbix session cookie or page title.", any(
    cookie(m("equals", "zbx_session")),
    title(m("prefix", "zabbix")),
  )),
  technology("grafana", "Grafana", "application", "Grafana session cookie or page title.", any(
    cookie(m("equals", "grafana_session")),
    title(m("equals", "grafana")),
  )),
  technology("phpmyadmin", "phpMyAdmin", "application", "phpMyAdmin's page title, cookies or favicon.", any(
    title(m("contains", "phpmyadmin")),
    cookie(m("regex", "^(phpmyadmin|pma_lang)$")),
    favicon(PHPMYADMIN_FAVICON),
  )),
  technology("swagger-ui", "Swagger UI", "application", "A Swagger UI page.", any(title(m("equals", "swagger ui")))),
  technology("synology-dsm", "Synology DSM", "device", "A Synology DiskStation login page.", any(
    title(m("contains", "synology diskstation")),
  )),
  technology("dell-idrac", "Dell iDRAC", "device", "A Dell iDRAC page title (with its generation).", any(
    title(m("contains", "idrac"), String.raw`idrac\s?(\d+)`),
  )),
  technology("mikrotik-routeros", "MikroTik RouterOS", "device", "A MikroTik RouterOS page title.", any(
    title(m("contains", "routeros"), String.raw`routeros v?(\d[\d.]*)`),
  )),
  technology("apache-tomcat", "Apache Tomcat", "application", "A Tomcat page title or its manager asking for a login.", any(
    title(m("prefix", "apache tomcat"), String.raw`tomcat/(\d[\d.]*)`),
    probe("/manager/html", [401]),
  )),
  technology("microsoft-iis", "Microsoft IIS", "web-server", "The IIS welcome page.", any(
    title(m("equals", "iis windows server")),
  )),
  technology("nginx-welcome", "nginx", "web-server", "The nginx welcome page.", any(
    title(m("regex", "^welcome to nginx!?$")),
  )),
  technology("gitea", "Gitea", "application", "Gitea's cookie, page title or footer.", any(
    cookie(m("equals", "i_like_gitea")),
    title(m("contains", "gitea: git with a cup of tea")),
    body(m("contains", "powered by gitea")),
  )),
  technology("adminer", "Adminer", "application", "Adminer's login page or cookies.", any(
    title(m("contains", "adminer")),
    cookie(m("prefix", "adminer_")),
  )),
  technology("rabbitmq", "RabbitMQ", "service", "The RabbitMQ management console.", any(
    title(m("equals", "rabbitmq management")),
    favicon(RABBITMQ_FAVICON),
  )),
  technology("traefik", "Traefik", "web-server", "The Traefik dashboard (/ redirects to /dashboard/).", any(
    title(m("equals", "traefik")),
    probe("/dashboard/", [200], { title: m("equals", "traefik") }),
  )),
  technology("httpbin", "httpbin", "application", "httpbin, an HTTP testing service.", any(
    title(m("equals", "httpbin.org")),
  )),
  technology("vsftpd", "vsftpd", "service", "The vsftpd FTP server's banner (with the version) or nmap's product.", any(
    banner(m("contains", "vsftpd"), String.raw`vsftpd ([\d.]+)`),
    service(m("contains", "vsftpd")),
  )),
  technology("apache-httpd", "Apache httpd", "web-server", "The Apache default page or its status page.", any(
    title(m("regex", "apache2 (ubuntu|debian) default page")),
    probe("/server-status", [200], { title: m("equals", "Apache Status") }),
  )),
];

const ADMIN_PANELS: BuiltInSignature[] = [
  finding("admin-panel-title", "Administration panel", "admin-panel", "medium",
    "A page title of a known administration panel or console.", any(
      title(m("regex", [
        "phpmyadmin",
        String.raw`\[jenkins\]`,
        "^grafana$",
        "^zabbix",
        "gitlab",
        "^elastic$|kibana",
        "routeros|mikrotik",
        String.raw`idrac|ilo\b|integrated lights-out`,
        "synology diskstation",
        "webmin|portainer|pfsense|proxmox|cpanel|plesk",
        "adminer|rabbitmq management|^traefik$",
        String.raw`\badmin(istration|istrator)?\b|panel administracyjny`,
      ].join("|"))),
    )),
  finding("admin-panel-realm", "Administration login prompt", "admin-panel", "medium",
    "An HTTP authentication realm of an administration interface (Cisco level_15, admin).", any(
      header(m("equals", "www-authenticate"), m("regex", "level_15|admin")),
    )),
  finding("admin-panel-path", "Administration path answers", "admin-panel", "medium",
    "A well-known administration path answers (only fetched, never logged into).", any(
      probe("/manager/html", [200, 401, 403]),
      probe("/wp-login.php", [200]),
      probe("/administrator/", [200]),
      probe("/phpmyadmin/", [200, 401]),
      probe("/dashboard/", [200], { title: m("equals", "traefik") }),
    )),
  finding("admin-path", "/admin answers", "admin-panel", "info",
    "The /admin/ path answers or asks for a login.", any(probe("/admin/", [200, 401]))),
];

const STAGING: BuiltInSignature[] = [
  finding("server-status-public", "Public server-status page", "staging", "high",
    "Apache's /server-status is readable from outside.", any(probe("/server-status", [200]))),
  finding("debug-page", "Debug or error page", "staging", "high",
    "A framework debug page, stack trace or phpinfo() output.", any(
      title(m("regex", String.raw`page not found at /|disallowedhost|traceback|stack trace|whoops!|phpinfo\(\)`)),
    )),
  finding("api-docs", "API documentation", "staging", "high",
    "Interactive API documentation is public.", any(
      title(m("regex", "swagger ui|api documentation|graphiql")),
    )),
  finding("staging-title", "Staging environment", "staging", "high",
    "The page title says it is a staging environment.", any(
      title(m("regex", String.raw`\[staging\]|\bstaging\b`)),
    )),
  finding("environment-header", "Non-production environment header", "staging", "high",
    "An X-Environment header naming a staging, development or test environment.", any(
      header(m("equals", "x-environment"), m("regex", "stag|dev|test|uat|qa")),
    )),
  finding("debug-header", "Debug header", "staging", "high",
    "A response header of a debugging toolbar or debug mode (X-Debug-*).", any(
      header(m("prefix", "x-debug")),
    )),
  finding("version-endpoint", "/version answers", "other", "info",
    "The /version path answers: it often names the software and its version.", any(
      probe("/version", [200]),
    )),
];

const TEST_APPLICATIONS: BuiltInSignature[] = [
  {
    key: "dvwa",
    name: "DVWA (deliberately vulnerable)",
    description: "Damn Vulnerable Web Application, a training target that must never be reachable in production.",
    category: "staging",
    product: "DVWA",
    severity: "high",
    confidence: "low",
    definition: any(
      probe("/login.php", [200], { title: m("contains", "damn vulnerable web application") }),
      cookie(m("equals", "security")),
      favicon(DVWA_FAVICON),
    ),
  },
];

const DEFAULT_PAGES: BuiltInSignature[] = [
  finding("default-page", "Default web server page", "default-page", "low",
    "A web server's default or test page: nothing is deployed here yet.", any(
      title(m("regex", [
        "^welcome to nginx!?$",
        "apache2 (ubuntu|debian) default page",
        "^iis windows server$",
        "test page for the (apache|nginx)",
        "^it works!?$",
      ].join("|"))),
    )),
];

export const BUILT_IN_SIGNATURES: readonly BuiltInSignature[] = [
  ...TECHNOLOGIES,
  ...ADMIN_PANELS,
  ...STAGING,
  ...TEST_APPLICATIONS,
  ...DEFAULT_PAGES,
];
