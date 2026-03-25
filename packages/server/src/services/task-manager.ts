import type { Task, TaskEvent, TaskKind, TaskLogEntry, TaskResult } from "../types";
import { generateId } from "../lib/utils";

type TaskListener = (event: TaskEvent) => void;

const MAX_TASK_LOGS = 300;

class TaskManager {
  private tasks = new Map<string, Task>();
  private listeners = new Map<string, Set<TaskListener>>();

  createTask(backupId: string, kind: TaskKind): Task {
    const task: Task = {
      id: generateId(),
      backupId,
      kind,
      status: "pending",
      progress: 0,
      currentStep: "Initializing...",
      logs: [],
      createdAt: Date.now(),
    };
    this.tasks.set(task.id, task);
    this.listeners.set(task.id, new Set());
    return task;
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  private toEvent(task: Task): TaskEvent {
    return {
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
    };
  }

  private emit(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const event = this.toEvent(task);
    const taskListeners = this.listeners.get(taskId);
    if (taskListeners) {
      for (const listener of taskListeners) {
        try {
          listener(event);
        } catch {}
      }
    }
  }

  updateTask(
    taskId: string,
    update: Partial<Pick<Task, "status" | "progress" | "currentStep" | "error" | "downloadPath">>
  ) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    Object.assign(task, update);
    this.emit(taskId);
  }

  appendLog(taskId: string, log: Omit<TaskLogEntry, "ts"> & { ts?: number }) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.logs.push({
      ts: log.ts ?? Date.now(),
      level: log.level,
      message: log.message,
    });

    if (task.logs.length > MAX_TASK_LOGS) {
      task.logs.splice(0, task.logs.length - MAX_TASK_LOGS);
    }

    this.emit(taskId);
  }

  setResult(taskId: string, result: TaskResult) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.result = result;
    this.emit(taskId);
  }

  subscribe(taskId: string, listener: TaskListener): () => void {
    let taskListeners = this.listeners.get(taskId);
    if (!taskListeners) {
      taskListeners = new Set();
      this.listeners.set(taskId, taskListeners);
    }
    taskListeners.add(listener);

    return () => {
      taskListeners!.delete(listener);
    };
  }

  isActive(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    return task?.status === "pending" || task?.status === "running";
  }

  // Cleanup old completed/failed tasks (older than 2 hours)
  cleanup() {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, task] of this.tasks) {
      if (!this.isActive(id) && task.createdAt < cutoff) {
        this.tasks.delete(id);
        this.listeners.delete(id);
      }
    }
  }
}

export const taskManager = new TaskManager();

// Run cleanup every 30 minutes
setInterval(() => taskManager.cleanup(), 30 * 60 * 1000);
