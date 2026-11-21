import type { Server } from "node:http";

import { buildApp } from "~backend/app";

export interface TestServer {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const server: Server = buildApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a TCP address");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * A fetch wrapper with a cookie jar, standing in for one browser. Ignores cookie
 * paths and sends every cookie it holds; enough for testing the API.
 */
export class TestClient {
  readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  async request(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (this.cookies.size > 0) {
      headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    this.storeCookies(res);
    return res;
  }

  get(path: string, options?: RequestOptions) {
    return this.request("GET", path, options);
  }

  post(path: string, options?: RequestOptions) {
    return this.request("POST", path, options);
  }

  patch(path: string, options?: RequestOptions) {
    return this.request("PATCH", path, options);
  }

  delete(path: string, options?: RequestOptions) {
    return this.request("DELETE", path, options);
  }

  private storeCookies(res: Response): void {
    for (const header of res.headers.getSetCookie()) {
      const [pair = "", ...attributes] = header.split(";").map((part) => part.trim());
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const expired = attributes.some(
        (attribute) =>
          /^max-age=0$/i.test(attribute) ||
          (/^expires=/i.test(attribute) && Date.parse(attribute.slice(8)) <= Date.now()),
      );
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}
