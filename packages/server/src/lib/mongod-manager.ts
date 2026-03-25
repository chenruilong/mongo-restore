import { Subprocess } from "bun";
import { MongoClient } from "mongodb";
import { getRandomPort, MONGO_VERSIONS, DEFAULT_MONGO_VERSION } from "./utils";
import type { MongodConfig } from "../types";
import fs from "fs/promises";
import path from "path";

interface MongodInstance {
  backupId: string;
  port: number;
  process: Subprocess;
  version: string;
  dbPath: string;
  createdAt: number;
}

interface StartMongodHooks {
  onInfo?: (message: string) => void;
}

const instances = new Map<string, MongodInstance>();

// Auto-cleanup timeout (2 hours)
const CLEANUP_TIMEOUT_MS = 2 * 60 * 60 * 1000;

setInterval(async () => {
  const now = Date.now();
  for (const [id, instance] of instances) {
    if (now - instance.createdAt > CLEANUP_TIMEOUT_MS) {
      await stopMongod(id);
    }
  }
}, 60 * 1000);

function reportInfo(hooks: StartMongodHooks | undefined, message: string) {
  hooks?.onInfo?.(message);
}

export async function getAvailableVersions(): Promise<string[]> {
  const entries = await Promise.all(
    Object.entries(MONGO_VERSIONS).map(async ([version, binaryPath]) => {
      try {
        await fs.access(binaryPath);
        return version;
      } catch {
        return null;
      }
    })
  );

  return entries.filter((version): version is string => version !== null);
}

export async function startMongod(
  backupId: string,
  dbPath: string,
  config?: MongodConfig,
  hooks?: StartMongodHooks
): Promise<{ port: number; version: string }> {
  reportInfo(hooks, `Preparing mongod data path ${dbPath}`);

  if (instances.has(backupId)) {
    reportInfo(hooks, `Stopping existing mongod instance for backup ${backupId}`);
    await stopMongod(backupId);
  }

  const version = config?.version || DEFAULT_MONGO_VERSION;
  const mongodPath = MONGO_VERSIONS[version] || "mongod";
  const port = getRandomPort();
  const logPath = path.join(dbPath, "mongod.log");

  reportInfo(hooks, `Selected MongoDB version ${version}`);
  reportInfo(hooks, `Using mongod binary ${mongodPath}`);
  reportInfo(hooks, `Reserved local port ${port}`);

  const cleanupMessages = await cleanForStartup(dbPath);
  if (cleanupMessages.length === 0) {
    reportInfo(hooks, "No stale lock files found in data path");
  } else {
    for (const message of cleanupMessages) {
      reportInfo(hooks, message);
    }
  }

  reportInfo(hooks, `Writing mongod logs to ${logPath}`);
  if ((config?.extraArgs || []).length > 0) {
    reportInfo(hooks, `Applying extra args: ${(config?.extraArgs || []).join(" ")}`);
  }

  const args = [
    mongodPath,
    "--dbpath", dbPath,
    "--port", String(port),
    "--logpath", logPath,
    "--logappend",
    "--bind_ip", "127.0.0.1",
    "--noauth",
    ...(config?.extraArgs || []),
  ];

  reportInfo(hooks, `Launching command: ${args.join(" ")}`);
  console.log(`Starting mongod ${version} on port ${port}: ${args.join(" ")}`);

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const instance: MongodInstance = {
    backupId,
    port,
    process: proc,
    version,
    dbPath,
    createdAt: Date.now(),
  };
  instances.set(backupId, instance);

  try {
    await waitForMongod(port, proc, logPath, 120000, hooks);
  } catch (err) {
    reportInfo(hooks, "mongod failed to become ready; collecting diagnostics");
    await terminateProcess(proc);
    instances.delete(backupId);
    await cleanForStartup(dbPath);
    throw err;
  }

  return { port, version };
}

export async function stopMongod(backupId: string): Promise<void> {
  const instance = instances.get(backupId);
  if (!instance) return;

  try {
    const client = new MongoClient(`mongodb://127.0.0.1:${instance.port}`);
    try {
      await client.connect();
      await client.db("admin").command({ shutdown: 1 });
    } catch {
      // shutdown command usually throws because the connection is dropped
    } finally {
      await client.close().catch(() => {});
    }
  } catch {
    // Fall through to forced termination below.
  }

  await terminateProcess(instance.process);
  instances.delete(backupId);
}

async function terminateProcess(proc: Subprocess): Promise<void> {
  if (proc.exitCode !== null) return;

  proc.kill();

  try {
    await Promise.race([proc.exited, Bun.sleep(3000)]);
  } catch {}
}

export function getMongodPort(backupId: string): number | undefined {
  return instances.get(backupId)?.port;
}

