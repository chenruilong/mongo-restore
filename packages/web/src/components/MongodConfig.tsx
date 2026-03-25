import { useState, useEffect } from "react";
import { getMongoVersions, getBackup, startMongodTask } from "../lib/api";

interface Props {
  backupId: string;
  onStarted: (taskId: string) => void;
  onError: (error: string) => void;
}

export default function MongodConfig({ backupId, onStarted, onError }: Props) {
  const [versions, setVersions] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [platform, setPlatform] = useState("");
  const [extraArgs, setExtraArgs] = useState("--directoryperdb");
  const [loading, setLoading] = useState(false);
  const [backupType, setBackupType] = useState<"physical" | "logical">("physical");

  useEffect(() => {
    getBackup(backupId)
      .then((backup) => {
        setBackupType(backup.type);
      })
      .catch(() => {});

    getMongoVersions()
      .then((config) => {
        setVersions(config.versions);
        setPlatform(config.platform || "");
        if (config.versions.length > 0) {
          setSelectedVersion(
            config.versions.includes(config.defaultVersion)
              ? config.defaultVersion
              : config.versions[config.versions.length - 1]
          );
        }
      })
      .catch(() => {
        setVersions([]);
        setSelectedVersion("");
      });
  }, [backupId]);

  const handleStart = async () => {
    setLoading(true);
    onError("");

    try {
      const args = extraArgs
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      const result = await startMongodTask(backupId, selectedVersion, args);
      onStarted(result.taskId);
    } catch (err: any) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-gray-900">配置 MongoDB</h2>
        <p className="text-sm text-gray-500 mt-1">
          {backupType === "physical"
            ? "检测到物理备份文件，将启动临时 mongod 实例来读取数据。请选择与备份源匹配的 MongoDB 版本。"
            : "检测到 archive 格式备份，需要启动临时 mongod 实例来解析内容。请选择合适的 MongoDB 版本。"}
        </p>
        {platform && (
          <p className="text-xs text-amber-700 mt-2">
            当前容器平台：{platform}。
            {backupType === "physical" ? "如需解析旧版本物理备份，建议选择与备份源一致的 MongoDB 版本。" : ""}
          </p>
        )}
      </div>

      {versions.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          当前镜像中未检测到可用的 mongod 版本，请先重新构建 Docker 镜像。
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">MongoDB 版本</label>
          <select
            value={selectedVersion}
            onChange={(e) => setSelectedVersion(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            disabled={loading || versions.length === 0}
          >
            {versions.map((v) => (
              <option key={v} value={v}>
                MongoDB {v}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            自定义 mongod 启动参数 <span className="text-gray-400">（可选，每行一个）</span>
          </label>
          <textarea
            value={extraArgs}
            onChange={(e) => setExtraArgs(e.target.value)}
            placeholder={"--wiredTigerCacheSizeGB=2\n--setParameter diagnosticDataCollectionEnabled=false"}
            rows={4}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
            disabled={loading}
          />
        </div>

        <button
          onClick={handleStart}
          disabled={loading || versions.length === 0 || !selectedVersion}
          className="w-full py-2.5 px-4 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "提交中..." : "启动并解析备份"}
        </button>
      </div>
    </div>
  );
}
