import type { OpenPort } from "@subsurf/contracts/workers/worker-result.schema";

import { page, type CertSpec, type SiteSpec } from "~backend/demo/http";
import {
  deviceCert,
  expiredCert,
  openPort,
  publicCert,
  SSH_FLAVOURS,
  sshPort,
  webPort,
  type HostContext,
  type ServiceSpec,
} from "~backend/demo/ports";
import { byVariant, fakeSha256 } from "~backend/demo/random";

/** One kind of machine: its TTL (OS family) and the open ports it shows in a run. */
export interface Profile {
  ttl: number;
  ports(ctx: HostContext): OpenPort[];
}

const LINUX = 64;
const WINDOWS = 128;
const NETWORK = 255;

const ssh = (ctx: HostContext) => sshPort(ctx, byVariant(ctx.variant, SSH_FLAVOURS));

const nginx = (version: string | null): ServiceSpec => ({
  name: "http",
  product: "nginx",
  version,
  cpe: version ? [`cpe:/a:nginx:nginx:${version}`] : ["cpe:/a:nginx:nginx"],
});
const apache = (version: string, extraInfo: string): ServiceSpec => ({
  name: "http",
  product: "Apache httpd",
  version,
  extraInfo,
  cpe: [`cpe:/a:apache:http_server:${version}`],
});
const tls = (service: ServiceSpec): ServiceSpec => ({ ...service, name: "https" });

/** A maintenance page replaces the site in the second run (`maintenance` change). */
function maintained(ctx: HostContext, site: SiteSpec): SiteSpec {
  if (!ctx.changed("maintenance")) return site;
  return {
    ...site,
    statusCode: 503,
    path: undefined,
    title: "Przerwa techniczna",
    html: page("Przerwa techniczna", "<h1>Trwają prace serwisowe. Wracamy wkrótce.</h1>"),
    cookies: [],
    probes: {},
  };
}

/** SSH, plain HTTP redirecting to HTTPS, and the HTTPS site: the common shape of a web server. */
function webServer(
  ctx: HostContext,
  options: {
    server: ServiceSpec;
    site: (host: string) => SiteSpec;
    /** What the bare IP answers when the host serves named sites. */
    bareIp?: (host: string) => SiteSpec;
    cert?: CertSpec;
    withSsh?: boolean;
  },
): OpenPort[] {
  const siteFor = (host: string, vhost: string | null) =>
    maintained(
      ctx,
      vhost === null && options.bareIp && ctx.domains.length > 0
        ? options.bareIp(host)
        : options.site(host),
    );
  const cert = options.cert ?? publicCert(ctx);
  return [
    ...(options.withSsh === false ? [] : [ssh(ctx)]),
    webPort(ctx, { port: 80, scheme: "http", service: options.server, site: siteFor, upgradesToHttps: true }),
    webPort(ctx, { port: 443, scheme: "https", service: tls(options.server), site: siteFor, cert: () => cert }),
  ];
}

const nginxWelcome = (): SiteSpec => ({
  title: "Welcome to nginx!",
  headers: [["server", "nginx"]],
  html: page("Welcome to nginx!", "<h1>Welcome to nginx!</h1>"),
});

const mysqlPort = (ctx: HostContext, version: string) =>
  openPort(ctx, 3306, {
    name: "mysql",
    product: "MySQL",
    version,
    cpe: [`cpe:/a:mysql:mysql:${version}`],
  });

// --- Core network --------------------------------------------------------------------------

const router: Profile = {
  ttl: NETWORK,
  ports: (ctx) => [
    ...(ctx.changed("close-port")
      ? []
      : [openPort(ctx, 21, { name: "ftp", product: "MikroTik router ftpd", version: "6.49.10" }, {
          banner: "220 gw FTP server (MikroTik 6.49.10) ready",
        })]),
    openPort(ctx, 22, { name: "ssh", product: "MikroTik RouterOS sshd", extraInfo: "protocol 2.0" }, {
      banner: "SSH-2.0-ROSSSH",
    }),
    openPort(ctx, 23, { name: "telnet", product: "MikroTik router telnetd" }, {
      banner: "MikroTik v6.49.10 (long-term)\r\nLogin:",
    }),
    webPort(ctx, {
      port: 80,
      scheme: "http",
      service: { name: "http", product: "MikroTik router config httpd" },
      bareIpOnly: true,
      site: () => ({
        title: "RouterOS router configuration page",
        html: page("RouterOS router configuration page", "<h1>RouterOS v6.49.10</h1>"),
        favicon: "mikrotik",
        probes: { "/login": { statusCode: 200, title: "RouterOS router configuration page" } },
      }),
    }),
  ],
};

