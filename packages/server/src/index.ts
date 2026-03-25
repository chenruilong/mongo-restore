import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import path from "path";
import fs from "fs";
import uploadRoutes from "./routes/upload";
import backupRoutes from "./routes/backup";
import restoreRoutes from "./routes/restore";
import downloadRoutes from "./routes/download";
import taskRoutes from "./routes/tasks";
import { ensureDir, UPLOAD_DIR, DATA_DIR } from "./lib/utils";
import { stopAllInstances } from "./lib/mongod-manager";

const app = new Hono();

// CORS for development
app.use("/api/*", cors());

// API routes
app.route("/api/upload", uploadRoutes);
app.route("/api/backups", backupRoutes);
app.route("/api/restore", restoreRoutes);
app.route("/api/download", downloadRoutes);
app.route("/api/tasks", taskRoutes);

// Health check
app.get("/api/health", (c) => c.json({ status: "ok" }));

// Serve frontend static files in production
const webDistPath = path.resolve(import.meta.dir, "../../web/dist");
if (fs.existsSync(webDistPath)) {
  app.use("/*", serveStatic({ root: webDistPath }));
  // SPA fallback
  app.get("/*", serveStatic({ root: webDistPath, path: "/index.html" }));
}

// Ensure temp directories exist
await ensureDir(UPLOAD_DIR);
await ensureDir(DATA_DIR);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await stopAllInstances();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  await stopAllInstances();
  process.exit(0);
});

const port = parseInt(process.env.PORT || "3456");
console.log(`Server running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
  maxRequestBodySize: 1024 * 1024 * 1024 * 10, // 10GB
  idleTimeout: 240, // 4 minutes for long-running operations like extraction and mongod startup
};