async function waitForMongod(
  port: number,
  proc: Subprocess,
  logPath: string,
  timeoutMs: number,
  hooks?: StartMongodHooks
): Promise<void> {
  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < timeoutMs) {
    attempt++;

    if (proc.exitCode !== null) {
      reportInfo(hooks, `mongod exited before becoming ready (exit code ${proc.exitCode})`);
      throw new Error(await buildMongodStartupError(logPath, proc.exitCode));
    }

    try {
      reportInfo(hooks, `Waiting for mongod readiness check #${attempt}`);
      const client = new MongoClient(`mongodb://127.0.0.1:${port}`, {
        serverSelectionTimeoutMS: 2000,
        connectTimeoutMS: 2000,
      });
      await client.connect();
      await client.db("admin").command({ ping: 1 });
      await client.close();
      reportInfo(hooks, `mongod responded to ping on port ${port}`);
      console.log(`mongod ready on port ${port}`);
      return;
    } catch {
      if (attempt === 1 || attempt % 5 === 0) {
        const latestLogLine = await readLatestLogLine(logPath);
        if (latestLogLine) {
          reportInfo(hooks, `[mongod.log] ${latestLogLine}`);
        }
      }
      await Bun.sleep(1000);
    }
  }

  proc.kill();
  reportInfo(hooks, `mongod did not become ready within ${timeoutMs / 1000}s`);
  throw new Error(await buildMongodStartupError(logPath, undefined, timeoutMs));
}

async function buildMongodStartupError(logPath: string, exitCode?: number, timeoutMs?: number): Promise<string> {
  const diagnostic = await readDiagnosticLog(logPath);
  const prefix = timeoutMs
    ? `mongod 在 ${timeoutMs / 1000} 秒内未能启动`
    : `mongod 进程已退出，退出码: ${exitCode}`;

  const friendlyMessage = extractVersionMismatchMessage(diagnostic);
  if (friendlyMessage) {
    return `${prefix}\n\n${friendlyMessage}\n\n--- mongod.log 关键日志 ---\n${diagnostic}`;
  }

  return `${prefix}\n\n--- mongod.log 关键日志 ---\n${diagnostic}`;
}

function extractVersionMismatchMessage(logContent: string): string | null {
  const fcvMatch = logContent.match(/featureCompatibilityVersion[^\n]*version[:"]+\s*"?(\d+\.\d+)/i);
  if (
    logContent.includes("Wrong mongod version") ||
    logContent.includes("UPGRADE PROBLEM") ||
    logContent.includes("featureCompatibilityVersion")
  ) {
    const fcvText = fcvMatch?.[1]
      ? `当前备份的 featureCompatibilityVersion 为 ${fcvMatch[1]}。`
      : "当前备份的 featureCompatibilityVersion 与所选 mongod 版本不兼容。";
    return `${fcvText} 请改用与备份源一致或兼容的 MongoDB 版本启动临时实例。`;
  }

  return null;
}

async function readDiagnosticLog(logPath: string): Promise<string> {
  try {
    const content = await fs.readFile(logPath, "utf-8");
    const allLines = content.split("\n").filter(Boolean);
    const keywords = [
      "Wrong mongod version",
      "featureCompatibilityVersion",
      "UPGRADE PROBLEM",
      '"s":"F"',
      '"s":"E"',
    ];

    const matched = allLines.filter((line) => keywords.some((keyword) => line.includes(keyword)));
    if (matched.length > 0) {
      return matched.slice(0, 20).join("\n");
    }

    return allLines.slice(-50).join("\n");
  } catch {
    return "(无法读取日志文件)";
  }
}

async function readLatestLogLine(logPath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(logPath, "utf-8");
    const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
    return lines.at(-1) || null;
  } catch {
    return null;
  }
}

async function cleanForStartup(dbPath: string): Promise<string[]> {
  const messages: string[] = [];

  // NOTE: Do NOT delete the local/ directory — WiredTiger metadata references files
  // inside it, and deleting them causes "No such file or directory" fatal errors.
  // mongod starts fine in standalone mode (without --replSet) even with replica set
  // config in local.system.replset.

  try {
    await fs.unlink(path.join(dbPath, "mongod.lock"));
    console.log("Removed mongod.lock");
    messages.push("Removed stale mongod.lock");
  } catch {}

  try {
    await fs.unlink(path.join(dbPath, "WiredTiger.lock"));
    console.log("Removed WiredTiger.lock");
    messages.push("Removed stale WiredTiger.lock");
  } catch {}

  try {
    const storageBson = path.join(dbPath, "storage.bson");
    await fs.access(storageBson);
    await fs.unlink(storageBson);
    console.log("Removed storage.bson (prevents version conflicts)");
    messages.push("Removed storage.bson to avoid version conflicts");
  } catch {}

  return messages;
}

export async function stopAllInstances(): Promise<void> {
  for (const [id] of instances) {
    await stopMongod(id);
  }
}
