import fs from "fs/promises";
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
