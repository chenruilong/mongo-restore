import path from "path";
import fs from "fs/promises";
import { v4 as uuid } from "uuid";

export const UPLOAD_DIR = process.env.UPLOAD_DIR || "/tmp/backups";
export const DATA_DIR = process.env.DATA_DIR || "/tmp/backup-data";

// MongoDB versions available in the Docker image
// Maps version string to mongod binary path
export const MONGO_VERSIONS: Record<string, string> = {
  "4.2": process.env.MONGOD_4_2 || "/opt/mongodb/4.2/bin/mongod",
  "8.0": process.env.MONGOD_8_0 || "/opt/mongodb/8.0/bin/mongod",
};

export const DEFAULT_MONGO_VERSION = "8.0";

export function getConfiguredMongoVersions(): { version: string; path: string }[] {
  return Object.entries(MONGO_VERSIONS).map(([version, binaryPath]) => ({ version, path: binaryPath }));
}

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export function generateId(): string {
  return uuid();
}

export function getUploadPath(backupId: string): string {
  return path.join(UPLOAD_DIR, backupId);
}

export function getDataPath(backupId: string): string {
  return path.join(DATA_DIR, backupId);
}

export function detectFormat(filename: string): { type: "physical" | "logical"; format: string } {
  if (filename.endsWith(".tar.zst") || filename.endsWith(".tar.zst")) {
    return { type: "logical", format: "tar.zst" };
  }
  if (filename.endsWith(".archive.gz") || filename.endsWith(".archive")) {
    return { type: "logical", format: "mongodump-archive" };
  }
  if (filename === "backup.tar.gz") {
    return { type: "logical", format: "tar.gz" };
  }
  if (filename.endsWith("_qp.xb") || filename.endsWith(".xb")) {
    return { type: "physical", format: "xbstream" };
  }
  if (filename.endsWith(".tar.gz") || filename.endsWith(".tgz")) {
    return { type: "physical", format: "tar.gz" };
  }
  if (filename.endsWith(".dump")) {
    return { type: "logical", format: "mongodump-archive" };
  }
  if (filename.endsWith(".bson") || filename.endsWith(".bson.gz")) {
    return { type: "logical", format: "mongodump-dir" };
  }
  if (filename.endsWith(".gz")) {
    return { type: "logical", format: "mongodump-archive" };
  }
  return { type: "logical", format: "mongodump-archive" };
}

export function getRandomPort(): number {
  return 27100 + Math.floor(Math.random() * 900);
}
