import { Hono } from "hono";
import path from "path";
import type { BackupMeta } from "../types";
import { generateId, getUploadPath, ensureDir, detectFormat } from "../lib/utils";
import { detectTarGzBackupType } from "../lib/archive";
import { taskManager } from "../services/task-manager";

// In-memory backup store
export const backups = new Map<string, BackupMeta>();

const app = new Hono();

app.post("/init", (c) => {
  const backupId = generateId();
  const task = taskManager.createTask(backupId, "upload");

  taskManager.updateTask(task.id, {
    status: "pending",
    progress: 0,
    currentStep: "Waiting for file upload",
  });
  taskManager.appendLog(task.id, {
    level: "info",
    message: `Upload task created for backup ${backupId}`,
  });

  return c.json({ backupId, taskId: task.id });
});

app.post("/:backupId", async (c) => {
  const backupId = c.req.param("backupId");
  const taskId = c.req.query("taskId");
  const task = taskId ? taskManager.getTask(taskId) : undefined;

  if (!taskId || !task || task.backupId !== backupId || task.kind !== "upload") {
    return c.json({ error: "Upload task not found" }, 404);
  }

  const body = await c.req.parseBody();
  const file = body["file"];

  if (!file || !(file instanceof File)) {
    taskManager.appendLog(taskId, { level: "error", message: "No file uploaded" });
    taskManager.updateTask(taskId, {
      status: "failed",
      currentStep: "Failed",
      error: "No file uploaded",
    });
    return c.json({ error: "No file uploaded" }, 400);
  }

  const uploadDir = getUploadPath(backupId);
  await ensureDir(uploadDir);

  const filePath = path.join(uploadDir, file.name);
  taskManager.updateTask(taskId, {
    status: "running",
    progress: 5,
    currentStep: "Writing file to disk",
  });
  taskManager.appendLog(taskId, {
    level: "info",
    message: `Receiving ${file.name}`,
  });

  const writer = Bun.file(filePath).writer();
  const reader = file.stream().getReader();
  let writtenBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      writer.write(value);
      writtenBytes += value.byteLength;

      taskManager.updateTask(taskId, {
        status: "running",
        progress: Math.min(70, 5 + Math.round((writtenBytes / file.size) * 65)),
        currentStep: "Writing file to disk",
      });
    }

    await writer.end();
  } catch (error: any) {
    taskManager.appendLog(taskId, {
      level: "error",
      message: `Upload failed: ${error.message}`,
    });
    taskManager.updateTask(taskId, {
      status: "failed",
      currentStep: "Failed",
      error: `Upload failed: ${error.message}`,
    });
    return c.json({ error: `Upload failed: ${error.message}` }, 500);
  }

  taskManager.appendLog(taskId, {
    level: "info",
    message: `Saved ${file.name} (${Math.round(file.size / 1024)} KB)`,
  });
  taskManager.updateTask(taskId, {
    status: "running",
    progress: 80,
    currentStep: "Detecting backup format",
  });

  const detected = detectFormat(file.name);
  let { type, format } = detected;
  taskManager.appendLog(taskId, {
    level: "info",
    message: `Detected format ${format}`,
  });

  if (format === "tar.gz") {
    taskManager.updateTask(taskId, {
      status: "running",
      progress: 90,
      currentStep: "Inspecting tar.gz archive",
    });
    taskManager.appendLog(taskId, {
      level: "info",
      message: "Inspecting tar.gz archive contents",
    });

    try {
      type = await detectTarGzBackupType(filePath);
      taskManager.appendLog(taskId, {
        level: "info",
        message: `Archive identified as ${type} backup`,
      });
    } catch (error: any) {
      taskManager.appendLog(taskId, {
        level: "error",
        message: `Failed to inspect archive: ${error.message}`,
      });
      taskManager.updateTask(taskId, {
        status: "failed",
        currentStep: "Failed",
        error: `Failed to inspect archive: ${error.message}`,
      });
      return c.json({ error: `Failed to inspect archive: ${error.message}` }, 400);
    }
  }

  taskManager.updateTask(taskId, {
    status: "running",
    progress: 95,
    currentStep: "Finalizing upload",
  });
  taskManager.appendLog(taskId, {
    level: "info",
    message: "Preparing backup metadata",
  });

  const backup: BackupMeta = {
    id: backupId,
    filename: file.name,
    size: file.size,
    type,
    format: format as BackupMeta["format"],
    status: "ready",
    extractedPath: filePath,
    createdAt: Date.now(),
  };

  backups.set(backupId, backup);
  taskManager.setResult(taskId, {
    backupId,
    filename: file.name,
    size: file.size,
    type,
    format: backup.format,
    status: backup.status,
  });
  taskManager.appendLog(taskId, {
    level: "info",
    message: "Upload finished successfully",
  });
  taskManager.updateTask(taskId, {
    status: "completed",
    progress: 100,
    currentStep: "Upload complete",
  });

  return c.json({ ok: true });
});

export default app;
