import { Hono } from "hono";
import { taskManager } from "../services/task-manager";

const app = new Hono();

app.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const task = taskManager.getTask(taskId);

  if (!task) return c.json({ error: "Task not found" }, 404);
  if (!task.downloadPath) return c.json({ error: "Download not ready" }, 400);

  const file = Bun.file(task.downloadPath);
  if (!(await file.exists())) {
    return c.json({ error: "Download file not found" }, 404);
  }

  const filename = task.downloadPath.endsWith(".tar.gz") ? "backup.tar.gz" : "backup.archive.gz";

  return new Response(file.stream(), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(file.size),
    },
  });
});

export default app;
