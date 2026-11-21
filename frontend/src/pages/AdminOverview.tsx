import React from "react";
import { FileCheck2, CalendarDays, FilePenLine, CheckCircle2, ArrowUpRight, ChartNoAxesCombined, Cloud, RefreshCw } from "lucide-react";
import { AdminStats } from "../types/submission";

interface Props {
  stats: AdminStats | null;
  error: string;
  onRetry: () => void;
  onReports: () => void;
  onSync: () => void;
  syncing: boolean;
}
const number = (value: number) => value.toLocaleString("vi-VN");
const classificationGroups = [
  { key: "benign", label: "Lành tính", color: "#0d9488" },
  { key: "borderline", label: "Giáp biên", color: "#f59e0b" },
  { key: "malignant", label: "Ác tính", color: "#e11d48" },
  { key: "other", label: "Chưa phân loại / khác", color: "#94a3b8" },
];

export const AdminOverview: React.FC<Props> = ({ stats, error, onRetry, onReports, onSync, syncing }) => {
  const total = stats?.total_submissions || 0;
  const synced = stats?.by_sync?.synced || 0;
  const pending = (stats?.by_sync?.pending || 0) + (stats?.by_sync?.syncing || 0);
  const removing = (stats?.by_sheet_removal?.pending || 0) + (stats?.by_sheet_removal?.syncing || 0);
  const removalFailed = (stats?.by_sheet_removal?.failed || 0) + (stats?.by_sheet_removal?.not_configured || 0);
  const attention = Math.max(0, total - synced - pending);
  const percent = total ? Math.round(synced / total * 100) : 0;
  const groups = classificationGroups.map(group => ({ ...group, count: group.key === "other"
    ? Object.entries(stats?.by_classification || {}).filter(([key]) => !["benign", "borderline", "malignant"].includes(key)).reduce((sum, [, value]) => sum + value, 0)
    : stats?.by_classification[group.key] || 0 }));
  let angle = 0;
  const segments = groups.map(group => {
    const start = angle;
    angle += total ? group.count / total * 360 : 0;
    return `${group.color} ${start}deg ${angle}deg`;
  });
  const cards = [
    { label: "Phiếu đã gửi", value: stats?.total_submissions, note: "Sẵn sàng xuất dữ liệu", icon: FileCheck2, tone: "primary" },
    { label: "Tạo hôm nay", value: stats?.today_submissions, note: "Trong các phiếu đã gửi", icon: CalendarDays, tone: "blue" },
    { label: "Đang nhập", value: stats?.by_workflow?.draft, note: "Bản nháp chưa gửi", icon: FilePenLine, tone: "amber" },
    { label: "Đã lên Google Sheet", value: stats ? synced : undefined, note: `${percent}% số phiếu đã gửi`, icon: CheckCircle2, tone: "green" },
  ];

  return <section className="admin-overview" aria-labelledby="overview-title">
    <div className="admin-overview-title"><div><span className="admin-eyebrow">KHÔNG GIAN NGHIÊN CỨU</span><h2 id="overview-title">Tổng quan dữ liệu</h2></div><span className="admin-live"><span/>Tự cập nhật mỗi 15 giây</span></div>
    {error && <div className="admin-stats-error" role="alert"><span>{error}{stats ? " Số liệu bên dưới là lần tải gần nhất." : ""}</span><button onClick={onRetry}><RefreshCw size={14}/>Thử lại</button></div>}
    <div className="admin-stat-grid">{cards.map(card => <article className={`admin-stat-card tone-${card.tone}`} key={card.label}><div className="admin-stat-top"><span>{card.label}</span><span className="admin-stat-icon"><card.icon size={21}/></span></div><strong>{stats ? number(card.value || 0) : "—"}</strong><p>{stats ? card.note : "Đang tải số liệu…"}</p></article>)}</div>
    <div className="admin-insight-grid">
      <article className="admin-insight-card">
        <div className="admin-insight-heading"><div><h3><ChartNoAxesCombined size={18}/>Phân loại giải phẫu bệnh</h3><p>Thống kê trên các phiếu đã gửi</p></div><button className="admin-insight-link" onClick={onReports}>Chi tiết<ArrowUpRight size={16}/></button></div>
        <div className="admin-classification-body"><div className="admin-donut" style={{ background: total ? `conic-gradient(${segments.join(",")})` : "#e9edf6" }} aria-hidden="true"><div><strong>{stats ? number(total) : "—"}</strong><span>phiếu đã gửi</span></div></div><ul className="admin-chart-legend">{groups.map(group => <li key={group.key}><span className="admin-legend-dot" style={{ background: group.color }}/><span>{group.label}</span><strong>{stats ? number(group.count) : "—"}</strong><small>{total ? Math.round(group.count / total * 100) : 0}%</small></li>)}</ul></div>
      </article>
      <article className="admin-insight-card admin-sheet-overview">
        <div className="admin-insight-heading"><div><h3><Cloud size={18}/>Đồng bộ Google Sheets</h3><p>Phiếu gửi xong được đồng bộ tự động</p></div><span className="admin-sheet-emblem"><CheckCircle2 size={22}/></span></div>
        <div className="admin-sync-summary"><strong>{stats ? number(synced) : "—"}<span> / {stats ? number(total) : "—"} phiếu</span></strong><span>{percent}%</span></div>
        <div className="admin-sync-track" role="progressbar" aria-label="Tỷ lệ phiếu đã đồng bộ Google Sheets" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }}/></div>
        <div className="admin-sync-counts"><span><i className="dot-synced"/>{number(synced)} đã đồng bộ</span><span><i className="dot-pending"/>{number(pending)} đang chờ</span><span><i className="dot-attention"/>{number(attention)} chưa đồng bộ</span></div>
        {(removing > 0 || removalFailed > 0) && <p className="admin-muted" role="status">{removing > 0 ? `${number(removing)} phiếu đang chờ gỡ khỏi Sheet. ` : ""}{removalFailed > 0 ? `${number(removalFailed)} phiếu chưa gỡ được; bấm Đồng bộ lại để thử lại.` : ""}</p>}
        <div className="admin-sync-bottom"><p>Xem trạng thái từng phiếu trong danh sách bên dưới.</p><button className="admin-insight-link" disabled={syncing} onClick={onSync}><RefreshCw size={14} className={syncing ? "is-spinning" : ""}/>{syncing ? "Đang yêu cầu…" : "Đồng bộ lại"}</button></div>
      </article>
    </div>
  </section>;
};
