// Dev-only front door for a public tunnel. It forwards Twilio's inbound SMS, WhatsApp and Messenger webhooks to
// the local Mastra server and answers 404 to everything else, so the tunnel URL never reaches Studio, /api or the starter agent's file
// and shell tools. Point the tunnel at this port, not at 4111:
//
//   node src/m4/dev/webhook-proxy.mjs
//   cloudflared tunnel --url http://127.0.0.1:4114
import http from 'node:http';

const PORT = Number(process.env.M4_PROXY_PORT || 4114);
const TARGET = new URL(process.env.M4_PROXY_TARGET || 'http://localhost:4111');
// "METHOD path" pairs that may pass. The routes behind them check Twilio's signature.
const ALLOWED = new Set(['POST /m4/twilio/sms', 'POST /m4/twilio/whatsapp', 'POST /m4/twilio/messenger']);
// Twilio's form posts are a few hundred bytes.
const MAX_BODY_BYTES = 64 * 1024;

// One line per request. Never the headers or body: the body holds the sender's raw phone number or Messenger id.
function log(req, path, status) {
  console.log(`${new Date().toISOString()} ${req.method} ${path} -> ${status}`);
}

function reject(req, res, path, status, text) {
  log(req, path, status);
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'text/plain', Connection: 'close' });
  res.end(text);
}

const server = http.createServer((req, res) => {
  // Parsing resolves "." and ".." segments, so the path checked is the path forwarded.
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.pathname;
  if (!ALLOWED.has(`${req.method} ${path}`)) return reject(req, res, path, 404, 'Not Found');
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
    return reject(req, res, path, 413, 'Payload Too Large');
  }

  const upstream = http.request(
    {
      protocol: TARGET.protocol,
      hostname: TARGET.hostname,
      port: TARGET.port,
      method: req.method,
      path: path + url.search,
      headers: { ...req.headers, host: TARGET.host },
    },
    (upstreamRes) => {
      log(req, path, upstreamRes.statusCode);
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', () => reject(req, res, path, 502, 'Bad Gateway'));

  let received = 0;
  req.on('data', (chunk) => {
    received += chunk.length;
    if (received > MAX_BODY_BYTES) {
      upstream.destroy();
      reject(req, res, path, 413, 'Payload Too Large');
    }
  });
  req.pipe(upstream);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`M4 webhook proxy on http://127.0.0.1:${PORT} -> ${TARGET.origin} (${[...ALLOWED].join(', ')})`);
});
