import fs from "fs/promises";
import path from "path";
import type { BackupTree, DatabaseInfo, CollectionInfo } from "../types";

/**
 * Parse a mongodump directory backup.
 * Directory structure:
 *   <root>/
 *     <database>/
 *       <collection>.bson
 *       <collection>.metadata.json
 */
export async function parseLogicalBackup(backupId: string, dirPath: string): Promise<BackupTree> {
  const databases: DatabaseInfo[] = [];

  // Find the actual dump root — might be nested one level
  const rootDir = await findDumpRoot(dirPath);
  console.log(`[parseLogicalBackup] dirPath=${dirPath}, rootDir=${rootDir}`);

  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  console.log(`[parseLogicalBackup] entries in rootDir:`, entries.map(e => e.name));

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip system databases in listing (but still include them)
    const dbName = entry.name;
    const dbPath = path.join(rootDir, dbName);
    const collections = await parseCollections(dbPath);

    if (collections.length > 0) {
      databases.push({
        name: dbName,
        collections,
      });
    }
  }

  return { backupId, type: "logical", databases };
}

async function parseCollections(dbPath: string): Promise<CollectionInfo[]> {
  const collections: CollectionInfo[] = [];
  const files = await fs.readdir(dbPath);

  const bsonFiles = files.filter((f) => f.endsWith(".bson") || f.endsWith(".bson.gz"));

  for (const bsonFile of bsonFiles) {
    const collName = bsonFile.replace(/\.bson(\.gz)?$/, "");
    const filePath = path.join(dbPath, bsonFile);
    const stat = await fs.stat(filePath);

    collections.push({
      name: collName,
      size: stat.size,
      bsonPath: filePath,
    });
  }

  return collections;
}

/**
 * Find the actual mongodump root directory.
 * Sometimes archives extract to a nested directory.
 */
async function findDumpRoot(dirPath: string): Promise<string> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  // Check if current dir has .bson files at any depth
  const hasBson = entries.some((e) => e.name.endsWith(".bson") || e.name.endsWith(".bson.gz"));
  if (hasBson) {
    // .bson files at this level — parent is the root
    return path.dirname(dirPath);
  }

  // Check if subdirectories contain .bson files (standard layout)
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subEntries = await fs.readdir(path.join(dirPath, entry.name));
      if (subEntries.some((f) => f.endsWith(".bson") || f.endsWith(".bson.gz"))) {
        return dirPath;
      }
    }
  }

  // Maybe there's only one subdirectory (extracted archive nesting)
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 1) {
    return findDumpRoot(path.join(dirPath, dirs[0].name));
  }

  return dirPath;
}

/**
 * Parse a mongodump --archive file by running mongorestore --dryRun.
 */
export async function parseArchiveBackup(
  backupId: string,
  archivePath: string,
  mongodPort?: number,
  onProgress?: (message: string) => void,
): Promise<BackupTree> {
  console.log(`[parseArchiveBackup] backupId=${backupId}, archivePath=${archivePath}, mongodPort=${mongodPort}`);

  if (!mongodPort) {
    throw new Error("MongoDB instance required to parse archive. Please start mongod first.");
  }

  // Restore archive to the provided mongod instance
  const restoreArgs = [
    "mongorestore",
    `--host=127.0.0.1`,
    `--port=${mongodPort}`,
    `--archive=${archivePath}`,
  ];

  if (archivePath.endsWith(".gz")) {
    restoreArgs.push("--gzip");
    onProgress?.("Archive is gzip-compressed, adding --gzip flag");
  }

  onProgress?.(`Running mongorestore: ${restoreArgs.join(" ")}`);

  const restoreProc = Bun.spawn(restoreArgs, { stdout: "pipe", stderr: "pipe" });

  // Stream stderr for progress
  const decoder = new TextDecoder();
  const reader = restoreProc.stderr.getReader();
  let stderrOutput = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      stderrOutput += text;
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) {
        onProgress?.(`[mongorestore] ${line.trim()}`);
      }
    }
  } catch {}

  const restoreExit = await restoreProc.exited;

  if (restoreExit !== 0) {
    throw new Error(`Failed to restore archive: ${stderrOutput}`);
  }

  onProgress?.("mongorestore completed successfully");

  // Parse databases from mongod
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(`mongodb://127.0.0.1:${mongodPort}`);

  onProgress?.(`Connecting to mongod at 127.0.0.1:${mongodPort} to list databases`);
  await client.connect();

  try {
    const adminDb = client.db("admin");
    const dbList = await adminDb.admin().listDatabases();

    const allDbs = dbList.databases as Array<{ name: string; sizeOnDisk?: number }>;
    const filteredDbs = allDbs.filter((d) => !["admin", "local", "config"].includes(d.name));
    onProgress?.(`Found ${allDbs.length} database(s), ${filteredDbs.length} after filtering system dbs`);

    const databases: DatabaseInfo[] = [];

    for (const dbInfo of filteredDbs) {
      onProgress?.(`Inspecting database "${dbInfo.name}"`);

      const db = client.db(dbInfo.name);
      const colls = await db.listCollections().toArray();

      const collections: CollectionInfo[] = colls.map(c => ({
        name: c.name,
        size: 0,
      }));

      if (collections.length > 0) {
        databases.push({
          name: dbInfo.name,
          collections,
        });
      }

      onProgress?.(`Database "${dbInfo.name}": ${collections.length} collection(s)`);
    }

    console.log(`[parseArchiveBackup] parsed databases:`, databases);

    return { backupId, type: "logical", databases };
  } finally {
    await client.close();
  }
}
