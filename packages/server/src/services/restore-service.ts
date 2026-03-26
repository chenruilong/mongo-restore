import path from "path";
import fs from "fs/promises";
import type {
  BackupMeta,
  SelectedItem,
  RestoreTarget,
  DownloadFormat,
  RemoteConnectionConfig,
} from "../types";
import { taskManager } from "./task-manager";
import { getMongodPort } from "../lib/mongod-manager";
import { ensureDir, getDataPath } from "../lib/utils";

/**
 * Execute a restore operation based on backup type and target.
 */
export async function executeRestore(
  backup: BackupMeta,
  selected: SelectedItem[],
  target: RestoreTarget,
  taskId: string,
): Promise<void> {
  taskManager.updateTask(taskId, {
    status: "running",
    progress: 0,
    currentStep: "Preparing restore",
  });
  taskManager.appendLog(taskId, {
    level: "info",
    message: `Starting restore for ${selected.length} item(s)`,
  });

  try {
    if (target.type === "remote") {
      taskManager.appendLog(taskId, {
        level: "info",
        message: "Target mode: remote MongoDB",
      });

      if (backup.type === "logical") {
        await restoreLogicalToRemote(
          backup,
          selected,
          target.connection,
          taskId,
        );
      } else {
        await restorePhysicalToRemote(
          backup,
          selected,
          target.connection,
          taskId,
        );
      }

      taskManager.updateTask(taskId, {
        status: "completed",
        progress: 100,
        currentStep: "Done",
      });
      taskManager.appendLog(taskId, {
        level: "info",
        message: "Restore completed successfully",
      });
    } else {
      const format = target.format;
      taskManager.appendLog(taskId, {
        level: "info",
        message: `Target mode: download (format: ${format})`,
      });

      if (backup.type === "logical") {
        await prepareLogicalDownload(backup, selected, taskId, format);
      } else {
        await preparePhysicalDownload(backup, selected, taskId, format);
      }

      taskManager.updateTask(taskId, {
        status: "completed",
        progress: 100,
        currentStep: "Done",
      });
      taskManager.appendLog(taskId, {
        level: "info",
        message: "Download package is ready",
      });
    }
  } catch (error: any) {
    taskManager.appendLog(taskId, {
      level: "error",
      message: error.message || String(error),
    });
    taskManager.updateTask(taskId, {
      status: "failed",
      error: error.message || String(error),
      currentStep: "Failed",
    });
  }
}

async function restoreLogicalToRemote(
  backup: BackupMeta,
  selected: SelectedItem[],
  connection: RemoteConnectionConfig,
  taskId: string,
) {
  const targetDb = connection.database;
  const uri = buildMongoUri(connection);

  const nsIncludes = buildNsIncludes(selected);
  let extractedPath = backup.extractedPath!;

  let args: string[];
  if (backup.format === "mongodump-archive") {
    args = [
      "mongorestore",
      `--uri=${uri}`,
      `--archive=${extractedPath}`,
      "--gzip",
      "--drop",
      "--numParallelCollections=10",
      "--numInsertionWorkersPerCollection=5",
      ...nsIncludes,
    ];
  } else {
    const dumpDir = path.join(extractedPath, "dump");
    try {
      await fs.access(dumpDir);
      extractedPath = dumpDir;
    } catch {}

    args = [
      "mongorestore",
      `--uri=${uri}`,
      `--dir=${extractedPath}`,
      "--drop",
      "--numParallelCollections=10",
      "--numInsertionWorkersPerCollection=5",
      ...nsIncludes,
    ];

    if (backup.filename.endsWith(".gz")) {
      args.push("--gzip");
    }
  }

  if (targetDb && selected.length === 1 && !selected[0].collection) {
    args.push(`--nsFrom=${selected[0].database}.*`);
    args.push(`--nsTo=${targetDb}.*`);
  }

  taskManager.updateTask(taskId, {
    currentStep: "Running mongorestore",
    progress: 15,
  });
  taskManager.appendLog(taskId, {
    level: "info",
    message: `Executing: ${args.join(" ")}`,
  });

  await runCommandWithLogs(args, taskId);
}