const networkSwitch: Profile = {
  ttl: NETWORK,
  ports: (ctx) => [
    openPort(ctx, 22, { name: "ssh", product: "Cisco SSH", version: "1.25", extraInfo: "protocol 2.0" }, {
      banner: "SSH-2.0-Cisco-1.25",
    }),
    openPort(ctx, 23, { name: "telnet", product: "Cisco router telnetd" }, {
      banner: "\r\nUser Access Verification\r\n\r\nUsername:",
    }),
    webPort(ctx, {
      port: 80,
      scheme: "http",
      service: { name: "http", product: "Cisco IOS http config", cpe: ["cpe:/o:cisco:ios"] },
      bareIpOnly: true,
      site: () => ({
        statusCode: 401,
        title: null,
        headers: [["server", "cisco-IOS"], ["www-authenticate", 'Basic realm="level_15_access"']],
        html: "",
      }),
    }),
  ],
};

const dns: Profile = {
  ttl: LINUX,
  ports: (ctx) => {
    const version = ctx.changed("upgrade") ? "9.18.30-0ubuntu0.22.04.2" : "9.18.28-0ubuntu0.22.04.1";
    return [
      ssh(ctx),
      openPort(ctx, 53, {
        name: "domain",
        product: "ISC BIND",
        version,
        cpe: [`cpe:/a:isc:bind:${version.split("-")[0]}`],
      }),
    ];
  },
};

const mail: Profile = {
  ttl: LINUX,
  ports: (ctx) => {
    const host = ctx.domains[0] ?? ctx.ip;
    const dovecot = { product: "Dovecot", cpe: ["cpe:/a:dovecot:dovecot"] };
    return [
      ssh(ctx),
      openPort(ctx, 25, { name: "smtp", product: "Postfix smtpd", cpe: ["cpe:/a:postfix:postfix"] }, {
        banner: `220 ${host} ESMTP Postfix (Ubuntu)`,
      }),
      openPort(ctx, 110, { name: "pop3", ...dovecot, extraInfo: "pop3d" }, { banner: "+OK Dovecot (Ubuntu) ready." }),
      openPort(ctx, 143, { name: "imap", ...dovecot, extraInfo: "imapd" }, {
        banner: "* OK [CAPABILITY IMAP4rev1 LITERAL+ STARTTLS AUTH=PLAIN] Dovecot (Ubuntu) ready.",
      }),
      openPort(ctx, 993, { name: "imaps", ...dovecot }),
      openPort(ctx, 995, { name: "pop3s", ...dovecot }),
      ...webServer(ctx, {
        withSsh: false,
        server: nginx("1.18.0"),
        site: () => ({
          title: "Roundcube Webmail :: Welcome to Roundcube Webmail",
          headers: [["server", "nginx/1.18.0 (Ubuntu)"], ["x-frame-options", "sameorigin"]],
          cookies: [{ name: "roundcube_sessid", secure: true, httpOnly: true }],
          html: page(
            "Roundcube Webmail :: Welcome to Roundcube Webmail",
            '<form name="login-form"></form><div id="footer">Roundcube Webmail 1.6.0</div>',
            '<meta name="generator" content="Roundcube">',
          ),
          favicon: "roundcube",
        }),
      }),
    ];
  },
};

// --- Web applications --------------------------------------------------------------------

const wordpress: Profile = {
  ttl: LINUX,
  ports: (ctx) => {
    const old = ctx.variant % 2 === 1;
    const upgraded = ctx.changed("upgrade");
    const wp = old ? "5.8.3" : upgraded ? "6.7.1" : "6.4.2";
    const nginxVersion = old ? "1.18.0" : upgraded ? "1.24.0" : "1.22.1";
    const php = old ? "7.4.33" : "8.2.20";
    const title = `${ctx.label} – Strona główna`;
    return [
      ...webServer(ctx, {
        server: nginx(nginxVersion),
        bareIp: nginxWelcome,
        site: (host) => ({
          title,
          headers: [
            ["server", `nginx/${nginxVersion}`],
            ["x-powered-by", `PHP/${php}`],
            ["link", `<https://${host}/wp-json/>; rel="https://api.w.org/"`],
          ],
          cookies: old ? [{ name: "PHPSESSID" }] : [],
          html: page(
            title,
            `<main>Aktualności</main><footer>© 2026 ${ctx.label} · Proudly powered by WordPress</footer>`,
            `<meta name="generator" content="WordPress ${wp}">` +
              `<link rel="stylesheet" href="/wp-content/themes/kampus/style.css?ver=${wp}">`,
          ),
          favicon: "wordpress",
          probes: {
            "/wp-login.php": { statusCode: 200, title: `Log In ‹ ${ctx.label} — WordPress` },
            "/admin/": { statusCode: 302, location: `https://${host}/wp-admin/` },
            "/login": { statusCode: 302, location: `https://${host}/wp-login.php` },
          },
        }),
        cert: publicCert(ctx, old ? "R11" : "GEANT TLS RSA 1"),
      }),
      ...(ctx.changed("open-port") ? [mysqlPort(ctx, "8.0.39")] : []),
    ];
  },
};

