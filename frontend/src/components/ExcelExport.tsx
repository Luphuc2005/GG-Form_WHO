import { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { workflowApi } from "../api/workflow";

interface ExportJob {
  id: string; status: string; row_count: number; total_rows: number; error: string | null;
  started_at: string | null; finished_at: string | null; download_url: string | null;
  expires_at: string | null;
}
export function useExcelExport() {
  const [job, setJob] = useState<ExportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = job?.status === "pending" || job?.status === "running";
  useEffect(() => {
    let current = true;
    workflowApi<ExportJob | null>("/admin/exports/latest").then(value => { if (current) setJob(value); }).catch(() => {});
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (!active || !job) return;
    let current = true;
    const timer = window.setInterval(() => {
      workflowApi<ExportJob>(`/admin/exports/${job.id}`).then(value => {
        if (current) { setJob(value); setError(""); }
      }).catch(() => { if (current) setError("Chưa cập nhật được tiến độ. Bạn có thể tải lại trang để xem yêu cầu xuất Excel."); });
    }, 2000);
    return () => { current = false; window.clearInterval(timer); };
  }, [active, job?.id]);
  const start = async () => {
    if (busy || active) return;
    setBusy(true); setError("");
    try { setJob(await workflowApi<ExportJob>("/admin/exports", {method: "POST"})); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return { job, busy, error, active, start, dismiss: () => { setJob(null); setError(""); } };
}
type Control = ReturnType<typeof useExcelExport>;

export function ExcelExportButton({ control }: { control: Control }) {
  return <button className="admin-primary" disabled={control.busy || control.active} onClick={control.start}>
    {control.active ? <RefreshCw size={16} className="is-spinning"/> : <Download size={16}/>}
    {control.active ? "Đang tạo Excel…" : "Xuất Excel mới"}
  </button>;
}

export function ExcelExportStatus({ control }: { control: Control }) {
  const {job, error, active} = control;
  if (!job && !error) return null;
  const timestamp = job?.started_at ? new Date(/[Zz]|[+-]\d\d:\d\d$/.test(job.started_at) ? job.started_at : job.started_at+"Z").toLocaleString("vi-VN", {timeZone: "Asia/Ho_Chi_Minh"}) : "";
  return <section className="admin-cleanup-panel" aria-label="Tiến độ xuất Excel" aria-live="polite">
    <div>
      <strong>{job?.status === "ready" ? `Excel đã sẵn sàng · ${job.row_count.toLocaleString("vi-VN")} phiếu` : job?.status === "running" ? `Đang tạo Excel · ${job.row_count.toLocaleString("vi-VN")} / ${job.total_rows.toLocaleString("vi-VN")} phiếu` : job?.status === "pending" ? "Đang chờ tạo file Excel…" : job?.status === "expired" ? "File Excel đã hết hạn" : "Chưa tạo được file Excel"}</strong>
      {active && <p>Bạn có thể tiếp tục làm việc. Tải lại trang vẫn xem được tiến độ.</p>}
      {job?.status === "ready" && <p>Dữ liệu được xuất từ {timestamp}. Nếu vừa sửa hoặc xóa phiếu, hãy tạo file mới.{job.expires_at && ` Tải trước ${new Date(/[Zz]|[+-]\d\d:\d\d$/.test(job.expires_at) ? job.expires_at : job.expires_at+"Z").toLocaleString("vi-VN", {timeZone:"Asia/Ho_Chi_Minh"})}.`}</p>}
      {job?.status === "expired" && <p>Bấm Xuất Excel mới để tạo lại file.</p>}
      {(error || job?.error) && <p role="alert">{error || job?.error}</p>}
    </div>
    <div className="admin-cleanup-actions">
      {job?.download_url && <a className="admin-primary" href={job.download_url}><Download size={16}/>Tải Excel</a>}
      {!active && <button className="admin-icon" onClick={control.dismiss} aria-label="Đóng thông báo Excel"><X size={18}/></button>}
    </div>
  </section>;
}
