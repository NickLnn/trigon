/**
 * Production entrypoint for the web container: one public port for everything.
 *
 *   /collab (WebSocket)  →  collaboration server (api:4001)
 *   everything else      →  Next.js (started here as a child process on an internal port)
 *
 * This lets Trigon run behind a single hostname (Cloudflare Tunnel, Synology reverse proxy…) without a
 * separate route for live editing. Plain Node, no dependencies.
 */
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { fork } = require('node:child_process');

const PORT = Number(process.env.PORT || 3000);
const NEXT_PORT = Number(process.env.NEXT_INTERNAL_PORT || 3001);
const collab = new URL(process.env.COLLAB_INTERNAL_URL || 'http://api:4001');

/**
 * Proxies whose forwarded client address (CF-Connecting-IP, X-Real-IP, X-Forwarded-For) is believed:
 * loopback and the Docker networks by default — a Cloudflare tunnel container or the NAS's reverse proxy
 * reaches us from there. A LAN computer connecting directly is *not* a proxy, so it can't put a fake
 * address into the audit log. Add others with TRUSTED_PROXIES (comma-separated addresses or CIDRs).
 */
const TRUSTED = new net.BlockList();
TRUSTED.addSubnet('127.0.0.0', 8, 'ipv4');
TRUSTED.addAddress('::1', 'ipv6');
TRUSTED.addSubnet('172.16.0.0', 12, 'ipv4');
for (const entry of String(process.env.TRUSTED_PROXIES || '').split(',').map((s) => s.trim()).filter(Boolean)) {
  const [addr, bits] = entry.split('/');
  const type = net.isIP(addr) === 6 ? 'ipv6' : 'ipv4';
  if (!net.isIP(addr)) console.warn(`TRUSTED_PROXIES: ignoring "${entry}"`);
  else if (bits) TRUSTED.addSubnet(addr, Number(bits), type);
  else TRUSTED.addAddress(addr, type);
}
const bare = (ip) => String(ip || '').trim().replace(/^::ffff:/i, '');
const trusted = (ip) => net.isIP(ip) !== 0 && TRUSTED.check(ip, net.isIP(ip) === 6 ? 'ipv6' : 'ipv4');

/** The visitor's address, for the audit log and rate limits. Forwarded headers count only from a trusted proxy. */
function clientIp(req) {
  const peer = bare(req.socket.remoteAddress);
  if (!trusted(peer)) return peer;
  const h = req.headers;
  const forwarded = bare(h['cf-connecting-ip'] || h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0]);
  return net.isIP(forwarded) ? forwarded : peer;
}

/** Headers for the upstream request: our client-IP header (never the caller's) and an appended X-Forwarded-For. */
function forwardHeaders(req) {
  const peer = bare(req.socket.remoteAddress);
  const xff = req.headers['x-forwarded-for'];
  return { 'x-trigon-client-ip': clientIp(req), 'x-forwarded-for': xff ? `${xff}, ${peer}` : peer };
}

const next = fork(path.join(__dirname, 'server.js'), [], {
  env: { ...process.env, PORT: String(NEXT_PORT), HOSTNAME: '127.0.0.1' },
  stdio: 'inherit',
});
next.on('exit', (code) => process.exit(code ?? 1));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => next.kill(sig));

const server = http.createServer((req, res) => {
  const upstream = http.request(
    { host: '127.0.0.1', port: NEXT_PORT, method: req.method, path: req.url, headers: { ...req.headers, ...forwardHeaders(req) } },
    (r) => {
      res.writeHead(r.statusCode || 502, r.statusMessage, r.rawHeaders);
      r.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Trigon is starting…');
  });
  req.pipe(upstream);
});

// WebSocket upgrades: /collab goes to the collaboration server, anything else to Next.js.
server.on('upgrade', (req, socket, head) => {
  const toCollab = req.url === '/collab' || req.url.startsWith('/collab?') || req.url.startsWith('/collab/');
  const target = toCollab ? { host: collab.hostname, port: Number(collab.port || 80) } : { host: '127.0.0.1', port: NEXT_PORT };
  const upstream = net.connect(target.port, target.host, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    const extra = forwardHeaders(req);
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (req.rawHeaders[i].toLowerCase() in extra) continue;
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    for (const [k, v] of Object.entries(extra)) lines.push(`${k}: ${v}`);
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  const close = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on('error', close);
  socket.on('error', close);
});

server.keepAliveTimeout = 65_000;
server.listen(PORT, '0.0.0.0', () => console.log(`Trigon web on :${PORT} (Next.js on :${NEXT_PORT}, /collab → ${collab.host})`));