const stagingWordpress: Profile = {
  ttl: LINUX,
  ports: (ctx) => {
    const title = ctx.changed("retitle") ? `[STAGING] ${ctx.label} – nowa wersja` : `[STAGING] ${ctx.label}`;
    return webServer(ctx, {
      server: nginx("1.24.0"),
      site: () => ({
        title,
        headers: [
          ["server", "nginx/1.24.0"],
          ["x-powered-by", "PHP/8.3.8"],
          ["x-environment", "staging"],
          ["x-robots-tag", "noindex, nofollow"],
        ],
        cookies: [{ name: "PHPSESSID" }, { name: "wordpress_test_cookie", path: "/" }],
        html: page(
          title,
          '<div class="env-banner">STAGING – dane testowe</div><footer>Proudly powered by WordPress</footer>',
          '<meta name="generator" content="WordPress 6.7.1"><meta name="robots" content="noindex">',
        ),
        favicon: "wordpress",
        probes: {
          "/wp-login.php": { statusCode: 200, title: `Log In ‹ [STAGING] ${ctx.label} — WordPress` },
          "/admin/": { statusCode: 302, location: "/wp-admin/" },
        },
      }),
      cert: publicCert(ctx, "R11"),
    });
  },
};

const joomla: Profile = {
  ttl: LINUX,
  ports: (ctx) => {
    const old = ctx.variant % 2 === 1;
    const apacheVersion = old ? "2.4.29" : "2.4.52";
    const php = old ? "7.2.24" : "8.1.2";
    return webServer(ctx, {
      server: apache(apacheVersion, "(Ubuntu)"),
      cert: old ? expiredCert(ctx) : publicCert(ctx),
      site: () => ({
        title: ctx.label,
        headers: [["server", `Apache/${apacheVersion} (Ubuntu)`], ["x-powered-by", `PHP/${php}`]],
        // Joomla names its session cookie with a hash of the site.
        cookies: [{ name: fakeSha256(`joomla ${ctx.ip}`).slice(0, 32), httpOnly: !old, secure: !old }],
        html: page(
          ctx.label,
          `<footer>${ctx.label}</footer>`,
          `<meta name="generator" content="Joomla! - Open Source Content Management${old ? " - Version 3.9.28" : ""}">`,
        ),
        favicon: "joomla",
        probes: {
          "/admin/": { statusCode: 404 },
          "/login": { statusCode: 303, location: "/index.php/component/users/login" },
        },
      }),
    });
  },
};

const drupal: Profile = {
  ttl: LINUX,
  ports: (ctx) =>
    webServer(ctx, {
      server: apache("2.4.62", "(Debian)"),
      site: () => ({
        title: `Strona główna | ${ctx.label}`,
        headers: [
          ["server", "Apache/2.4.62 (Debian)"],
          ["x-generator", "Drupal 10 (https://www.drupal.org)"],
          ["x-drupal-cache", "HIT"],
          ["x-content-type-options", "nosniff"],
        ],
        html: page(
          `Strona główna | ${ctx.label}`,
          "",
          '<meta name="Generator" content="Drupal 10 (https://www.drupal.org)">',
        ),
        favicon: "drupal",
        probes: { "/login": { statusCode: 404 }, "/admin/": { statusCode: 403, title: "Access denied" } },
      }),
    }),
};

const moodle: Profile = {
  ttl: LINUX,
  ports: (ctx) => {
    const release = ctx.changed("upgrade") ? "4.4.3" : "4.1.9";
    return webServer(ctx, {
      server: apache("2.4.52", "(Ubuntu)"),
      site: () => ({
        path: "/login/index.php",
        redirectStatus: 303,
        title: `${ctx.label}: Log in to the site`,
        headers: [["server", "Apache/2.4.52 (Ubuntu)"], ["x-powered-by", "PHP/8.1.2"]],
        cookies: [{ name: "MoodleSession", secure: true, httpOnly: true, sameSite: "None" }],
        html: page(
          `${ctx.label}: Log in to the site`,
          `<footer>Moodle ${release}</footer>`,
          `<meta name="keywords" content="moodle, ${ctx.label}">`,
        ),
        favicon: "moodle",
        probes: {
          "/login": { statusCode: 303, location: "/login/index.php" },
          "/admin/": { statusCode: 303, location: "/login/index.php" },
        },
      }),
    });
  },
};

