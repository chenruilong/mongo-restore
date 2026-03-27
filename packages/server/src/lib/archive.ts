import fs from "fs/promises";
import path from "path";
import { ensureDir, getDataPath } from "./utils";

export interface ExtractOptions {
  backupId: string;
  filePath: string;
  format: string;
  onProgress?: (message: string) => void;
}

export interface ExtractResult {
  extractedPath: string;
}

export async function extractArchive(options: ExtractOptions): Promise<ExtractResult> {
  const { backupId, filePath, format, onProgress } = options;
  const extractedPath = getDataPath(backupId);
  await ensureDir(extractedPath);

  switch (format) {
    case "xbstream":
      return extractXbstream(filePath, extractedPath, onProgress);
    case "tar.gz":
      return extractTarGz(filePath, extractedPath, onProgress);
    case "tar.zst":
      return extractTarZst(filePath, extractedPath, onProgress);
    case "mongodump-dir":
    case "mongodump-archive":
      return { extractedPath: filePath };
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

export async function detectTarGzBackupType(filePath: string): Promise<"physical" | "logical"> {
  const proc = Bun.spawn(["tar", "-tzf", filePath], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Failed to inspect tar.gz archive: ${stderr}`);
  }

  const entries = stdout.split("\n").filter(Boolean);
  const isLogical = entries.some((entry) => {
    return entry.endsWith(".bson") || entry.endsWith(".bson.gz") || entry.endsWith(".metadata.json");
  });

  return isLogical ? "logical" : "physical";
}

async function extractXbstream(
  filePath: string,
  extractedPath: string,
  onProgress?: (message: string) => void
): Promise<ExtractResult> {
  onProgress?.("Starting xbstream decompression...");

  const proc = Bun.spawn(["bash", "-c", `cat "${filePath}" | xbstream -x -v --decompress --decompress-threads=10`], {
    cwd: extractedPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const decoder = new TextDecoder();
  const reader = proc.stderr.getReader();
  let stderrOutput = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      stderrOutput += text;
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) {
        onProgress?.(line.trim());
      }
    }
  } catch {}

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`xbstream extraction failed (exit code ${exitCode}): ${stderrOutput}`);
  }

  onProgress?.("xbstream extraction completed");
  return { extractedPath };
}

async function extractTarGz(
  filePath: string,
  extractedPath: string,
  onProgress?: (message: string) => void
): Promise<ExtractResult> {
  onProgress?.("Extracting tar.gz archive...");

  const proc = Bun.spawn(["tar", "xzvf", filePath, "-C", extractedPath], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`tar extraction failed (exit code ${exitCode}): ${stderr}`);
  }

  onProgress?.("tar.gz extraction completed");
  return { extractedPath };
}

export async function isLogicalBackup(dirPath: string): Promise<boolean> {
  const entries = await fs.readdir(dirPath, { recursive: true });
  const isLogical = entries.some((entry) => {
    const name = String(entry);
    return name.endsWith(".bson") || name.endsWith(".bson.gz") || name.endsWith(".metadata.json");
  });

  console.log(`[isLogicalBackup] dirPath=${dirPath}, entries=${entries.length}, isLogical=${isLogical}`);
  return isLogical;
}

async function extractTarZst(
  filePath: string,
  extractedPath: string,
  onProgress?: (message: string) => void
): Promise<ExtractResult> {
  onProgress?.("Extracting tar.zst archive...");

  const proc = Bun.spawn(
    ["bash", "-c", `zstd -d -c "${filePath}" | tar -xvf - -C "${extractedPath}"`],
    { stdout: "pipe", stderr: "pipe" }
  );

  const decoder = new TextDecoder();
  const reader = proc.stderr.getReader();
  let stderrOutput = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      stderrOutput += text;
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) {
        onProgress?.(line.trim());
      }
    }
  } catch {}

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`tar.zst extraction failed (exit code ${exitCode}): ${stderrOutput}`);
  }

  onProgress?.("tar.zst extraction completed, merging BSON parts...");
  await mergeBsonParts(extractedPath, onProgress);

  onProgress?.("BSON merge completed");
  return { extractedPath };
}

/**
 * Merge split BSON parts from Alibaba Cloud logical backup format
 * into standard mongodump directory structure.
 *
 * Input:  <db>/<collection>/<collection>.metadata.json
 *         <db>/<collection>/data/<collection>_N_partM.bson
 *
 * Output: <db>/<collection>.bson
 *         <db>/<collection>.metadata.json
 */
async function mergeBsonParts(
  dir: string,
  onProgress?: (message: string) => void
): Promise<void> {
  const dbEntries = await fs.readdir(dir, { withFileTypes: true });

  for (const dbEntry of dbEntries) {
    if (!dbEntry.isDirectory()) continue;
    const dbName = dbEntry.name;
    const dbPath = path.join(dir, dbName);
    const collEntries = await fs.readdir(dbPath, { withFileTypes: true });

    // Check if this looks like the Alibaba Cloud structure (subdirs with data/ inside)
    const hasCollDirs = collEntries.some((e) => e.isDirectory());
    if (!hasCollDirs) continue;

    // Already standard mongodump structure (has .bson files at db level)
    const hasBsonAtDbLevel = collEntries.some(
      (e) => e.isFile() && (e.name.endsWith(".bson") || e.name.endsWith(".bson.gz"))
    );
    if (hasBsonAtDbLevel) continue;

    for (const collEntry of collEntries) {
      if (!collEntry.isDirectory()) continue;
      const collName = collEntry.name;
      const collPath = path.join(dbPath, collName);

      // Copy metadata.json to db level
      const metadataFile = path.join(collPath, `${collName}.metadata.json`);
      try {
        await fs.access(metadataFile);
        await fs.copyFile(metadataFile, path.join(dbPath, `${collName}.metadata.json`));
        onProgress?.(`Copied metadata for ${dbName}.${collName}`);
      } catch {}

      // Find and merge BSON parts from data/ subdirectory
      const dataDir = path.join(collPath, "data");
      try {
        await fs.access(dataDir);
      } catch {
        continue;
      }

      const dataFiles = await fs.readdir(dataDir);
      const bsonParts = dataFiles
        .filter((f) => f.endsWith(".bson"))
        .sort((a, b) => {
          // Sort by index and part number: collection_0_part0.bson, collection_0_part1.bson, collection_1_part0.bson ...
          const parseNums = (name: string) => {
            const match = name.match(/_(\d+)_part(\d+)\.bson$/);
            return match ? [parseInt(match[1]), parseInt(match[2])] : [0, 0];
          };
          const [aIdx, aPart] = parseNums(a);
          const [bIdx, bPart] = parseNums(b);
          return aIdx !== bIdx ? aIdx - bIdx : aPart - bPart;
        });

      if (bsonParts.length === 0) continue;

      onProgress?.(`Merging ${bsonParts.length} BSON part(s) for ${dbName}.${collName}`);

      const outputFile = path.join(dbPath, `${collName}.bson`);
      const writeHandle = await fs.open(outputFile, "w");

      try {
        for (const partFile of bsonParts) {
          const partPath = path.join(dataDir, partFile);
          const data = await fs.readFile(partPath);
          await writeHandle.write(data);
        }
      } finally {
        await writeHandle.close();
      }

      // Clean up collection subdirectory
      await fs.rm(collPath, { recursive: true, force: true });
    }

    onProgress?.(`Database ${dbName}: BSON merge done`);
  }
}