async function restorePhysicalToRemote(
  backup: BackupMeta,
  selected: SelectedItem[],
  connection: RemoteConnectionConfig,
  taskId: string,
) {
  const port = getMongodPort(backup.id);
  if (!port) {
    throw new Error(
      "No mongod instance running for this backup. Please start mongod first.",
    );
  }

  const targetDb = connection.database;
  const uri = buildMongoUri(connection);

  const total = selected.length;
  let completed = 0;

  // 收集需要删除的数据库（只恢复整个数据库时才删除）
  const databasesToDrop = new Set<string>();
  for (const item of selected) {
    if (!item.collection) {
      databasesToDrop.add(item.database); // 源数据库
      if (targetDb && targetDb !== item.database) {
        databasesToDrop.add(targetDb); // 目标数据库
      }
    }
  }

  // 先删除这些数据库
  for (const db of databasesToDrop) {
    taskManager.appendLog(taskId, {
      level: "info",
      message: `Dropping database ${db} before restore`,
    });
    await dropDatabaseViaConnection(connection, db);
  }

  // 等待删除操作完成
  if (databasesToDrop.size > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  for (const item of selected) {
    const stepDesc = item.collection
      ? `Restoring ${item.database}.${item.collection}`
      : `Restoring ${item.database}.*`;

    taskManager.updateTask(taskId, {
      currentStep: stepDesc,
      progress: Math.round((completed / total) * 100),
    });
    taskManager.appendLog(taskId, {
      level: "info",
      message: stepDesc,
    });

    const tmpArchive = path.join(
      "/tmp",
      `dump-${item.database}-${Date.now()}.archive.gz`,
    );

    const dumpArgs = [
      "mongodump",
      "--host=127.0.0.1",
      `--port=${port}`,
      `--db=${item.database}`,
      ...(item.collection ? [`--collection=${item.collection}`] : []),
      `--archive=${tmpArchive}`,
      "--gzip",
      "--verbose",
    ];

    taskManager.appendLog(taskId, {
      level: "info",
      message: `Executing dump: ${dumpArgs.join(" ")}`,
    });

    await runCommandWithLogs(dumpArgs, taskId, "mongodump");

    taskManager.updateTask(taskId, {
      currentStep: `Dumped ${item.database}, starting restore...`,
      progress:
        Math.round((completed / total) * 100) + Math.round((1 / total) * 50),
    });

    const restoreArgs = [
      "mongorestore",
      `--uri=${uri}`,
      `--archive=${tmpArchive}`,
      "--gzip",
      "--drop",
      "--numParallelCollections=10",
      "--numInsertionWorkersPerCollection=5",
      "--verbose",
    ];

    taskManager.appendLog(taskId, {
      level: "info",
      message: `Executing restore: ${restoreArgs.join(" ")}`,
    });

    try {
      await runCommandWithLogs(restoreArgs, taskId, "mongorestore");
    } finally {
      await fs.unlink(tmpArchive).catch(() => {});
    }

    if (targetDb && targetDb !== item.database && !item.collection) {
      taskManager.appendLog(taskId, {
        level: "info",
        message: `Renaming database ${item.database} -> ${targetDb}`,
      });
      await renameDatabaseViaConnection(connection, item.database, targetDb);
    }

    completed++;
    taskManager.updateTask(taskId, {
      progress: Math.round((completed / total) * 100),
    });
  }
}

async function prepareLogicalDownload(
  backup: BackupMeta,
  selected: SelectedItem[],
  taskId: string,
  format: DownloadFormat,
) {
  const downloadDir = path.join(getDataPath(backup.id), "download");
  await ensureDir(downloadDir);
  const extractedPath = backup.extractedPath!;

  if (format === "json") {
    const port = getMongodPort(backup.id);
    if (!port) {
      throw new Error("JSON 导出需要运行中的 MongoDB 实例，请先启动 mongod");
    }
    await exportJson(port, selected, downloadDir, taskId);
    return;
  }

  if (format === "gzip") {
    const outputFile = path.join(downloadDir, "backup.archive.gz");

    if (backup.format === "mongodump-archive") {
      taskManager.updateTask(taskId, {
        currentStep: "Preparing download...",
        progress: 50,
      });
      taskManager.appendLog(taskId, {
        level: "info",
        message: `Copying archive to ${outputFile}`,
      });
      await fs.copyFile(extractedPath, outputFile);
      taskManager.updateTask(taskId, {
        downloadPath: outputFile,
        progress: 100,
      });
      return;
    }

    // Non-archive logical backup: use mongodump --archive if mongod is running, otherwise fall through to bson
    const port = getMongodPort(backup.id);
    if (port) {
      await dumpAsArchive(port, selected, outputFile, taskId);
      return;
    }

    // No mongod — package bson files as archive via tar then convert is not possible,
    // fall through to bson packaging
  }

  // format === "bson" or gzip fallback for non-archive without mongod
  const outputFile = path.join(downloadDir, "backup.tar.gz");
  taskManager.updateTask(taskId, {
    currentStep: "Creating archive...",
    progress: 50,
  });
  taskManager.appendLog(taskId, {
    level: "info",
    message: "Collecting selected BSON files",
  });

  const dumpRoot = path.join(downloadDir, "dump");
  await ensureDir(dumpRoot);

  for (const item of selected) {
    const sourceDbDir = path.join(extractedPath, item.database);
    const targetDbDir = path.join(dumpRoot, item.database);
    await ensureDir(targetDbDir);

    if (item.collection) {
      taskManager.appendLog(taskId, {
        level: "info",
        message: `Copying ${item.database}.${item.collection}`,
      });
      const fileNames = [
        `${item.collection}.bson`,
        `${item.collection}.bson.gz`,
        `${item.collection}.metadata.json`,
        `${item.collection}.metadata.json.gz`,
      ];
      for (const fileName of fileNames) {
        const sourceFile = path.join(sourceDbDir, fileName);
        try {
          await fs.copyFile(sourceFile, path.join(targetDbDir, fileName));
        } catch {}
      }
    } else {
      taskManager.appendLog(taskId, {
        level: "info",
        message: `Copying database ${item.database}`,
      });
      await fs.cp(sourceDbDir, targetDbDir, { recursive: true });
    }
  }

  taskManager.updateTask(taskId, { currentStep: "Packaging...", progress: 90 });
  await runCommandWithLogs(
    ["tar", "czf", outputFile, "-C", downloadDir, "dump"],
    taskId,
    "tar",
  );
  taskManager.updateTask(taskId, { downloadPath: outputFile, progress: 100 });
}

async function preparePhysicalDownload(
  backup: BackupMeta,
  selected: SelectedItem[],
  taskId: string,
  format: DownloadFormat,
) {
  const port = getMongodPort(backup.id);
  if (!port) {
    throw new Error(
      "No mongod instance running for this backup. Please start mongod first.",
    );
  }

  const downloadDir = path.join(getDataPath(backup.id), "download");
  await ensureDir(downloadDir);

  if (format === "json") {
    await exportJson(port, selected, downloadDir, taskId);
    return;
  }

  if (format === "bson") {
    await dumpAsBson(port, selected, downloadDir, taskId);
    return;
  }

  // format === "gzip"
  const outputFile = path.join(downloadDir, "backup.archive.gz");
  await dumpAsArchive(port, selected, outputFile, taskId);
}

/** mongodump --archive --gzip */
async function dumpAsArchive(
  port: number,
  selected: SelectedItem[],
  outputFile: string,
  taskId: string,
) {
  taskManager.updateTask(taskId, {
    currentStep: "Dumping as archive...",
    progress: 10,
  });

  const args = [
    "mongodump",
    "--host=127.0.0.1",
    `--port=${port}`,
    `--archive=${outputFile}`,
    "--gzip",
  ];

  for (const item of selected) {
    args.push(`--db=${item.database}`);
    if (item.collection) {
      args.push(`--collection=${item.collection}`);
    }
  }

  taskManager.appendLog(taskId, {
    level: "info",
    message: `Executing: ${args.join(" ")}`,
  });
  await runCommandWithLogs(args, taskId, "mongodump");
  taskManager.updateTask(taskId, { downloadPath: outputFile, progress: 100 });
}

/** mongodump --out=dir, then tar.gz */
async function dumpAsBson(
  port: number,
  selected: SelectedItem[],
  downloadDir: string,
  taskId: string,
) {
  const dumpRoot = path.join(downloadDir, "dump");
  await ensureDir(dumpRoot);
  const outputFile = path.join(downloadDir, "backup.tar.gz");

  taskManager.updateTask(taskId, {
    currentStep: "Dumping as BSON...",
    progress: 10,
  });

  const args = [
    "mongodump",
    "--host=127.0.0.1",
    `--port=${port}`,
    `--out=${dumpRoot}`,
  ];

  for (const item of selected) {
    args.push(`--db=${item.database}`);
    if (item.collection) {
      args.push(`--collection=${item.collection}`);
    }
  }

  taskManager.appendLog(taskId, {
    level: "info",
    message: `Executing: ${args.join(" ")}`,
  });
  await runCommandWithLogs(args, taskId, "mongodump");

  taskManager.updateTask(taskId, {
    currentStep: "Packaging BSON files...",
    progress: 80,
  });
  await runCommandWithLogs(
    ["tar", "czf", outputFile, "-C", downloadDir, "dump"],
    taskId,
    "tar",
  );
  taskManager.updateTask(taskId, { downloadPath: outputFile, progress: 100 });
}

/** mongoexport for each collection, then tar.gz */
async function exportJson(
  port: number,
  selected: SelectedItem[],
  downloadDir: string,
  taskId: string,
) {
  const exportRoot = path.join(downloadDir, "export");
  await ensureDir(exportRoot);
  const outputFile = path.join(downloadDir, "backup.tar.gz");

  taskManager.updateTask(taskId, {
    currentStep: "Exporting as JSON...",
    progress: 10,
  });

  // Expand database-level selections to individual collections
  const items: Array<{ database: string; collection: string }> = [];

  for (const sel of selected) {
    if (sel.collection) {
      items.push({ database: sel.database, collection: sel.collection });
    } else {
      // List collections from mongod
      const { MongoClient } = await import("mongodb");
      const client = new MongoClient(`mongodb://127.0.0.1:${port}`);
      try {
        await client.connect();
        const colls = await client.db(sel.database).listCollections().toArray();
        for (const c of colls) {
          items.push({ database: sel.database, collection: c.name });
        }
      } finally {
        await client.close();
      }
    }
  }

  taskManager.appendLog(taskId, {
    level: "info",
    message: `Exporting ${items.length} collection(s) as JSON`,
  });

  for (let i = 0; i < items.length; i++) {
    const { database, collection } = items[i];
    const dbDir = path.join(exportRoot, database);
    await ensureDir(dbDir);
    const outFile = path.join(dbDir, `${collection}.json`);

    taskManager.updateTask(taskId, {
      currentStep: `Exporting ${database}.${collection}`,
      progress: 10 + Math.round((i / items.length) * 70),
    });

    const args = [
      "mongoexport",
      "--host=127.0.0.1",
      `--port=${port}`,
      `--db=${database}`,
      `--collection=${collection}`,
      `--out=${outFile}`,
      "--jsonArray",
    ];

    taskManager.appendLog(taskId, {
      level: "info",
      message: `Executing: ${args.join(" ")}`,
    });
    await runCommandWithLogs(args, taskId, "mongoexport");
  }

  taskManager.updateTask(taskId, {
    currentStep: "Packaging JSON files...",
    progress: 85,
  });
  await runCommandWithLogs(
    ["tar", "czf", outputFile, "-C", downloadDir, "export"],
    taskId,
    "tar",
  );
  taskManager.updateTask(taskId, { downloadPath: outputFile, progress: 100 });
}

async function runCommandWithLogs(
  args: string[],
  taskId: string,
  label?: string,
) {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const logsPromise = streamProcessOutput(proc, taskId, label ?? args[0]);
  const [exitCode, logs] = await Promise.all([proc.exited, logsPromise]);

  if (exitCode !== 0) {
    // mongorestore 特殊处理：如果有文档成功恢复且无失败，忽略 EOF 错误
    if (args[0] === "mongorestore") {
      const output = logs.stderr + logs.stdout;
      const successMatch = output.match(
        /(\d+) document\(s\) restored successfully\. (\d+) document\(s\) failed/,
      );
      if (
        successMatch &&
        parseInt(successMatch[1]) > 0 &&
        successMatch[2] === "0"
      ) {
        return;
      }
    }
    throw new Error(`${args[0]} failed: ${logs.stderr || logs.stdout}`);
  }
}

async function streamProcessOutput(
  proc: Bun.Subprocess,
  taskId: string,
  label: string,
): Promise<{ stdout: string; stderr: string }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const stdoutStream =
    proc.stdout instanceof ReadableStream ? proc.stdout : null;
  const stderrStream =
    proc.stderr instanceof ReadableStream ? proc.stderr : null;

  const stdoutPromise = readStreamLines(stdoutStream, (line) => {
    stdoutChunks.push(line);
    console.log("[STDOUT]", line);
    taskManager.appendLog(taskId, {
      level: "info",
      message: `[${label}] ${line}`,
    });
  });

  const stderrPromise = readStreamLines(stderrStream, (line) => {
    stderrChunks.push(line);
    const level = lineLooksLikeError(line) ? "error" : "info";
    console.log("[STDERR]", level, line);
    taskManager.appendLog(taskId, {
      level,
      message: `[${label}] ${line}`,
    });
  });

  await Promise.all([stdoutPromise, stderrPromise]);

  return {
    stdout: stdoutChunks.join("\n"),
    stderr: stderrChunks.join("\n"),
  };
}

