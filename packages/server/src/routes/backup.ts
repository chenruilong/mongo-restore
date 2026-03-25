import { Hono } from "hono";
import { backups } from "./upload";
import { parseLogicalBackup, parseArchiveBackup } from "../services/logical-parser";
import { extractArchive, isLogicalBackup } from "../lib/archive";
import { getAvailableVersions, startMongod } from "../lib/mongod-manager";
import { DEFAULT_MONGO_VERSION, ensureDir, getDataPath } from "../lib/utils";
import { taskManager } from "../services/task-manager";
import type { BackupTree, MongodConfig } from "../types";

// Cache parsed trees
const treeCache = new Map<string, BackupTree>();

const app = new Hono();

// Get backup metadata
app.get("/:id", (c) => {
  const backup = backups.get(c.req.param("id"));
  if (!backup) return c.json({ error: "Backup not found" }, 404);
  return c.json(backup);
});

// Get parsed backup tree
app.get("/:id/tree", async (c) => {
  const backupId = c.req.param("id");
  const backup = backups.get(backupId);
  if (!backup) return c.json({ error: "Backup not found" }, 404);

  if (treeCache.has(backupId)) {
    return c.json(treeCache.get(backupId));
  }

  try {
    backup.status = "extracting";
    const filePath = backup.extractedPath!;
    let tree: BackupTree;

    if (backup.type === "physical") {
      const { extractedPath } = await extractArchive({
        backupId,
        filePath,
        format: backup.format,
        onProgress: (msg) => console.log(`[${backupId}] ${msg}`),
      });

      const logicalBackup = await isLogicalBackup(extractedPath);
      console.log(
        `[backup/tree] backupId=${backupId}, extractedPath=${extractedPath}, logicalBackup=${logicalBackup}`
      );

      if (logicalBackup) {
        backup.type = "logical";
        backup.extractedPath = extractedPath;
        tree = await parseLogicalBackup(backupId, extractedPath);
      } else {
        backup.extractedPath = extractedPath;
        backup.status = "parsing";
        return c.json(
          {
            error: "Physical backup detected. Please start mongod first via POST /api/backups/:id/start-mongod",
            type: "physical",
            requiresMongod: true,
          },
          400
        );
      }
    } else {
      backup.status = "parsing";
      if (backup.format === "tar.gz" || filePath.endsWith(".tar.gz") || filePath.endsWith(".tgz")) {
        const { extractedPath } = await extractArchive({
          backupId,
          filePath,
          format: "tar.gz",
        });
        backup.extractedPath = extractedPath;
        tree = await parseLogicalBackup(backupId, extractedPath);
      } else if (
        backup.format === "mongodump-archive" ||
        filePath.endsWith(".archive") ||
        filePath.endsWith(".gz")
      ) {
        return c.json(
          {
            error: "Archive backup detected. Please start mongod first via POST /api/backups/:id/start-mongod",
            type: "logical",
            requiresMongod: true,
          },
          400
        );
      } else {
        tree = await parseLogicalBackup(backupId, filePath);
      }
    }

    backup.status = "ready";
    treeCache.set(backupId, tree);
    return c.json(tree);
  } catch (error: any) {
    backup.status = "error";
    backup.error = error.message;
    return c.json({ error: error.message }, 500);
  }
});

app.post("/:id/start-mongod", async (c) => {
  const backupId = c.req.param("id");
  const backup = backups.get(backupId);
  if (!backup) return c.json({ error: "Backup not found" }, 404);

  const body = await c
    .req.json<{ version?: string; extraArgs?: string[] }>()
    .catch(() => ({ version: undefined, extraArgs: undefined }));

  const config: MongodConfig = {
    version: body.version || DEFAULT_MONGO_VERSION,
    extraArgs: body.extraArgs || [],
  };

  const task = taskManager.createTask(backupId, "start-mongod");
  taskManager.updateTask(task.id, {
    status: "pending",
    progress: 0,
    currentStep: "Preparing mongod startup",
  });
  taskManager.appendLog(task.id, {
    level: "info",
    message: `Starting MongoDB ${config.version} for backup ${backupId}`,
  });

  runStartMongodTask(backupId, config, task.id).catch((error: any) => {
    const currentBackup = backups.get(backupId);
    if (currentBackup) {
      currentBackup.status = "error";
      currentBackup.error = error.message;
    }
    taskManager.appendLog(task.id, {
      level: "error",
      message: error.message || String(error),
    });
    taskManager.updateTask(task.id, {
      status: "failed",
      currentStep: "Failed",
      error: error.message || String(error),
    });
  });

  return c.json({ taskId: task.id, status: "pending" });
});

