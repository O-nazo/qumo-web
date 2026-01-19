// tools/run-tunnel.js
const { spawn } = require("child_process");
const fs = require("fs");

const PORT = process.env.PORT || "37344";
const LOCAL_URL = `http://localhost:${PORT}`;

const exe = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
const args = ["tunnel", "--url", LOCAL_URL, "--loglevel", "info"];

let current = "";

const p = spawn(exe, args, { stdio: ["inherit", "pipe", "pipe"] });

function onLine(line) {
  process.stdout.write(`[tunnel] ${line}\n`);
  const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (m && m[0] !== current) {
    current = m[0];
    fs.writeFileSync(".tunnel-url", current, "utf8");
    process.stdout.write(`[tunnel] public url => ${current}\n`);
  }
}

for (const s of [p.stdout, p.stderr]) {
  let buf = "";
  s.on("data", (d) => {
    buf += d.toString("utf8");
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  });
}

p.on("exit", (code) => process.exit(code ?? 0));
