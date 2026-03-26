import { useState } from "react";
import { startRestore, type SelectedItem, type DownloadFormat, type RemoteConnectionConfig } from "../lib/api";

interface Props {
  backupId: string;
  selected: SelectedItem[];
  onStarted: (taskId: string) => void;
  onBack: () => void;
  onError: (error: string) => void;
}

export default function RestorePanel({ backupId, selected, onStarted, onBack, onError }: Props) {
  const [mode, setMode] = useState<"remote" | "download">("remote");
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>("gzip");
  const [loading, setLoading] = useState(false);

  // Remote connection fields
  const [hosts, setHosts] = useState([{ host: "", port: 27017 }]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [authSource, setAuthSource] = useState("");
  const [replicaSet, setReplicaSet] = useState("");
  const [tls, setTls] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateHost = (index: number, field: "host" | "port", value: string) => {
    setHosts((prev) =>
      prev.map((h, i) =>
        i === index ? { ...h, [field]: field === "port" ? Number(value) || 0 : value } : h
      )
    );
  };

  const addHost = () => setHosts((prev) => [...prev, { host: "", port: 27017 }]);

  const removeHost = (index: number) => {
    if (hosts.length > 1) setHosts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRestore = async () => {
    if (mode === "remote") {
      const validHosts = hosts.filter((h) => h.host.trim());
      if (validHosts.length === 0) {
        onError("请输入至少一个主机地址");
        return;
      }
    }

    setLoading(true);
    onError("");

    try {
      if (mode === "remote") {
        const connection: RemoteConnectionConfig = {
          hosts: hosts.filter((h) => h.host.trim()),
          ...(username && { username }),
          ...(password && { password }),
          ...(database && { database }),
          ...(authSource && { authSource }),
          ...(replicaSet && { replicaSet }),
          ...(tls && { tls }),
        };
        const result = await startRestore({
          backupId,
          selected,
          target: { type: "remote", connection },
        });
        onStarted(result.taskId);
      } else {
        const result = await startRestore({
          backupId,
          selected,
          target: { type: "download", format: downloadFormat },
        });
        onStarted(result.taskId);
      }
    } catch (err: any) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-gray-900">恢复配置</h2>
        <p className="text-sm text-gray-500 mt-1">
          已选择 {selected.length} 项待恢复
        </p>
      </div>

      {/* Selected items summary */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">已选数据</h3>
        <div className="flex flex-wrap gap-2">
          {selected.map((item, i) => (
            <span
              key={i}
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800"
            >
              {item.collection ? `${item.database}.${item.collection}` : `${item.database}.*`}
            </span>
          ))}
        </div>
      </div>

      {/* Mode selection */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex gap-4">
          <label className="flex-1 cursor-pointer">
            <div
              className={`border-2 rounded-lg p-4 transition-colors ${
                mode === "remote"
                  ? "border-emerald-500 bg-emerald-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                checked={mode === "remote"}
                onChange={() => setMode("remote")}
                className="sr-only"
              />
              <div className="text-sm font-medium text-gray-900">恢复到远程数据库</div>
              <div className="text-xs text-gray-500 mt-1">连接到 MongoDB 实例，直接恢复数据</div>
            </div>
          </label>

          <label className="flex-1 cursor-pointer">
            <div
              className={`border-2 rounded-lg p-4 transition-colors ${
                mode === "download"
                  ? "border-emerald-500 bg-emerald-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                checked={mode === "download"}
                onChange={() => setMode("download")}
                className="sr-only"
              />
              <div className="text-sm font-medium text-gray-900">下载到本地</div>
              <div className="text-xs text-gray-500 mt-1">将选中的数据导出为可下载的备份文件</div>
            </div>
          </label>
        </div>

        {mode === "remote" && (
          <div className="space-y-4">
            {/* Hosts */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">主机地址</label>
              {hosts.map((h, i) => (
                <div key={i} className="flex gap-2 mb-2 items-center">
                  <input
                    type="text"
                    value={h.host}
                    onChange={(e) => updateHost(i, "host", e.target.value)}
                    placeholder="host 或 IP"
                    className={`flex-1 ${inputClass}`}
                    disabled={loading}
                  />
                  <span className="text-gray-400 text-sm">:</span>
                  <input
                    type="number"
                    value={h.port}
                    onChange={(e) => updateHost(i, "port", e.target.value)}
                    className="w-24 shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                    disabled={loading}
                  />
                  {hosts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeHost(i)}
                      className="px-2 text-gray-400 hover:text-red-500 text-lg"
                      disabled={loading}
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addHost}
                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                disabled={loading}
              >
                + 添加主机（副本集）
              </button>
            </div>

            {/* Auth */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">用户名</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="可选"
                  className={inputClass}
                  disabled={loading}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">密码</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="可选"
                  className={inputClass}
                  disabled={loading}
                />
              </div>
            </div>

            {/* Target database */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                目标数据库 <span className="text-gray-400">（可选，留空保持原库名）</span>
              </label>
              <input
                type="text"
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder="mydb"
                className={inputClass}
                disabled={loading}
              />
            </div>

            {/* Advanced toggle */}
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              {showAdvanced ? "▲ 收起高级选项" : "▼ 高级选项"}
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">authSource</label>
                  <input
                    type="text"
                    value={authSource}
                    onChange={(e) => setAuthSource(e.target.value)}
                    placeholder="admin"
                    className={inputClass}
                    disabled={loading}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">replicaSet</label>
                  <input
                    type="text"
                    value={replicaSet}
                    onChange={(e) => setReplicaSet(e.target.value)}
                    placeholder="rs0"
                    className={inputClass}
                    disabled={loading}
                  />
                </div>
                <div className="col-span-2">
                  <label className="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tls}
                      onChange={(e) => setTls(e.target.checked)}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      disabled={loading}
                    />
                    启用 TLS/SSL
                  </label>
                </div>
              </div>
            )}

            <p className="text-xs text-gray-400">
              恢复时会先删除目标集合中的已有数据（<code>--drop</code>），再写入备份数据。
            </p>
          </div>
        )}

        {mode === "download" && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">导出格式</label>
              <div className="flex gap-3">
                {([
                  { value: "gzip" as const, label: "Archive (gzip)", desc: "mongodump --archive --gzip" },
                  { value: "bson" as const, label: "BSON", desc: "原始 .bson 文件目录" },
                  { value: "json" as const, label: "JSON", desc: "mongoexport JSON 格式" },
                ] as const).map((opt) => (
                  <label key={opt.value} className="flex-1 cursor-pointer">
                    <div
                      className={`border-2 rounded-lg p-3 transition-colors text-center ${
                        downloadFormat === opt.value
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <input
                        type="radio"
                        checked={downloadFormat === opt.value}
                        onChange={() => setDownloadFormat(opt.value)}
                        className="sr-only"
                      />
                      <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {downloadFormat === "gzip" && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-blue-900 mb-2">使用 mongorestore 恢复</h4>
                <p className="text-xs text-blue-700 mb-3">下载后可使用以下命令恢复到任意 MongoDB 实例：</p>
                <div className="bg-white rounded border border-blue-200 p-3 font-mono text-xs space-y-2">
                  <div>
                    <div className="text-gray-500 mb-1"># 恢复到默认数据库</div>
                    <code className="text-gray-800">
                      mongorestore --uri="mongodb://host:27017" --archive=backup.archive.gz --gzip --drop
                    </code>
                  </div>
                  <div className="pt-2 border-t border-blue-100">
                    <div className="text-gray-500 mb-1"># 恢复并重命名数据库</div>
                    <code className="text-gray-800">
                      mongorestore --uri="mongodb://host:27017" --archive=backup.archive.gz --gzip --drop
                      --nsFrom='olddb.*' --nsTo='newdb.*'
                    </code>
                  </div>
                </div>
              </div>
            )}

            {downloadFormat === "bson" && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-blue-900 mb-2">BSON 目录结构</h4>
                <p className="text-xs text-blue-700 mb-3">
                  解压后包含 mongodump 标准目录结构，可直接用 mongorestore 恢复：
                </p>
                <div className="bg-white rounded border border-blue-200 p-3 font-mono text-xs">
                  <div className="text-gray-500 mb-1"># 解压并恢复</div>
                  <code className="text-gray-800">
                    tar xzf backup.tar.gz && mongorestore --uri="mongodb://host:27017" --drop dump/
                  </code>
                </div>
              </div>
            )}

            {downloadFormat === "json" && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-blue-900 mb-2">MongoDB Compass 导入</h4>
                  <ol className="list-decimal list-inside space-y-1 text-xs text-blue-700 mb-3">
                    <li>解压下载的文件</li>
                    <li>打开 MongoDB Compass 并连接到目标数据库</li>
                    <li>选择目标数据库和集合</li>
                    <li>点击 "Add Data" → "Import JSON or CSV file"</li>
                    <li>选择解压后的 JSON 文件并导入</li>
                  </ol>
                </div>
                <div className="border-t border-blue-200 pt-4">
                  <h4 className="text-sm font-medium text-blue-900 mb-2">mongoimport 命令行导入</h4>
                  <div className="bg-white rounded border border-blue-200 p-3 font-mono text-xs">
                    <div className="text-gray-500 mb-1"># 导入单个集合</div>
                    <code className="text-gray-800">
                      mongoimport --uri="mongodb://host:27017/dbname" --collection=mycol --file=export/mydb/mycol.json --jsonArray
                    </code>
                  </div>
                  <p className="text-xs text-blue-600 mt-2">提示：对每个 JSON 文件分别执行命令，替换 --collection 和 --file 参数</p>
                </div>
                <p className="text-xs text-amber-600">注意：JSON 导出需要已启动的 MongoDB 临时实例</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          disabled={loading}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
        >
          返回
        </button>
        <button
          onClick={handleRestore}
          disabled={loading}
          className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "处理中..." : mode === "remote" ? "开始恢复" : "准备下载"}
        </button>
      </div>
    </div>
  );
}