async function runStartMongodTask(backupId: string, config: MongodConfig, taskId: string) {
  const backup = backups.get(backupId);
  if (!backup) {
    throw new Error("Backup not found");
  }

  let tree: BackupTree;

  taskManager.updateTask(taskId, {
    status: "running",
    progress: 10,
    currentStep: "Checking backup type",
  });
  taskManager.appendLog(taskId, {
    level: "info",
    message: `Backup type ${backup.type}, format ${backup.format}`,
  });

  if (backup.type === "physical") {
    let dbPath = backup.extractedPath!;

    if (!dbPath.endsWith("/") && (backup.format === "xbstream" || backup.format === "tar.gz")) {
      taskManager.updateTask(taskId, {
        status: "running",
        progress: 25,
        currentStep: "Extracting backup archive",
      });
      taskManager.appendLog(taskId, { level: "info", message: "Extracting backup archive" });

      const { extractedPath } = await extractArchive({
        backupId,
        filePath: dbPath,
        format: backup.format,
        onProgress: (msg) => taskManager.appendLog(taskId, { level: "info", message: msg }),
      });
      backup.extractedPath = extractedPath;
      dbPath = extractedPath;
    }

    taskManager.updateTask(taskId, {
      status: "running",
      progress: 55,
      currentStep: "Starting mongod instance",
    });
    taskManager.appendLog(taskId, {
      level: "info",
      message: `Launching mongod ${config.version}`,
    });

    const mongodHooks = {
      onInfo: (message: string) => taskManager.appendLog(taskId, { level: "info", message }),
    };
    const { port, version } = await startMongod(backupId, dbPath, config, mongodHooks);
    backup.mongodPort = port;
    backup.mongoVersion = version;
    backup.mongodArgs = config.extraArgs;

    taskManager.appendLog(taskId, {
      level: "info",
      message: `mongod is ready on port ${port} (version ${version})`,
    });
    taskManager.updateTask(taskId, {
      status: "running",
      progress: 85,
      currentStep: "Reading backup metadata",
    });

    const client = await import("mongodb");
    const mongo = new client.MongoClient(`mongodb://127.0.0.1:${port}`, {
      serverSelectionTimeoutMS: 10000,
    });

    try {
      taskManager.appendLog(taskId, { level: "info", message: `Connecting to mongod at 127.0.0.1:${port}` });
      await mongo.connect();
      taskManager.appendLog(taskId, { level: "info", message: "Connected successfully" });

      const adminDb = mongo.db("admin");
      const dbListResult = await adminDb.command({ listDatabases: 1 });
      const allDbs = dbListResult.databases as Array<{ name: string; sizeOnDisk?: number }>;
      const filteredDbs = allDbs.filter((d) => !["admin", "local", "config"].includes(d.name));
      taskManager.appendLog(taskId, {
        level: "info",
        message: `Found ${allDbs.length} database(s), ${filteredDbs.length} after filtering system dbs`,
      });

      const databases = [] as BackupTree["databases"];

      for (const dbInfo of filteredDbs) {
        const dbName = dbInfo.name;

        taskManager.appendLog(taskId, {
          level: "info",
          message: `Inspecting database "${dbName}" (sizeOnDisk: ${dbInfo.sizeOnDisk ?? "unknown"})`,
        });

        const db = mongo.db(dbName);
        const collectionsCursor = await db.listCollections().toArray();
        const collections = [] as NonNullable<BackupTree["databases"]>[number]["collections"];

        for (const col of collectionsCursor) {
          const stats = await db.command({ collStats: col.name }).catch(() => null);
          collections.push({
            name: col.name,
            size: stats?.size,
            count: stats?.count,
          });
        }

        taskManager.appendLog(taskId, {
          level: "info",
          message: `Database "${dbName}": ${collections.length} collection(s)`,
        });

        databases.push({
          name: dbName,
          sizeOnDisk: dbInfo.sizeOnDisk,
          collections,
        });
      }

      tree = { backupId, type: "physical", databases };
    } finally {
      await mongo.close();
    }
  } else {
    taskManager.updateTask(taskId, {
      status: "running",
      progress: 25,
      currentStep: "Preparing temporary data path",
    });

    const tmpDbPath = getDataPath(backupId);
    await ensureDir(tmpDbPath);
    taskManager.appendLog(taskId, {
      level: "info",
      message: `Using temporary data path ${tmpDbPath}`,
    });

    taskManager.updateTask(taskId, {
      status: "running",
      progress: 55,
      currentStep: "Starting mongod instance",
    });
    const logicalHooks = {
      onInfo: (message: string) => taskManager.appendLog(taskId, { level: "info", message }),
    };
    const { port, version } = await startMongod(backupId, tmpDbPath, config, logicalHooks);
    backup.mongodPort = port;
    backup.mongoVersion = version;
    backup.mongodArgs = config.extraArgs;

    taskManager.appendLog(taskId, {
      level: "info",
      message: `mongod is ready on port ${port} (version ${version})`,
    });

    taskManager.updateTask(taskId, {
      status: "running",
      progress: 80,
      currentStep: "Restoring archive into mongod",
    });
    taskManager.appendLog(taskId, {
      level: "info",
      message: `Restoring archive ${backup.extractedPath} into temporary mongod on port ${port}`,
    });

    tree = await parseArchiveBackup(backupId, backup.extractedPath!, port, (msg) =>
      taskManager.appendLog(taskId, { level: "info", message: msg })
    );
  }

  backup.status = "ready";
  treeCache.set(backupId, tree);
  taskManager.setResult(taskId, {
    port: backup.mongodPort!,
    version: backup.mongoVersion!,
    tree,
  });
  taskManager.appendLog(taskId, {
    level: "info",
    message: `Parsed ${tree.databases.length} database(s)`,
  });
  taskManager.updateTask(taskId, {
    status: "completed",
    progress: 100,
    currentStep: "mongod ready",
  });
}

// Get available MongoDB versions
app.get("/config/mongo-versions", async (c) => {
  const versions = await getAvailableVersions();
  return c.json({
    versions,
    defaultVersion: DEFAULT_MONGO_VERSION,
    platform: process.env.DOCKER_PLATFORM || process.arch,
  });
});

export default app;
