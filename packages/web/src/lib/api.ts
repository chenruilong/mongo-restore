const BASE = "/api";

export type BackupType = "physical" | "logical";
export type TaskStatus = "pending" | "running" | "completed" | "failed";
export type TaskKind = "upload" | "start-mongod" | "restore";
export type TaskLogLevel = "info" | "stderr" | "error";

export interface TaskLogEntry {
  ts: number;
  level: TaskLogLevel;
  message: string;
}

export interface UploadResult {
  backupId: string;
  filename: string;
  size: number;
  type: BackupType;
  format: string;
  status: string;
}

export interface BackupMeta {
  id: string;
  filename: string;
  size: number;
  type: BackupType;
  format: string;
  status: string;
  error?: string;
  mongodPort?: number;
  mongoVersion?: string;
}

export interface DatabaseInfo {
  name: string;
  sizeOnDisk?: number;
  collections: CollectionInfo[];
}

export interface CollectionInfo {
  name: string;
  size?: number;
  count?: number;
}

export interface BackupTree {
  backupId: string;
  type: BackupType;
  databases: DatabaseInfo[];
}

export interface StartMongodResult {
  port: number;
  version: string;
  tree: BackupTree;
}

export type TaskResult = UploadResult | StartMongodResult | null;

export interface SelectedItem {
  database: string;
  collection?: string;
}

export type DownloadFormat = "gzip" | "bson" | "json";

export interface RemoteConnectionConfig {
  hosts: Array<{ host: string; port: number }>;
  username?: string;
  password?: string;
  database?: string;
  authSource?: string;
  replicaSet?: string;
  tls?: boolean;
}

export interface RestoreRequest {
  backupId: string;
  selected: SelectedItem[];
  target:
    | { type: "remote"; connection: RemoteConnectionConfig }
    | { type: "download"; format: DownloadFormat };
}

export interface TaskEvent {
  taskId: string;
  backupId: string;
  kind: TaskKind;
  status: TaskStatus;
  progress: number;
  currentStep: string;
  error?: string;
  downloadPath?: string;
  logs: TaskLogEntry[];
  result?: TaskResult;
}

export interface MongoVersionConfig {
  versions: string[];
  defaultVersion: string;
  platform?: string;
}

async function getJsonError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => null);
  throw new Error(data?.error || fallback);
}

export async function getBackup(backupId: string): Promise<BackupMeta> {
  const res = await fetch(`${BASE}/backups/${backupId}`);
  if (!res.ok) {
    return getJsonError(res, "Failed to get backup");
  }
  return res.json();
}

export async function getBackupTree(backupId: string): Promise<BackupTree> {
  const res = await fetch(`${BASE}/backups/${backupId}/tree`);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (data?.requiresMongod) {
      throw Object.assign(new Error(data.error), { requiresMongod: true });
    }
    throw new Error(data?.error || "Failed to get backup tree");
  }
  return res.json();
}

export async function getMongoVersions(): Promise<MongoVersionConfig> {
  const res = await fetch(`${BASE}/backups/config/mongo-versions`);
  if (!res.ok) {
    return getJsonError(res, "Failed to get mongo versions");
  }
  return res.json();
}

export async function initUploadTask(): Promise<{ backupId: string; taskId: string }> {
  const res = await fetch(`${BASE}/upload/init`, { method: "POST" });
  if (!res.ok) {
    return getJsonError(res, "Failed to initialize upload task");
  }
  return res.json();
}

export async function uploadFileToTask(
  backupId: string,
  taskId: string,
  file: File,
  onProgress: (progress: number) => void
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      try {
        const data = JSON.parse(xhr.responseText);
        reject(new Error(data.error || `上传失败 (${xhr.status})`));
      } catch {
        reject(new Error(xhr.responseText || `上传失败 (${xhr.status})`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("上传失败")));
    xhr.open("POST", `${BASE}/upload/${backupId}?taskId=${encodeURIComponent(taskId)}`);

    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

export async function startMongodTask(
  backupId: string,
  version: string,
  extraArgs: string[]
): Promise<{ taskId: string }> {
  const res = await fetch(`${BASE}/backups/${backupId}/start-mongod`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version, extraArgs }),
  });
  if (!res.ok) {
    return getJsonError(res, "Failed to start mongod");
  }
  return res.json();
}

export async function startRestore(req: RestoreRequest): Promise<{ taskId: string }> {
  const res = await fetch(`${BASE}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    return getJsonError(res, "Failed to start restore");
  }
  return res.json();
}

export function getDownloadUrl(taskId: string): string {
  return `${BASE}/download/${taskId}`;
}

export function subscribeTaskStatus(taskId: string, onEvent: (event: TaskEvent) => void): () => void {
  const source = new EventSource(`${BASE}/tasks/${taskId}/status`);

  source.addEventListener("init", (e) => {
    onEvent(JSON.parse((e as MessageEvent).data));
  });

  source.addEventListener("progress", (e) => {
    onEvent(JSON.parse((e as MessageEvent).data));
  });

  source.addEventListener("done", (e) => {
    onEvent(JSON.parse((e as MessageEvent).data));
    source.close();
  });

  source.onerror = () => {
    source.close();
  };

  return () => source.close();
}
