import "dotenv/config";
import { spawn } from "node:child_process";
import { access, constants as fsConstants } from "node:fs/promises";
import os from "node:os";
import net from "node:net";
import path from "node:path";

let npmCmd = "npm";
let npxCmd = "npx";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function runCapture(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("exit", () => resolve({ out, err }));
  });
}

function parseNodeVersion(raw) {
  const m = String(raw).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function versionGte(a, b) {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
}

async function ensureNodeVersion() {
  const min = { major: 18, minor: 17, patch: 0 };
  const current = parseNodeVersion(process.version);
  if (current && versionGte(current, min)) {
    process.env.PM2_NODE_BIN ||= process.execPath;
    return;
  }

  const candidates = [
    process.env.E2E_NODE_BIN,
    process.env.PM2_NODE_BIN,
    `${os.homedir()}/.n/bin/node`,
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate, fsConstants.X_OK);
    } catch {
      continue;
    }
    const { out, err } = await runCapture(candidate, ["-v"]);
    const v = parseNodeVersion(out || err);
    if (!v || !versionGte(v, min)) continue;

    const binDir = path.dirname(candidate);
    process.env.PATH = `${binDir}:${process.env.PATH || ""}`;
    process.env.PM2_NODE_BIN = candidate;

    try {
      await access(path.join(binDir, "npm"), fsConstants.X_OK);
      npmCmd = path.join(binDir, "npm");
    } catch {}
    try {
      await access(path.join(binDir, "npx"), fsConstants.X_OK);
      npxCmd = path.join(binDir, "npx");
    } catch {}

    return;
  }

  throw new Error(
    `Node.js >= v18.17.0 required for Next.js build. Current: ${process.version}. ` +
      `Install Node 20+ and/or export E2E_NODE_BIN=/path/to/node (or PM2_NODE_BIN).`,
  );
}

async function waitForOk(url, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function isPortFree(port) {
  async function canListen(host) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.on("error", () => resolve(false));
      server.listen({ port, host }, () => server.close(() => resolve(true)));
    });
  }

  // Next binds to `::` by default; treat port as free only if both stacks are free.
  const v6 = await canListen("::");
  if (!v6) return false;
  const v4 = await canListen("127.0.0.1");
  return v4;
}

async function pickPort(preferredPort) {
  const preferred = Number(preferredPort);
  if (await isPortFree(preferred)) return preferred;
  for (let p = preferred + 1; p < preferred + 50; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error(`No free port found near ${preferred}`);
}

function ensureEnv() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set in web/.env for E2E.");
  }
  const pw = String(process.env.SESSION_PASSWORD || "");
  if (pw.length < 32) {
    // Make build/runtime stable even if local .env has a short password.
    process.env.SESSION_PASSWORD = "0123456789abcdef0123456789abcdef";
  }
  if (!process.env.ADMIN_USERNAME) process.env.ADMIN_USERNAME = "admin";
  if (!process.env.ADMIN_PASSWORD) process.env.ADMIN_PASSWORD = "admin";
}

async function main() {
  await ensureNodeVersion();
  ensureEnv();

  await run(npmCmd, ["run", "build"], { cwd: process.cwd(), env: process.env });

  const port = await pickPort(process.env.E2E_PORT || "3100");
  process.env.CARLASITE_PORT = String(port);
  process.env.E2E_BASE_URL = `http://127.0.0.1:${port}`;
  const appName = "carlasite-web-e2e";

  // Ensure a clean slate (avoid interfering with a real `carlasite-web` instance).
  await runCapture("pm2", ["delete", appName], { cwd: process.cwd() });

  // Start via PM2
  await run("pm2", ["start", "ecosystem.e2e.config.cjs", "--only", appName, "--update-env"], {
    cwd: process.cwd(),
    env: process.env,
  });

  try {
    await waitForOk(`${process.env.E2E_BASE_URL}/health`);
    await run(npxCmd, ["playwright", "test"], { cwd: process.cwd(), env: process.env });
  } catch (err) {
    const logs = await runCapture("pm2", ["logs", appName, "--lines", "200", "--nostream"], {
      cwd: process.cwd(),
    });
    process.stderr.write("\n--- PM2 logs (last 200) ---\n");
    process.stderr.write(logs.out || logs.err || "");
    throw err;
  } finally {
    await runCapture("pm2", ["delete", appName], { cwd: process.cwd() });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