async function readStreamLines(
  stream: ReadableStream<Uint8Array> | null,
  onLine: (line: string) => void,
) {
  if (!stream) return;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) onLine(trimmed);
    }
  }

  buffer += decoder.decode();
  const trimmed = buffer.trim();
  if (trimmed) onLine(trimmed);
}

async function streamProcessStderr(
  proc: Bun.Subprocess,
  taskId: string,
  label: string,
): Promise<string> {
  const chunks: string[] = [];
  const stderrStream =
    proc.stderr instanceof ReadableStream ? proc.stderr : null;

  await readStreamLines(stderrStream, (line) => {
    chunks.push(line);
    taskManager.appendLog(taskId, {
      level: lineLooksLikeError(line) ? "error" : "stderr",
      message: `[${label}] ${line}`,
    });
  });

  return chunks.join("\n");
}

function lineLooksLikeError(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.includes("error") ||
    lower.includes("failed") ||
    lower.includes("fatal")
  );
}

function buildNsIncludes(selected: SelectedItem[]): string[] {
  return selected.map((s) => {
    if (s.collection) {
      return `--nsInclude=${s.database}.${s.collection}`;
    }
    return `--nsInclude=${s.database}.*`;
  });
}

function buildMongoUri(
  config: RemoteConnectionConfig,
  includeDb?: boolean,
): string {
  const hosts = config.hosts.map((h) => `${h.host}:${h.port}`).join(",");

  let userInfo = "";
  if (config.username) {
    const user = encodeURIComponent(config.username);
    const pass = config.password
      ? `:${encodeURIComponent(config.password)}`
      : "";
    userInfo = `${user}${pass}@`;
  }

  const dbPart = includeDb && config.database ? `/${config.database}` : "/";

  const params: string[] = [];
  if (config.authSource)
    params.push(`authSource=${encodeURIComponent(config.authSource)}`);
  if (config.replicaSet)
    params.push(`replicaSet=${encodeURIComponent(config.replicaSet)}`);
  if (config.tls) params.push("tls=true");
  const query = params.length > 0 ? `?${params.join("&")}` : "";

  return `mongodb://${userInfo}${hosts}${dbPart}${query}`;
}

async function renameDatabaseViaConnection(
  connection: RemoteConnectionConfig,
  sourceDb: string,
  targetDb: string,
): Promise<void> {
  const uri = buildMongoUri(connection, true);
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const sourceDbObj = client.db(sourceDb);
    const collections = await sourceDbObj.listCollections().toArray();

    for (const coll of collections) {
      const sourceCollection = sourceDbObj.collection(coll.name);
      const targetCollection = client.db(targetDb).collection(coll.name);

      const docs = await sourceCollection.find({}).toArray();
      if (docs.length > 0) {
        await targetCollection.insertMany(docs);
      }

      const indexes = await sourceCollection.indexes();
      for (const index of indexes) {
        if (index.name !== "_id_") {
          const { name, ...indexSpec } = index;
          await targetCollection.createIndex(indexSpec.key, indexSpec);
        }
      }
    }

    await sourceDbObj.dropDatabase();
  } finally {
    await client.close();
  }
}

async function dropDatabaseViaConnection(
  connection: RemoteConnectionConfig,
  dbName: string,
): Promise<void> {
  const uri = buildMongoUri(connection, true);
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri);

  try {
    await client.connect();
    await client.db(dbName).dropDatabase();
  } finally {
    await client.close();
  }
}