const mediawiki: Profile = {
  ttl: LINUX,
  ports: (ctx) =>
    webServer(ctx, {
      server: nginx("1.22.1"),
      site: () => ({
        path: "/wiki/Strona_g%C5%82%C3%B3wna",
        redirectStatus: 301,
        title: ctx.label,
        headers: [["server", "nginx/1.22.1"], ["x-powered-by", "PHP/8.2.20"], ["x-content-type-options", "nosniff"]],
        cookies: [{ name: "wiki_session", httpOnly: true, secure: true }],
        html: page(ctx.label, "", '<meta name="generator" content="MediaWiki 1.39.5">'),
        favicon: "mediawiki",
      }),
    }),
};

const nextcloud: Profile = {
  ttl: LINUX,
  ports: (ctx) =>
    webServer(ctx, {
      server: apache("2.4.62", "(Debian)"),
      site: () => ({
        path: "/login",
        title: "Nextcloud",
        headers: [
          ["server", "Apache/2.4.62 (Debian)"],
          ["strict-transport-security", "max-age=15552000; includeSubDomains"],
          ["referrer-policy", "no-referrer"],
        ],
        cookies: [
          { name: "oc_sessionPassphrase", secure: true, httpOnly: true, sameSite: "Lax" },
          { name: "__Host-nc_sameSiteCookielax", secure: true, httpOnly: true, sameSite: "Lax" },
        ],
        html: page("Nextcloud", "", '<meta name="apple-itunes-app" content="app-id=1125420102">'),
        favicon: "nextcloud",
        probes: { "/login": { statusCode: 200, title: "Nextcloud" } },
      }),
    }),
};

const apacheDefault: Profile = {
  ttl: LINUX,
  ports: (ctx) => [
    ssh(ctx),
    webPort(ctx, {
      port: 80,
      scheme: "http",
      service: apache("2.4.29", "(Ubuntu)"),
      site: () => ({
        title: "Apache2 Ubuntu Default Page: It works",
        headers: [["server", "Apache/2.4.29 (Ubuntu)"]],
        html: page("Apache2 Ubuntu Default Page: It works", "<h1>It works!</h1>"),
        // Left open on an old server: worth an analyst's look.
        probes: { "/server-status": { statusCode: 200, title: "Apache Status" } },
      }),
    }),
  ],
};

const nginxDefault: Profile = {
  ttl: LINUX,
  ports: (ctx) => [
    ssh(ctx),
    webPort(ctx, {
      port: 80,
      scheme: "http",
      service: nginx("1.14.2"),
      site: () => ({ ...nginxWelcome(), headers: [["server", "nginx/1.14.2"]] }),
    }),
  ],
};

const iis: Profile = {
  ttl: WINDOWS,
  ports: (ctx) => [
    ...windowsPorts(ctx),
    ...webServer(ctx, {
      withSsh: false,
      server: {
        name: "http",
        product: "Microsoft IIS httpd",
        version: "10.0",
        cpe: ["cpe:/a:microsoft:internet_information_services:10.0"],
      },
      bareIp: () => ({
        title: "IIS Windows Server",
        headers: [["server", "Microsoft-IIS/10.0"]],
        html: page("IIS Windows Server", '<img src="iisstart.png" alt="IIS">'),
        favicon: "iis",
      }),
      site: () => ({
        path: "/Account/Login",
        title: `Logowanie - ${ctx.label}`,
        headers: [
          ["server", "Microsoft-IIS/10.0"],
          ["x-aspnet-version", "4.0.30319"],
          ["x-powered-by", "ASP.NET"],
        ],
        cookies: [
          { name: "ASP.NET_SessionId", httpOnly: true, sameSite: "Lax" },
          { name: "__RequestVerificationToken", httpOnly: true },
        ],
        html: page(`Logowanie - ${ctx.label}`, '<form action="/Account/Login" method="post"></form>'),
        favicon: "aspnet-app",
        probes: { "/login": { statusCode: 302, location: "/Account/Login" } },
      }),
    }),
  ],
};

// --- DevOps and monitoring -----------------------------------------------------------------

const gitlab: Profile = {
  ttl: LINUX,
  ports: (ctx) => {
    const version = ctx.changed("upgrade") ? "17.5.2" : "16.11.4";
    return webServer(ctx, {
      server: nginx(null),
      site: () => ({
        path: "/users/sign_in",
        title: "Sign in · GitLab",
        headers: [
          ["server", "nginx"],
          ["x-frame-options", "SAMEORIGIN"],
          ["x-gitlab-meta", `{"correlation_id":"01JD","version":"1"}`],
          ["strict-transport-security", "max-age=63072000"],
        ],
        cookies: [{ name: "_gitlab_session", secure: true, httpOnly: true }],
        html: page(
          "Sign in · GitLab",
          `<div class="footer">GitLab Community Edition ${version}</div>`,
          '<meta content="GitLab" property="og:site_name">',
        ),
        favicon: "gitlab",
        probes: { "/admin/": { statusCode: 302, location: "/users/sign_in" }, "/login": { statusCode: 404 } },
      }),
    });
  },
};

