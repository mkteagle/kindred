import { createHash } from "node:crypto";

// The QR payload lives in the fragment, which the browser never sends to the
// web server. This standalone landing page loads no analytics or third parties.
const handoff = `
function renderHandoff() {
  const fields = new URLSearchParams(location.hash.slice(1));
  const servers = fields.getAll("server");
  const codes = fields.getAll("code");
  const link = document.getElementById("open");
  const message = document.getElementById("message");
  try {
    if (servers.length !== 1 || codes.length !== 1) throw new Error();
    const server = new URL(servers[0]);
    const code = codes[0].toUpperCase();
    if (server.protocol !== "https:" || server.username || server.password ||
        server.search || server.hash || !/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(code)) {
      throw new Error();
    }
    link.href = "kindred://pair?" + new URLSearchParams({ server: server.href, code });
    link.hidden = false;
    message.textContent = "Open Kindred to approve this household connection.";
  } catch {
    link.removeAttribute("href");
    link.hidden = true;
    message.textContent = "Scan a new pairing code from your household’s Mobile setup page.";
  }
}
addEventListener("hashchange", renderHandoff);
renderHandoff();
`;
const scriptHash = createHash("sha256").update(handoff).digest("base64");

export function GET() {
  return new Response(`<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pair a device · Kindred Photos</title>
  <style>
    :root { color-scheme: light dark; font: 1rem system-ui, sans-serif; }
    body { margin:0; min-height:100svh; display:grid; place-items:center; }
    main { max-width:28rem; padding:2rem; }
    h1 { font-size:clamp(2rem,8vw,3rem); line-height:1.1; }
    p { line-height:1.55; }
    a { color:inherit; }
    #open:not([hidden]) { display:inline-flex; padding:0.8rem 1.2rem; border-radius:0.8rem; background:#6554c0; color:white; text-decoration:none; font-weight:650; }
  </style>
</head><body><main>
  <h1>Pair with Kindred</h1>
  <p id="message">Scan your household’s pairing code in the Kindred app.</p>
  <a id="open" hidden>Open Kindred</a>
  <p><a href="https://apps.apple.com/app/id6763926175">Get Kindred Photos</a></p>
</main><script>${handoff}</script></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
