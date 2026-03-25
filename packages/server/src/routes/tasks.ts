import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { taskManager } from "../services/task-manager";

const app = new Hono();

app.get("/:taskId/status", (c) => {
  const taskId = c.req.param("taskId");
  const task = taskManager.getTask(taskId);

  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      data: JSON.stringify({
        taskId: task.id,
        backupId: task.backupId,
        kind: task.kind,
        status: task.status,
        progress: task.progress,
        currentStep: task.currentStep,
        error: task.error,
        downloadPath: task.downloadPath,
        logs: task.logs,
        result: task.result,
      }),
      event: "init",
    });

    const unsubscribe = taskManager.subscribe(taskId, async (event) => {
      try {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: "progress",
        });
      } catch {
        unsubscribe();
      }
    });

    stream.onAbort(() => {
      unsubscribe();
    });

    while (taskManager.isActive(taskId)) {
      await stream.sleep(1000);
    }

    const finalTask = taskManager.getTask(taskId);
    if (finalTask) {
      await stream.writeSSE({
        data: JSON.stringify({
          taskId: finalTask.id,
          backupId: finalTask.backupId,
          kind: finalTask.kind,
          status: finalTask.status,
          progress: finalTask.progress,
          currentStep: finalTask.currentStep,
          error: finalTask.error,
          downloadPath: finalTask.downloadPath,
          logs: finalTask.logs,
          result: finalTask.result,
        }),
        event: "done",
      });
    }
  });
});

export default app;
