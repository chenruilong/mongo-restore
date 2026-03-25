import { useState, useEffect } from "react";
import { getBackupTree, type BackupTree as BackupTreeType, type SelectedItem } from "../lib/api";
import MongodConfig from "./MongodConfig";

interface Props {
  backupId: string;
  initialTree: BackupTreeType | null;
  onTreeLoaded: (tree: BackupTreeType) => void;
  onConfirm: (selected: SelectedItem[]) => void;
  onMongodStarted: (taskId: string) => void;
  onError: (error: string) => void;
}

export default function BackupTree({
  backupId,
  initialTree,
  onTreeLoaded,
  onConfirm,
  onMongodStarted,
  onError,
}: Props) {
  const [tree, setTree] = useState<BackupTreeType | null>(initialTree);
  const [loading, setLoading] = useState(!initialTree);
  const [selected, setSelected] = useState<Map<string, Set<string | null>>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [needsMongod, setNeedsMongod] = useState(false);

  useEffect(() => {
    if (initialTree) {
      setTree(initialTree);
      setExpanded(new Set(initialTree.databases.map((d) => d.name)));
      return;
    }

    setLoading(true);
    getBackupTree(backupId)
      .then((t) => {
        setTree(t);
        onTreeLoaded(t);
        setExpanded(new Set(t.databases.map((d) => d.name)));
      })
      .catch((err) => {
        if (err.requiresMongod) {
          setNeedsMongod(true);
        } else {
          onError(err.message);
        }
      })
      .finally(() => setLoading(false));
  }, [backupId, initialTree]);

  if (needsMongod) {
    return <MongodConfig backupId={backupId} onStarted={onMongodStarted} onError={onError} />;
  }

  const toggleDb = (dbName: string) => {
    const newSelected = new Map(selected);
    if (isDbFullySelected(dbName)) {
      newSelected.delete(dbName);
    } else {
      // Select all collections
      const db = tree?.databases.find((d) => d.name === dbName);
      if (db) {
        newSelected.set(dbName, new Set([null])); // null means whole database
      }
    }
    setSelected(newSelected);
  };

  const toggleCollection = (dbName: string, colName: string) => {
    const newSelected = new Map(selected);
    const dbSet = new Set(newSelected.get(dbName) || []);

    if (dbSet.has(null)) {
      // Was whole-db selected, switch to individual collections (all except this one)
      dbSet.delete(null);
      const db = tree?.databases.find((d) => d.name === dbName);
      if (db) {
        for (const col of db.collections) {
          if (col.name !== colName) dbSet.add(col.name);
        }
      }
    } else if (dbSet.has(colName)) {
      dbSet.delete(colName);
    } else {
      dbSet.add(colName);
      // Check if all collections are now selected
      const db = tree?.databases.find((d) => d.name === dbName);
      if (db && dbSet.size === db.collections.length) {
        dbSet.clear();
        dbSet.add(null);
      }
    }

    if (dbSet.size === 0) {
      newSelected.delete(dbName);
    } else {
      newSelected.set(dbName, dbSet);
    }
    setSelected(newSelected);
  };

  const isDbFullySelected = (dbName: string) => {
    return selected.get(dbName)?.has(null) || false;
  };

  const isCollectionSelected = (dbName: string, colName: string) => {
    const dbSet = selected.get(dbName);
    return dbSet?.has(null) || dbSet?.has(colName) || false;
  };

  const isDbPartiallySelected = (dbName: string) => {
    const dbSet = selected.get(dbName);
    return dbSet && !dbSet.has(null) && dbSet.size > 0;
  };

  const toggleExpand = (dbName: string) => {
    const newExpanded = new Set(expanded);
    if (newExpanded.has(dbName)) {
      newExpanded.delete(dbName);
    } else {
      newExpanded.add(dbName);
    }
    setExpanded(newExpanded);
  };

  const selectAll = () => {
    const newSelected = new Map<string, Set<string | null>>();
    tree?.databases.forEach((db) => {
      newSelected.set(db.name, new Set([null]));
    });
    setSelected(newSelected);
  };

  const selectNone = () => setSelected(new Map());

  const getSelectedItems = (): SelectedItem[] => {
    const items: SelectedItem[] = [];
    for (const [db, cols] of selected) {
      if (cols.has(null)) {
        items.push({ database: db });
      } else {
        for (const col of cols) {
          if (col !== null) items.push({ database: db, collection: col });
        }
      }
    }
    return items;
  };

  const totalSelected = () => {
    let count = 0;
    for (const [db, cols] of selected) {
      if (cols.has(null)) {
        const dbInfo = tree?.databases.find((d) => d.name === db);
        count += dbInfo?.collections.length || 1;
      } else {
        count += cols.size;
      }
    }
    return count;
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg className="animate-spin h-6 w-6 text-emerald-500 mr-3" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-gray-600">正在解析备份...</span>
      </div>
    );
  }

  if (!tree) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-gray-900">选择要恢复的数据</h2>
          <p className="text-sm text-gray-500">
            共 {tree.databases.length} 个数据库，{tree.databases.reduce((a, d) => a + d.collections.length, 0)} 个集合
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={selectAll} className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-600 transition-colors">
            全选
          </button>
          <button onClick={selectNone} className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-600 transition-colors">
            清除
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-96 overflow-y-auto">
        {tree.databases.map((db) => (
          <div key={db.name}>
            {/* Database row */}
            <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
              <button onClick={() => toggleExpand(db.name)} className="text-gray-400 hover:text-gray-600">
                <svg className={`w-4 h-4 transition-transform ${expanded.has(db.name) ? "rotate-90" : ""}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
              <input
                type="checkbox"
                checked={isDbFullySelected(db.name)}
                ref={(el) => {
                  if (el) el.indeterminate = isDbPartiallySelected(db.name) || false;
                }}
                onChange={() => toggleDb(db.name)}
                className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm font-medium text-gray-800">{db.name}</span>
              <span className="text-xs text-gray-400">{db.collections.length} 个集合</span>
              {db.sizeOnDisk && <span className="text-xs text-gray-400 ml-auto">{formatSize(db.sizeOnDisk)}</span>}
            </div>

            {/* Collections */}
            {expanded.has(db.name) && (
              <div className="bg-gray-50/50">
                {db.collections.map((col) => (
                  <div key={col.name} className="flex items-center gap-3 px-4 py-1.5 pl-14 hover:bg-gray-100/50">
                    <input
                      type="checkbox"
                      checked={isCollectionSelected(db.name, col.name)}
                      onChange={() => toggleCollection(db.name, col.name)}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-sm text-gray-600">{col.name}</span>
                    {col.count != null && <span className="text-xs text-gray-400">{col.count.toLocaleString()} 条文档</span>}
                    {col.size != null && <span className="text-xs text-gray-400 ml-auto">{formatSize(col.size)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">已选择 {totalSelected()} 项</span>
        <button
          onClick={() => onConfirm(getSelectedItems())}
          disabled={selected.size === 0}
          className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          下一步：配置恢复
        </button>
      </div>
    </div>
  );
}