const jenkins: Profile = {
  ttl: LINUX,
  ports: (ctx) => {
    const version = ctx.changed("upgrade") ? "2.479.1" : ctx.variant % 2 === 1 ? "2.462.3" : "2.426.3";
    return [
      ssh(ctx),
      webPort(ctx, {
        port: 8080,
        scheme: "http",
        service: { name: "http", product: "Jetty", version: "10.0.20", cpe: ["cpe:/a:eclipse:jetty:10.0.20"] },
        site: () => ({
          path: "/login?from=%2F",
          title: "Sign in [Jenkins]",
          headers: [
            ["server", "Jetty(10.0.20)"],
            ["x-jenkins", version],
            ["x-hudson", "1.395"],
            ["x-jenkins-session", "3f2a9c1e"],
          ],
          cookies: [{ name: `JSESSIONID.${ctx.ip.split(".").join("").slice(-8)}`, httpOnly: true }],
          html: page("Sign in [Jenkins]", `<span class="jenkins_ver">Jenkins ${version}</span>`),
          favicon: "jenkins",
          probes: { "/login": { statusCode: 200, title: "Sign in [Jenkins]" }, "/manager/html": { statusCode: 404 } },
        }),
      }),
    ];
  },
};

const grafana: Profile = {
  ttl: LINUX,
  ports: (ctx) =>
    webServer(ctx, {
      server: nginx("1.24.0"),
      site: () => ({
        path: "/login",
        title: "Grafana",
        headers: [
          ["server", "nginx/1.24.0"],
          ["x-content-type-options", "nosniff"],
          ["x-xss-protection", "1; mode=block"],
        ],
        cookies: [{ name: "redirect_to", httpOnly: true, sameSite: "Lax", path: "/" }],
        html: page(
          "Grafana",
          "",
          '<script>window.grafanaBootData = {"settings":{"buildInfo":{"version":"10.2.3"}}};</script>',
        ),
        favicon: "grafana",
        probes: { "/login": { statusCode: 200, title: "Grafana" } },
      }),
    }),
};

const kibana: Profile = {
  ttl: LINUX,
  ports: (ctx) =>
    webServer(ctx, {
      server: nginx("1.24.0"),
      site: () => ({
        path: "/app/home",
        title: "Elastic",
        headers: [["server", "nginx/1.24.0"], ["kbn-name", "logs-kibana"], ["kbn-license-sig", "5e1f0c"]],
        html: page("Elastic", "", '<meta name="kbn-version" content="7.17.9">'),
        favicon: "kibana",
      }),
    }),
};

const elasticsearch: Profile = {
  ttl: LINUX,
  ports: (ctx) => [
    ssh(ctx),
    webPort(ctx, {
      port: 9200,
      scheme: "http",
      service: {
        name: "http",
        product: "Elasticsearch REST API",
        version: "7.17.9",
        cpe: ["cpe:/a:elastic:elasticsearch:7.17.9"],
      },
      bareIpOnly: true,
      site: () => ({
        title: null,
        headers: [["x-elastic-product", "Elasticsearch"]],
        contentType: "application/json; charset=UTF-8",
        // No authentication: the cluster answers anyone who asks.
        html: JSON.stringify({
          name: "es01",
          cluster_name: "logs",
          version: { number: "7.17.9", build_flavor: "default" },
          tagline: "You Know, for Search",
        }),
      }),
    }),
  ],
};

const zabbix: Profile = {
  ttl: LINUX,
  ports: (ctx) =>
    webServer(ctx, {
      server: nginx("1.18.0"),
      site: () => ({
        title: "Zabbix",
        headers: [["server", "nginx/1.18.0 (Ubuntu)"], ["x-powered-by", "PHP/7.4.3"]],
        cookies: [{ name: "zbx_session", httpOnly: true, secure: false }],
        html: page("Zabbix", '<div class="signin-container"></div><footer>© 2001–2023, Zabbix SIA</footer>'),
        favicon: "zabbix",
      }),
    }),
};

const phpmyadmin: Profile = {
  ttl: LINUX,
  ports: (ctx) => [
    ...webServer(ctx, {
      server: apache("2.4.38", "(Debian)"),
      site: () => ({
        title: "phpMyAdmin",
        headers: [["server", "Apache/2.4.38 (Debian)"], ["x-powered-by", "PHP/7.3.33"], ["x-ob_mode", "1"]],
        cookies: [
          { name: "phpMyAdmin", httpOnly: true, secure: true, sameSite: "Strict" },
          { name: "pma_lang", httpOnly: true, secure: true },
        ],
        html: page("phpMyAdmin", '<div id="login_form"></div>', '<meta name="robots" content="noindex,nofollow">'),
        favicon: "phpmyadmin",
      }),
    }),
    openPort(ctx, 3306, {
      name: "mysql",
      product: "MariaDB",
      version: "10.3.39",
      cpe: ["cpe:/a:mariadb:mariadb:10.3.39"],
    }),
  ],
};

