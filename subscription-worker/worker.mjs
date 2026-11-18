import commonPolicy from "../mihomo_common.yaml";
import iosBase from "../clashmi_base.yaml";
import macBase from "../clashverge_base.yaml";

// Every client subscribes to the base that matches how it manages ports, TUN and DNS,
// while the policy, proxy groups and rules come from the shared mihomo_common.yaml.
const clients = new Map([
  ["/clashmi.yaml", { name: "Clash Mi", base: iosBase }],
  ["/clashverge.yaml", { name: "Clash Verge", base: macBase }],
]);
const defaultClient = clients.get("/clashmi.yaml");

const headers = {
  "Content-Type": "application/yaml; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "profile-update-interval": "24",
};

export function buildConfiguration(env, base = defaultClient.base) {
  const airport = new URL(env.AIRPORT_URL);
  if (airport.protocol !== "https:") throw new Error("Invalid airport URL");
  const nodes = JSON.parse(env.VPS_NODES);
  if (!Array.isArray(nodes) || nodes.length === 0) throw new Error("Missing VPS nodes");
  const names = new Set();
  for (const node of nodes) {
    if (!node || typeof node.name !== "string" || !node.name || names.has(node.name)
      || !node.type || !node.server || !Number.isInteger(node.port)
      || node.port < 1 || node.port > 65535) throw new Error("Invalid VPS node");
    names.add(node.name);
  }
  // Shared pools include local VPS nodes and the independently updated airport provider.
  const policy = commonPolicy.replaceAll(
    "include-all-proxies: true",
    "include-all-proxies: true, include-all-providers: true",
  );
  const providers = {
    Airport: {
      type: "http",
      url: airport.href,
      path: "./proxy-cache/airport.yaml",
      interval: 86400,
      proxy: "DIRECT",
      header: { "User-Agent": ["ClashVerge/v2.4.5"] },
      "health-check": {
        enable: true,
        url: "https://www.gstatic.com/generate_204",
        interval: 600,
        timeout: 8000,
        lazy: true,
      },
    },
  };
  // JSON flow values are valid YAML and quote private values without interpolation.
  return `${base.trim()}\n\n${policy.trim()}\n\nproxies: ${JSON.stringify(nodes)}\nproxy-providers: ${JSON.stringify(providers)}\n`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const client = url.pathname === "/" ? defaultClient : clients.get(url.pathname);
    if (!client) {
      return new Response("Not found\n", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed\n", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    try {
      const config = buildConfiguration(env, client.base);
      return new Response(request.method === "HEAD" ? null : config, { headers });
    } catch {
      return new Response("Configuration unavailable\n", {
        status: 503,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};
