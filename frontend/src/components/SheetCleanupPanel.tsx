import { useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { workflowApi } from "../api/workflow";

export interface SheetCleanupPreview { count: number; preview_hash: string }
interface CleanupJob {
  id: number; status: string; count: number; removed_count: number; retained_count: number;
  error: string | null; backup_url: string;
}

export function SheetCleanupPanel({ preview, onQueued }: { preview: SheetCleanupPreview | null; onQueued: () => void }) {
  const [job, setJob] = useState<CleanupJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = job?.status === "pending" || job?.status === "syncing";
  useEffect(() => {
    let current = true;
    workflowApi<CleanupJob | null>("/admin/google-sheets/cleanup/latest").then(value => {
      if (current) setJob(value);
    }).catch(() => {});
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (!active) return;
    let current = true;
    const timer = window.setInterval(() => {
      workflowApi<CleanupJob | null>("/admin/google-sheets/cleanup/latest").then(value => {
        if (current) { setJob(value); setError(""); }
      }).catch(() => { if (current) setError("Chưa cập nhật được tiến độ dọn Sheet. Bạn có thể tải lại trang."); });
    }, 3000);
    return () => { current = false; window.clearInterval(timer); };
  }, [active]);
  const cleanup = async () => {
    if (!preview || busy || active || !window.confirm(`Sao lưu và gỡ ${preview.count} dòng không còn trong hệ thống khỏi Google Sheet?\nCác phiếu hiện có được giữ lại. Bản sao lưu sẽ có thể tải xuống tại đây.`)) return;
    setBusy(true); setError("");
    try {
      setJob(await workflowApi<CleanupJob>("/admin/google-sheets/cleanup", {
        method: "POST", body: JSON.stringify({ preview_hash: preview.preview_hash }),
      }));
      onQueued();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (!preview && !job) return null;
  return <section className="admin-cleanup-panel" aria-label="Dọn dòng cũ trên Sheet">
    <div>
      <strong>{active ? "Đang gỡ dòng cũ khỏi Sheet…" : job?.status === "synced" && !preview ? `Đã gỡ ${job.removed_count} dòng cũ khỏi Sheet` : "Dòng cũ trên Google Sheet"}</strong>
      {preview && <p>Có {preview.count} dòng không còn phiếu tương ứng trong hệ thống. Bản sao lưu được lưu trước khi xóa.</p>}
      {job?.retained_count ? <p>Giữ lại {job.retained_count} dòng vì phiếu đã có lại trong hệ thống.</p> : null}
      {job && ["failed", "not_configured"].includes(job.status) && <p role="alert">{job.error} Bấm Đồng bộ lại để đối chiếu và thử dọn lại.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="admin-cleanup-actions">
      {job && <a className="admin-secondary" href={job.backup_url}><Download size={16}/>Tải bản sao lưu</a>}
      {preview && <button className="admin-danger" disabled={busy || active} onClick={cleanup}><Trash2 size={16}/>{busy ? "Đang sao lưu…" : `Dọn ${preview.count} dòng cũ`}</button>}
    </div>
  </section>;
}
