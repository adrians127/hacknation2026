import { describe, expect, it } from "vitest";

import { componentsOf } from "~backend/modules/vulnerabilities/components/component";
import { distroHint } from "~backend/modules/vulnerabilities/components/distro-hint";

const hint = (version: string | null, extraInfo: string | null, cpes: string[] = []) =>
  componentsOf({ cpe: ["cpe:/a:x:y:1", ...cpes], version, extraInfo })[0]?.distro ??
  distroHint({ version, extraInfo, cpes: [] });

describe("distroHint", () => {
  it("reads the Debian revision and release from nmap's version or extra info", () => {
    expect(hint("9.2p1 Debian 2+deb12u3", "protocol 2.0")).toEqual({
      family: "Debian",
      release: "12",
      revision: "2+deb12u3",
    });
    expect(hint("9.2p1", "Debian 2+deb12u5")).toEqual({
      family: "Debian",
      release: "12",
      revision: "2+deb12u5",
    });
    expect(hint("2.4.62", "(Debian)")).toEqual({ family: "Debian", release: null, revision: null });
  });

  it("reads Ubuntu revisions from extra info and package versions", () => {
    expect(hint("9.6p1", "Ubuntu 3ubuntu13.5")).toEqual({
      family: "Ubuntu",
      release: null,
      revision: "3ubuntu13.5",
    });
    expect(hint("9.18.28-0ubuntu0.22.04.1", null)).toEqual({
      family: "Ubuntu",
      release: "22.04",
      revision: "0ubuntu0.22.04.1",
    });
    expect(hint("2.4.58", "(Ubuntu)").family).toBe("Ubuntu");
    expect(hint("8.9p1", "Ubuntu Linux; protocol 2.0")).toEqual({
      family: "Ubuntu",
      release: null,
      revision: null,
    });
  });

  it("falls back to OS CPEs and knows Red Hat family builds", () => {
    expect(hint("8.0", "protocol 2.0", ["cpe:/o:debian:debian_linux"]).family).toBe("Debian");
    expect(hint("2.4.37", "(Rocky Linux)").family).toBe("RedHat");
    expect(hint("7.4", "protocol 2.0").family).toBeNull();
  });
});

describe("componentsOf", () => {
  it("keeps application CPEs, and OS CPEs only when they carry a version", () => {
    const components = componentsOf({
      cpe: ["cpe:/a:openbsd:openssh:9.6p1", "cpe:/o:linux:linux_kernel", "cpe:/o:cisco:ios:15.2"],
      version: "9.6p1",
      extraInfo: "Ubuntu 3ubuntu13",
    });
    expect(components.map((component) => component.cpe.product)).toEqual(["openssh", "ios"]);
    expect(components[0].version).toBe("9.6p1");
    expect(components[0].platforms.map((platform) => platform.product)).toEqual([
      "linux_kernel",
      "ios",
      "ubuntu_linux",
    ]);
  });

  it("keeps a versionless application CPE with a null version", () => {
    const [component] = componentsOf({
      cpe: ["cpe:/a:postgresql:postgresql"],
      version: null,
      extraInfo: null,
    });
    expect(component.version).toBeNull();
  });
});
