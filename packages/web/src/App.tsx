import { useState } from "react";
import Layout from "./components/Layout";
import FileUpload from "./components/FileUpload";
import MongodConfig from "./components/MongodConfig";
import BackupTree from "./components/BackupTree";
import RestorePanel from "./components/RestorePanel";
import TaskProgress from "./components/TaskProgress";
import type {
  UploadResult,
  BackupTree as BackupTreeType,
  SelectedItem,
  TaskEvent,
  StartMongodResult,
} from "./lib/api";

type Step = "upload" | "mongod-config" | "browse" | "restore" | "progress" | "done";

export default function App() {
  const [step, setStep] = useState<Step>("upload");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [backupTree, setBackupTree] = useState<BackupTreeType | null>(null);
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskEvent, setTaskEvent] = useState<TaskEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTreeLoaded = (tree: BackupTreeType) => {
    setBackupTree(tree);
  };

  const handleSelectionConfirm = (items: SelectedItem[]) => {
    setSelected(items);
    setStep("restore");
  };

  const handleTaskStarted = (id: string) => {
    setTaskId(id);
    setTaskEvent(null);
    setError(null);
    setStep("progress");
  };

  const handleTaskUpdate = (event: TaskEvent) => {
    setTaskEvent((prev) => {
      if (!prev) return event;
      // 累积日志
      return {
        ...event,
        logs: [...(prev.logs || []), ...(event.logs || [])],
      };
    });

    if (event.status === "failed") {
      setError(event.error || null);
      setStep("done");
      return;
    }

    if (event.status !== "completed") {
      return;
    }

    if (event.kind === "upload" && event.result) {
      const result = event.result as UploadResult;
      setUploadResult(result);
      setBackupTree(null);
      setSelected([]);
      setTaskId(null);
      setTaskEvent(null);
      setStep(result.type === "physical" ? "mongod-config" : "browse");
      return;
    }

    if (event.kind === "start-mongod" && event.result) {
      const result = event.result as StartMongodResult;
      setBackupTree(result.tree);
      setTaskId(null);
      setTaskEvent(null);
      setStep("browse");
      return;
    }

    setStep("done");
  };

  const handleReset = () => {
    setStep("upload");
    setUploadResult(null);
    setBackupTree(null);
    setSelected([]);
    setTaskId(null);
    setTaskEvent(null);
    setError(null);
  };

  const handleContinueRestore = () => {
    setStep("browse");
    setTaskId(null);
    setTaskEvent(null);
    setError(null);
  };

  return (
    <Layout>
      {/* Step indicator */}
      <div className="mb-8">
        <StepIndicator current={step} backupType={uploadResult?.type} />
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {step === "upload" && (
        <FileUpload onStarted={handleTaskStarted} onError={setError} />
      )}

      {step === "mongod-config" && uploadResult && (
        <MongodConfig
          backupId={uploadResult.backupId}
          onStarted={handleTaskStarted}
          onError={setError}
        />
      )}

      {step === "browse" && uploadResult && (
        <BackupTree
          backupId={uploadResult.backupId}
          initialTree={backupTree}
          onTreeLoaded={handleTreeLoaded}
          onConfirm={handleSelectionConfirm}
          onMongodStarted={handleTaskStarted}
          onError={setError}
        />
      )}

      {step === "restore" && uploadResult && (
        <RestorePanel
          backupId={uploadResult.backupId}
          selected={selected}
          onStarted={handleTaskStarted}
          onBack={() => setStep("browse")}
          onError={setError}
        />
      )}

      {(step === "progress" || step === "done") && taskId && (
        <TaskProgress
          taskId={taskId}
          event={taskEvent}
          onUpdate={handleTaskUpdate}
          onReset={handleReset}
          onContinueRestore={handleContinueRestore}
        />
      )}
    </Layout>
  );
}

function StepIndicator({ current, backupType }: { current: Step; backupType?: string }) {
  const steps = [
    { key: "upload", label: "上传" },
    ...(backupType === "physical" ? [{ key: "mongod-config", label: "配置" }] : []),
    { key: "browse", label: "选择" },
    { key: "restore", label: "恢复" },
    { key: "progress", label: "进度" },
  ];

  const currentIndex = steps.findIndex((s) => s.key === current || (current === "done" && s.key === "progress"));

  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              i < currentIndex
                ? "bg-emerald-500 text-white"
                : i === currentIndex
                ? "bg-emerald-600 text-white ring-2 ring-emerald-300"
                : "bg-gray-200 text-gray-500"
            }`}
          >
            {i < currentIndex ? "\u2713" : i + 1}
          </div>
          <span className={`text-sm ${i <= currentIndex ? "text-gray-900 font-medium" : "text-gray-400"}`}>
            {s.label}
          </span>
          {i < steps.length - 1 && <div className="w-8 h-px bg-gray-300" />}
        </div>
      ))}
    </div>
  );
}
