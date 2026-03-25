// Shared types for backup restore tool

export type BackupType = "physical" | "logical";
export type BackupFormat = "xbstream" | "tar.gz" | "mongodump-dir" | "mongodump-archive";

export interface BackupMeta {
  id: string;
  filename: string;
  size: number;
  type: BackupType;
  format: BackupFormat;
  status: "uploading" | "extracting" | "parsing" | "ready" | "error";
  error?: string;
  extractedPath?: string;
  mongodPort?: number;
  mongoVersion?: string;
  mongodArgs?: string[];
  createdAt: number;
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
  bsonPath?: string;
}

export interface BackupTree {
  backupId: string;
  type: BackupType;
  databases: DatabaseInfo[];
}

export interface RestoreRequest {
  backupId: string;
  selected: SelectedItem[];
  target: RestoreTarget;
}

export interface SelectedItem {
  database: string;
  collection?: string; // undefined = whole database
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

export type RestoreTarget =
  | { type: "remote"; connection: RemoteConnectionConfig }
  | { type: "download"; format: DownloadFormat };

export type TaskStatus = "pending" | "running" | "completed" | "failed";
export type TaskKind = "upload" | "start-mongod" | "restore";
export type TaskLogLevel = "info" | "stderr" | "error";

export interface TaskLogEntry {
  ts: number;
  level: TaskLogLevel;
  message: string;
}

export interface UploadTaskResult {
  backupId: string;
  filename: string;
  size: number;
  type: BackupType;
  format: BackupFormat;
  status: string;
}

export interface StartMongodTaskResult {
  port: number;
  version: string;
  tree: BackupTree;
}

export type TaskResult = UploadTaskResult | StartMongodTaskResult | null;

export interface Task {
  id: string;
  backupId: string;
  kind: TaskKind;
  status: TaskStatus;
  progress: number; // 0-100
  currentStep: string;
  error?: string;
  downloadPath?: string;
  logs: TaskLogEntry[];
  result?: TaskResult;
  createdAt: number;
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

export interface MongodConfig {
  version: string;
  extraArgs: string[];
}
