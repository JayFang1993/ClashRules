import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const context = vm.createContext({ URL, Response });
const entry = new vm.SourceTextModule(await readFile(new URL("./worker.mjs", import.meta.url), "utf8"), { context });
await entry.link(async (specifier) => {
  const text = await readFile(new URL(specifier, new URL("./worker.mjs", import.meta.url)), "utf8");
  return new vm.SyntheticModule(["default"], function () { this.setExport("default", text); }, { context });
});
await entry.evaluate();
const worker = entry.namespace.default;
const env = {
  AIRPORT_URL: "https://airport.example/sub?key=sample",
  VPS_NODES: JSON.stringify([{ name: "VPS-KR", type: "vless", server: "192.0.2.1", port: 443, uuid: "test-only" }]),
};

function request(path = "/clashmi.yaml", method = "GET") {
  return new Request(`https://sub.example${path}`, { method });
}

test("serves complete YAML anonymously with independent providers", async () => {
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Type"), /application\/yaml/);
  const text = await response.text();
  assert.match(text, /proxy-providers: /);
  assert.match(text, /include-all-providers: true/);
  assert.match(text, /DOMAIN-SUFFIX,sankuai\.com,DIRECT/);
  assert.match(text, /dns:\n  enable: true/);
  assert.match(text, /enhanced-mode: redir-host/);
  assert.ok(!text.includes("api.v1.mk") && !text.includes("url.v1.mk"));
  assert.ok(!text.includes("geosite:"));
  assert.ok(!/^tun:|^mixed-port:|^port:|^socks-port:/m.test(text));
  assert.ok(text.includes("VPS-KR") && text.includes(env.AIRPORT_URL));
});

test("HEAD returns metadata without configuration body", async () => {
  const response = await worker.fetch(request("/", "HEAD"), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("rejects unknown paths and write methods", async () => {
  assert.equal((await worker.fetch(request("/secrets"), env)).status, 404);
  assert.equal((await worker.fetch(request("/clashmi.yaml", "POST"), env)).status, 405);
});

test("invalid secrets return a generic failure without credentials", async () => {
  for (const broken of [{}, { ...env, VPS_NODES: "invalid" }, { ...env, AIRPORT_URL: "http://airport.example/sub" }]) {
    const response = await worker.fetch(request(), broken);
    assert.equal(response.status, 503);
    assert.equal(await response.text(), "Configuration unavailable\n");
  }
});
