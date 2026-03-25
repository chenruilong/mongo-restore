import { MongoClient } from "mongodb";
import type { BackupTree, DatabaseInfo, CollectionInfo, MongodConfig } from "../types";
import { startMongod, getMongodPort } from "../lib/mongod-manager";

/**
 * Parse a physical backup (WiredTiger data files) by starting a temporary mongod.
 */
export async function parsePhysicalBackup(
  backupId: string,
  dbPath: string,
  config?: MongodConfig
): Promise<BackupTree> {
  // Start temporary mongod on the extracted data
  const { port, version } = await startMongod(backupId, dbPath, config);

  // Connect and list databases/collections
  const client = new MongoClient(`mongodb://127.0.0.1:${port}`, {
    serverSelectionTimeoutMS: 10000,
  });

  try {
    await client.connect();

    const adminDb = client.db("admin");
    const dbListResult = await adminDb.command({ listDatabases: 1 });

    const databases: DatabaseInfo[] = [];

    for (const dbInfo of dbListResult.databases) {
      const dbName = dbInfo.name;
      // Skip local and config databases
      if (dbName === "local" || dbName === "config") continue;

      const db = client.db(dbName);
      const collectionsCursor = await db.listCollections().toArray();

      const collections: CollectionInfo[] = [];
      for (const col of collectionsCursor) {
        const stats = await db.command({ collStats: col.name }).catch(() => null);
        collections.push({
          name: col.name,
          size: stats?.size,
          count: stats?.count,
        });
      }

      databases.push({
        name: dbName,
        sizeOnDisk: dbInfo.sizeOnDisk,
        collections,
      });
    }

    return { backupId, type: "physical", databases };
  } finally {
    await client.close();
  }
}