const tomcat: Profile = {
  ttl: LINUX,
  ports: (ctx) => {
    const version = ctx.variant % 2 === 1 ? "9.0.93" : "9.0.65";
    const site = (): SiteSpec => ({
      title: `Apache Tomcat/${version}`,
      html: page(
        `Apache Tomcat/${version}`,
        "<h1>If you're seeing this, you've successfully installed Tomcat. Congratulations!</h1>",
      ),
      favicon: "tomcat",
      probes: {
        "/manager/html": { statusCode: 401, title: "401 Unauthorized" },
        "/version": { statusCode: 404, title: `HTTP Status 404 – Not Found` },
      },
    });
    const service: ServiceSpec = {
      name: "http",
      product: "Apache Tomcat",
      version,
      cpe: [`cpe:/a:apache:tomcat:${version}`],
    };
    return [
      ssh(ctx),
      webPort(ctx, { port: 8080, scheme: "http", service, site }),
      ...(ctx.changed("close-port")
        ? []
        : [
            webPort(ctx, {
              port: 8443,
              scheme: "https",
              service: tls(service),
              site,
              cert: () => deviceCert(ctx.domains[0] ?? "localhost"),
            }),
          ]),
    ];
  },
};

const swagger: Profile = {
  ttl: LINUX,
  ports: (ctx) => [
    ssh(ctx),
    webPort(ctx, {
      port: 8000,
      scheme: "http",
      service: { name: "http", product: "Node.js Express framework", cpe: ["cpe:/a:expressjs:express"] },
      site: () => ({
        path: "/api-docs/",
        redirectStatus: 301,
        title: "Swagger UI",
        headers: [["x-powered-by", "Express"], ["access-control-allow-origin", "*"]],
        html: page("Swagger UI", '<div id="swagger-ui"></div>'),
        favicon: "swagger",
        probes: { "/version": { statusCode: 200, title: null, size: 38 } },
      }),
    }),
  ],
};

const djangoDev: Profile = {
  ttl: LINUX,
  ports: (ctx) => [
    ssh(ctx),
    webPort(ctx, {
      port: 8000,
      scheme: "http",
      service: { name: "http", product: "WSGIServer", version: "0.2", extraInfo: "Python 3.11.4" },
      site: () => ({
        statusCode: 404,
        // DEBUG = True leaks the URL configuration.
        title: "Page not found at /",
        headers: [["server", "WSGIServer/0.2 CPython/3.11.4"], ["x-frame-options", "DENY"]],
        cookies: [{ name: "csrftoken", sameSite: "Lax" }],
        html: page(
          "Page not found at /",
          "<p>You're seeing this error because you have <code>DEBUG = True</code> in your Django settings file.</p>",
        ),
        probes: { "/admin/": { statusCode: 302, location: "/admin/login/?next=/admin/" } },
      }),
    }),
  ],
};

// --- Databases -------------------------------------------------------------------------------

const mysql: Profile = {
  ttl: LINUX,
  ports: (ctx) => [ssh(ctx), mysqlPort(ctx, byVariant(ctx.variant, ["8.0.36", "8.0.39", "5.7.44"]))],
};

const postgres: Profile = {
  ttl: LINUX,
  ports: (ctx) => {
    const version = byVariant(ctx.variant, ["14.10 - 14.13", "16.4", "12.20"]);
    return [
      ssh(ctx),
      openPort(ctx, 5432, {
        name: "postgresql",
        product: "PostgreSQL DB",
        version,
        cpe: ["cpe:/a:postgresql:postgresql"],
      }),
    ];
  },
};

const mssql: Profile = {
  ttl: WINDOWS,
  ports: (ctx) => [
    ...windowsPorts(ctx),
    openPort(
      ctx,
      1433,
      {
        name: "ms-sql-s",
        product: "Microsoft SQL Server 2019",
        version: "15.00.2000.00",
        extraInfo: "RTM",
        cpe: ["cpe:/a:microsoft:sql_server:2019"],
      },
      {
        scripts: [
          {
            id: "ms-sql-ntlm-info",
            output: `Target_Name: KAMPUS\nNetBIOS_Computer_Name: SQL${ctx.variant % 10}`,
          },
        ],
      },
    ),
  ],
};

