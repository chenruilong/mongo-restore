import { Hono } from "hono";
import { backups } from "./upload";
import { taskManager } from "../services/task-manager";
import { executeRestore } from "../services/restore-service";
import type { RestoreRequest } from "../types";

const app = new Hono();

// Start a restore task
app.post("/", async (c) => {
  const body = await c.req.json<RestoreRequest>();
  const { backupId, selected, target } = body;

  if (!backupId || !selected?.length || !target) {
    return c.json({ error: "Missing required fields: backupId, selected, target" }, 400);
  }

  const backup = backups.get(backupId);
  if (!backup) return c.json({ error: "Backup not found" }, 404);

  const task = taskManager.createTask(backupId, "restore");
  taskManager.appendLog(task.id, { level: "info", message: "Restore task created" });

  executeRestore(backup, selected, target, task.id).catch((err) => {
    taskManager.appendLog(task.id, {
      level: "error",
      message: err.message || String(err),
    });
    taskManager.updateTask(task.id, {
      status: "failed",
      error: err.message || String(err),
      currentStep: "Failed",
    });
  });

  return c.json({ taskId: task.id, status: "pending" });
});

export default app;
