import { useState, useRef } from "react";
import { CloudUpload } from "lucide-react";
import { initUploadTask, uploadFileToTask } from "../lib/api";

interface Props {
  onStarted: (taskId: string) => void;
  onError: (error: string) => void;
}

export default function FileUpload({ onStarted, onError }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setUploading(true);
    setProgress(0);
    onError("");

    try {
      const { backupId, taskId } = await initUploadTask();
      await uploadFileToTask(backupId, taskId, file, setProgress);
      onStarted(taskId);
    } catch (err: any) {
      onError(err.message || "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium text-gray-900">上传备份文件</h2>
      <p className="text-sm text-gray-500">
        支持格式：云厂商物理备份（<code>_qp.xb</code>、<code>.tar.gz</code>），
        mongodump 导出（<code>.gz</code>、<code>.bson</code>、<code>.archive</code>）
      </p>

      <div
        className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${
          dragOver
            ? "border-emerald-400 bg-emerald-50"
            : "border-gray-300 hover:border-gray-400 bg-white"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={handleSelect}
          accept=".xb,.tar.gz,.tgz,.gz,.bson,.archive,.dump"
        />

        {uploading ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">正在上传 {fileName}...</p>
            <div className="w-full max-w-xs mx-auto bg-gray-200 rounded-full h-2">
              <div
                className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-gray-400">已上传 {progress}%</p>
          </div>
        ) : (
          <div className="space-y-3">
            <CloudUpload className="mx-auto w-12 h-12 text-gray-400" />
            <p className="text-sm text-gray-600">
              将备份文件拖拽到此处，或 <span className="text-emerald-600 font-medium">点击选择文件</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