const oracle: Profile = {
  ttl: LINUX,
  ports: (ctx) => [
    ssh(ctx),
    openPort(ctx, 1521, {
      name: "oracle-tns",
      product: "Oracle TNS listener",
      version: "19.0.0.0.0",
      extraInfo: "unauthorized",
    }),
  ],
};

const redis: Profile = {
  ttl: LINUX,
  ports: (ctx) => [
    ssh(ctx),
    ...(ctx.changed("close-port")
      ? []
      : [
          openPort(
            ctx,
            6379,
            { name: "redis", product: "Redis key-value store", version: "7.0.15" },
            { banner: "-NOAUTH Authentication required." },
          ),
        ]),
  ],
};

const mongodb: Profile = {
  ttl: LINUX,
  ports: (ctx) => [
    ssh(ctx),
    openPort(ctx, 27017, {
      name: "mongodb",
      product: "MongoDB",
      version: "6.0.13",
      cpe: ["cpe:/a:mongodb:mongodb:6.0.13"],
    }),
  ],
};

// --- Servers and workstations ------------------------------------------------------------------

const linux: Profile = {
  ttl: LINUX,
  ports: (ctx) => [
    ssh(ctx),
    ...(ctx.changed("open-port")
      ? [openPort(ctx, 6379, { name: "redis", product: "Redis key-value store", version: "7.2.4" })]
      : []),
  ],
};

const linuxNfs: Profile = {
  ttl: LINUX,
  ports: (ctx) => [
    ssh(ctx),
    openPort(ctx, 111, { name: "rpcbind", version: "2-4", extraInfo: "RPC #100000" }),
    openPort(ctx, 2049, { name: "nfs_acl", version: "3", extraInfo: "RPC #100227" }),
  ],
};

const linuxVnc: Profile = {
  ttl: LINUX,
  ports: (ctx) => [
    ssh(ctx),
    openPort(ctx, 5900, { name: "vnc", product: "VNC", extraInfo: "protocol 3.8" }, {
      banner: "RFB 003.008",
    }),
  ],
};

function windowsPorts(ctx: HostContext, options: { rdp?: boolean } = {}): OpenPort[] {
  const name = `KAMPUS-${ctx.ip.split(".").slice(2).join("-")}`;
  // Servers may close RDP in the second run (`close-port`); workstations may open it (`open-port`).
  const rdp = (options.rdp ?? true) ? !ctx.changed("close-port") : ctx.changed("open-port");
  return [
    openPort(ctx, 135, { name: "msrpc", product: "Microsoft Windows RPC", cpe: ["cpe:/o:microsoft:windows"] }),
    openPort(ctx, 139, { name: "netbios-ssn", product: "Microsoft Windows netbios-ssn" }),
    openPort(ctx, 445, { name: "microsoft-ds", method: "table", confidence: 3 }, {
      scripts: [{ id: "smb2-security-mode", output: "3:1:1: Message signing enabled but not required" }],
    }),
    ...(rdp
      ? [
          openPort(ctx, 3389, {
            name: "ms-wbt-server",
            product: "Microsoft Terminal Services",
            cpe: ["cpe:/o:microsoft:windows"],
          }, {
            scripts: [
              {
                id: "rdp-ntlm-info",
                output: `Target_Name: KAMPUS\nNetBIOS_Computer_Name: ${name}\nProduct_Version: 10.0.20348`,
              },
            ],
          }),
        ]
      : []),
  ];
}

const windows: Profile = { ttl: WINDOWS, ports: (ctx) => windowsPorts(ctx) };

const workstation: Profile = { ttl: WINDOWS, ports: (ctx) => windowsPorts(ctx, { rdp: false }) };

// --- Devices ----------------------------------------------------------------------------------

const camera: Profile = {
  ttl: LINUX,
  ports: (ctx) => [
    ...(ctx.changed("open-port")
      ? [
          openPort(
            ctx,
            23,
            { name: "telnet", product: "BusyBox telnetd", cpe: ["cpe:/a:busybox:busybox"] },
            { banner: "(none) login:" },
          ),
        ]
      : []),
    webPort(ctx, {
      port: 80,
      scheme: "http",
      service: { name: "http", product: "Boa HTTPd", version: "0.94.14rc21", cpe: ["cpe:/a:boa:boa:0.94.14rc21"] },
      bareIpOnly: true,
      site: () => ({
        title: "IPCAM",
        headers: [["server", "Boa/0.94.14rc21"], ["accept-ranges", "bytes"]],
        html: page("IPCAM", '<object classid="clsid:IPCAM-PLUGIN"></object>'),
        favicon: "ipcam",
        probes: { "/login": { statusCode: 200, title: "IPCAM" } },
      }),
    }),
  ],
};

const RENEWED_DEVICE_CERT = { notBefore: "2026-11-20T11:00:00Z", notAfter: "2036-11-18T11:00:00Z" };

