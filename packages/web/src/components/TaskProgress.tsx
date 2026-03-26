import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, XCircle, Download, Loader2 } from "lucide-react";
import { subscribeTaskStatus, getDownloadUrl, type TaskEvent } from "../lib/api";

interface Props {
  taskId: string;
  event: TaskEvent | null;
  onUpdate: (event: TaskEvent) => void;
  onReset: () => void;
  onContinueRestore?: () => void;
}

export default function TaskProgress({ taskId, event, onUpdate, onReset, onContinueRestore }: Props) {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const onUpdateRef = useRef(onUpdate);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    console.log("Subscribing to task updates for taskId:", taskId);
    const unsubscribe = subscribeTaskStatus(taskId, (event) => onUpdateRef.current(event));
    return unsubscribe;
  }, [taskId]);

  useEffect(() => {
    const el = logContainerRef.current;
    if (!el || !autoScroll) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [event?.logs?.length, autoScroll]);

  const status = event?.status || "pending";
  const progress = event?.progress || 0;
  const currentStep = event?.currentStep || "等待中...";
  const error = event?.error;
  const kind = event?.kind || "restore";
  const allLogs = event?.logs || [];
  const logs = allLogs.slice(-300); // 只保留最近300条

  const isDone = status === "completed";
  const isFailed = status === "failed";

  const title = useMemo(() => {
    if (kind === "upload") {
      return isDone ? "上传完成" : isFailed ? "上传失败" : "正在上传...";
    }
    if (kind === "start-mongod") {
      return isDone ? "MongoDB 已就绪" : isFailed ? "MongoDB 启动失败" : "正在启动 MongoDB...";
    }
    return isDone ? "恢复完成" : isFailed ? "恢复失败" : "正在恢复...";
  }, [isDone, isFailed, kind]);

  const kindLabel = kind === "upload" ? "上传" : kind === "start-mongod" ? "启动 MongoDB" : "恢复";

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium text-gray-900">{title}</h2>
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            {kindLabel}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">{currentStep}</span>
            <span className="text-gray-400">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all duration-500 ${
                isFailed ? "bg-red-500" : "bg-emerald-500"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-center py-2">
          {isDone && (
            <div className="flex items-center gap-3 text-emerald-600">
              <CheckCircle2 className="w-10 h-10" />
              <span className="text-lg font-medium">处理成功</span>
            </div>
          )}

          {isFailed && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-red-600">
                <XCircle className="w-10 h-10" />
                <span className="text-lg font-medium">处理失败</span>
              </div>
              {error && (
                <pre className="mt-2 p-3 bg-red-50 rounded-lg text-xs text-red-700 overflow-x-auto whitespace-pre-wrap">
                  {error}
                </pre>
              )}
            </div>
          )}

          {!isDone && !isFailed && (
            <Loader2 className="animate-spin h-8 w-8 text-emerald-500" />
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-900">详细输出</h3>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="rounded border-gray-300"
                />
                自动滚动
              </label>
              <span className="text-xs text-gray-400">最近 {logs.length} 条</span>
            </div>
          </div>
          <div
            ref={logContainerRef}
            className="h-96 overflow-y-auto rounded-lg bg-gray-950 px-4 py-3 font-mono text-xs leading-5"
          >
            {logs.length === 0 ? (
              <div className="text-gray-500">等待任务输出...</div>
            ) : (
              logs.map((log, index) => (
                <div
                  key={`${log.ts}-${index}`}
                  className={
                    log.level === "error"
                      ? "text-red-300"
                      : log.level === "stderr"
                      ? "text-amber-200"
                      : "text-gray-200"
                  }
                >
                  <span className="mr-2 text-gray-500">{new Date(log.ts).toLocaleTimeString()}</span>
                  <span>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {isDone && event?.downloadPath && (
          <>
            <div className="flex justify-center">
              <a
                href={getDownloadUrl(taskId)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
                download
              >
                <Download className="w-4 h-4" />
                下载备份文件
              </a>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-center gap-3">
        {(isDone || isFailed) && kind === "restore" && onContinueRestore && (
          <button
            onClick={onContinueRestore}
            className="px-4 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
          >
            继续恢复
          </button>
        )}
        <button
          onClick={onReset}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg transition-colors"
        >
          开始新的任务
        </button>
      </div>
    </div>
  );
}
