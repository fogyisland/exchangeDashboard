// Build a URL against a specific port from a baseUrl that may include a port.
// Replaces the trailing :port segment (if any) with the supplied port and
// strips any trailing slash. Appends the path verbatim. Used by the agent
// to route heartbeat/report/discover traffic to the dedicated center apps
// (8081 / 8082) instead of the web admin port (8080).
export function urlFor(baseUrl, port, path) {
  const stripped = String(baseUrl).replace(/\/$/, '');
  const replaced = stripped.replace(/:\d+$/, `:${port}`);
  return replaced + path;
}