const printer: Profile = {
  ttl: NETWORK,
  ports: (ctx) => {
    const model = byVariant(ctx.variant, ["HP LaserJet Pro M404dn", "HP Color LaserJet MFP M479fdw"]);
    const cn = `HP${ctx.ip.split(".").slice(2).join("")}`;
    const site = (): SiteSpec => ({
      title: model,
      headers: [["server", `HP HTTP Server; HP ${model} - W1A53A; Built: Mon Jan 15, 2024 FUTURESMART`]],
      html: page(model, '<div id="hp-header"></div>'),
      favicon: "hp-printer",
    });
    const service: ServiceSpec = { name: "http", product: "HP printer http config", cpe: ["cpe:/h:hp"] };
    return [
      webPort(ctx, { port: 80, scheme: "http", service, site, bareIpOnly: true }),
      webPort(ctx, {
        port: 443,
        scheme: "https",
        service: tls(service),
        site,
        bareIpOnly: true,
        cert: () => ({ ...deviceCert(cn), ...(ctx.changed("renew-cert") ? RENEWED_DEVICE_CERT : {}) }),
      }),
    ];
  },
};

const ups: Profile = {
  ttl: NETWORK,
  ports: (ctx) => [
    openPort(ctx, 21, { name: "ftp", product: "APC FTP Server" }, {
      banner: "220 Network Management Card AOS v6.9.6 FTP server ready.",
    }),
    webPort(ctx, {
      port: 80,
      scheme: "http",
      service: { name: "http", product: "Allegro RomPager", version: "4.01", cpe: ["cpe:/a:allegrosoft:rompager:4.01"] },
      bareIpOnly: true,
      site: () => ({
        path: "/logon.htm",
        title: "Log On",
        headers: [["server", "Allegro-Software-RomPager/4.01"]],
        html: page("Log On", "<p>Network Management Card AOS v6.9.6</p>"),
        favicon: "apc",
      }),
    }),
  ],
};

const idracSite = (): SiteSpec => ({
  path: "/restgui/start.html",
  title: "iDRAC9",
  headers: [["server", "Apache"], ["strict-transport-security", "max-age=63072000"]],
  html: page("iDRAC9", '<div id="idrac-login"></div>'),
  favicon: "idrac",
});

const bmc: Profile = {
  ttl: LINUX,
  ports: (ctx) => {
    const cn = ctx.domains[0] ?? `idrac-${ctx.ip.split(".").slice(2).join("")}`;
    const service: ServiceSpec = { name: "http", product: "Apache httpd" };
    return [
      openPort(
        ctx,
        22,
        {
          name: "ssh",
          product: "OpenSSH",
          version: "8.4",
          extraInfo: "protocol 2.0",
          cpe: ["cpe:/a:openbsd:openssh:8.4"],
        },
        { banner: "SSH-2.0-OpenSSH_8.4" },
      ),
      webPort(ctx, { port: 80, scheme: "http", service, site: idracSite, bareIpOnly: true, upgradesToHttps: true }),
      webPort(ctx, {
        port: 443,
        scheme: "https",
        service: tls(service),
        site: idracSite,
        bareIpOnly: true,
        cert: () => deviceCert(cn),
      }),
    ];
  },
};

const nas: Profile = {
  ttl: LINUX,
  ports: (ctx) => [
    openPort(ctx, 139, { name: "netbios-ssn", product: "Samba smbd", version: "4.6.2" }),
    openPort(ctx, 445, { name: "netbios-ssn", product: "Samba smbd", version: "4.6.2" }),
    webPort(ctx, {
      port: 80,
      scheme: "http",
      service: nginx(null),
      bareIpOnly: true,
      site: () => ({
        title: "Synology DiskStation",
        headers: [["server", "nginx"]],
        html: page("Synology DiskStation", '<div id="sds-login"></div>'),
        favicon: "synology",
      }),
    }),
  ],
};

export const PROFILES = {
  router,
  networkSwitch,
  dns,
  mail,
  wordpress,
  stagingWordpress,
  joomla,
  drupal,
  moodle,
  mediawiki,
  nextcloud,
  apacheDefault,
  nginxDefault,
  iis,
  gitlab,
  jenkins,
  grafana,
  kibana,
  elasticsearch,
  zabbix,
  phpmyadmin,
  tomcat,
  swagger,
  djangoDev,
  mysql,
  postgres,
  mssql,
  oracle,
  redis,
  mongodb,
  linux,
  linuxNfs,
  linuxVnc,
  windows,
  workstation,
  camera,
  printer,
  ups,
  bmc,
  nas,
} satisfies Record<string, Profile>;

export type ProfileKey = keyof typeof PROFILES;
