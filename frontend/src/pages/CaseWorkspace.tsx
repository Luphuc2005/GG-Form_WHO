import React, { useEffect, useRef, useState } from "react";
import { FileText, Download, Search, SlidersHorizontal, RefreshCw, ChevronLeft, ChevronRight, MoreHorizontal, LogOut, Users, ExternalLink, History, Cloud, Trash2, X, Info } from "lucide-react";
import { FormSchemaDefinition } from "../types/schema";
import { Account, ClinicalRecord, STATE_LABELS, SYNC_LABELS, workflowApi } from "../api/workflow";
import { resyncGoogleSheets } from "../api/client";
import { CaseEditor } from "./CaseEditor";
import { AccountManager } from "./AccountManager";
import { AdminOverview } from "./AdminOverview";
import { AdminStats } from "../types/submission";
import "../styles/admin.css";

interface Props { user: Account; onLogout: () => void; onReports: () => void; onFormBuilder: () => void }
interface Page { items: ClinicalRecord[]; total: number; page: number; total_pages: number }
interface HistoryEvent { id: number; actor: string; action: string; revision: number; note: string | null; created_at: string; before_answers: ClinicalRecord["answers"] | null; after_answers: ClinicalRecord["answers"] | null }
const time = (s: string | null) => s ? new Date(s.endsWith("Z") || /[+-]\d\d:\d\d$/.test(s) ? s : s+"Z").toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—";
const ACTION_LABELS: Record<string, string> = { create: "Tạo phiếu", save: "Lưu nháp", submit: "Gửi phiếu", edit: "Sửa nội dung", approve: "Duyệt phiếu", return: "Yêu cầu bổ sung", reopen: "Mở lại phiếu", cancel: "Hủy phiếu" };
const isFilled = (value: unknown) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length) && !(typeof value === "object" && value !== null && !Object.keys(value).length);

export const CaseWorkspace: React.FC<Props> = ({ user, onLogout, onReports, onFormBuilder }) => {
  const [data, setData] = useState<Page>({ items: [], total: 0, page: 1, total_pages: 1 });
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState("");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState("");
  const [owner, setOwner] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<ClinicalRecord | null>(null);
  const [adminEditing, setAdminEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [error, setError] = useState("");
  const [sheetNotice, setSheetNotice] = useState("");
  const [sheetWarning, setSheetWarning] = useState(false);
  const [sheetSyncBusy, setSheetSyncBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(10);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [diagnosisLabels, setDiagnosisLabels] = useState<Record<string, string>>({});
  const menuRef = useRef<HTMLDivElement>(null);
  const requestSequence = useRef(0);
  useEffect(() => {setAdminEditing(false);}, [selected?.workflow_status]);
  const filterCount = [owner, from, to].filter(Boolean).length;
  const leave = () => !hasUnsaved || window.confirm("Có thay đổi chưa lưu. Bạn muốn rời phiếu?");

  // Entering /admin always shows the list, rather than reviving an old edit session.
  useEffect(() => { sessionStorage.removeItem(`active-record:${user.id}`); }, [user.id]);
  useEffect(() => {
    const closeMenu = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setShowMenu(false); };
    const escape = (event: KeyboardEvent) => { if(event.key === "Escape") { setShowMenu(false); if(!busy) setCancelling(false); } };
    document.addEventListener("pointerdown", closeMenu); document.addEventListener("keydown",escape);
    return () => { document.removeEventListener("pointerdown",closeMenu); document.removeEventListener("keydown",escape); };
  }, [busy]);
  useEffect(() => { const timer = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(timer); }, [q]);
  useEffect(() => {
    workflowApi<Account[]>("/accounts").then(setAccounts).catch(e => setError(e.message));
    workflowApi<{ fields: Record<string,string> }>("/forms/clinical-contract").then(c => setLabels(c.fields)).catch(() => {});
  }, [showAccounts]);
  useEffect(() => {
    if (selected) return;
    const seq = ++requestSequence.current;
    const params = new URLSearchParams({ page: String(page), q: query, state });
    if (owner) params.set("owner_id", owner);
    if (from) params.set("date_from", `${from}T00:00:00+07:00`);
    if (to) params.set("date_to", `${to}T23:59:59.999999+07:00`);
    setLoading(true);
    workflowApi<Page>(`/records?${params}`).then(result => { if (seq === requestSequence.current) { setData(result); setError(""); } })
      .catch(e => { if (seq === requestSequence.current) setError(e.message); }).finally(() => { if (seq === requestSequence.current) setLoading(false); });
    return () => { requestSequence.current++; };
  }, [page, query, state, owner, from, to, refresh, selected]);
  useEffect(() => { if (selected) return; const timer = setInterval(() => setRefresh(n => n+1), 15000); return () => clearInterval(timer); }, [selected]);
  useEffect(() => {
    if (selected) return;
    let current = true;
    workflowApi<AdminStats>("/admin/statistics").then(result => {
      if (current) { setStats(result); setStatsError(""); }
    }).catch(() => { if (current) setStatsError("Chưa tải được thống kê."); });
    return () => { current = false; };
  }, [refresh, selected]);

  const open = async (key: string) => {
    setBusy(true); setError(""); setHistory(null); setShowInfo(false); setAdminEditing(false);
    try { setSelected(await workflowApi<ClinicalRecord>(`/records/${key}`)); window.scrollTo(0,0); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const showHistory = async () => {
    if (!selected) return;
    setHistoryBusy(true); setError("");
    try {
      const [events, pinned] = await Promise.all([workflowApi<HistoryEvent[]>(`/records/${selected.submission_uuid}/history`), workflowApi<{schema_json:FormSchemaDefinition}>(`/forms/${selected.form_version}`)]);
      setDiagnosisLabels(Object.fromEntries((pinned.schema_json.fields.find(f => f.id === "pathology")?.options || []).map(o => [o.id,o.label])));
      setLabels(previous => ({...previous,...Object.fromEntries((pinned.schema_json.clinical_fields || []).map(f => [f.id,f.label]))}));
      setHistory(events); setHistoryLimit(10);
    } catch (e) { setError((e as Error).message); } finally { setHistoryBusy(false); }
  };
  const cancel = async () => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const updated = await workflowApi<ClinicalRecord>(`/records/${selected.submission_uuid}/transition`, {method:"POST",body:JSON.stringify({revision:selected.revision,action:"cancel",note})});
      setSelected(updated); setAdminEditing(false); setCancelling(false); setNote(""); setHistory(null);
    } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const retrySync = async () => {
    if (!selected) return;
    setBusy(true);
    try { setSelected(await workflowApi<ClinicalRecord>(`/records/${selected.submission_uuid}/retry-sync`, {method:"POST"})); setError(""); }
    catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  };
  const syncSheets = async () => {
    setShowMenu(false); setSheetSyncBusy(true); setSheetNotice(""); setError(""); setSheetWarning(false);
    try {
      const result = await resyncGoogleSheets(sessionStorage.getItem("admin_access_token") || undefined);
      setSheetWarning(Boolean(result.warning));
      const queued = result.count ? `Đã xếp ${result.count} phiếu vào hàng chờ. Theo dõi trạng thái từng phiếu.` : "Không có phiếu nào trong hệ thống cần gửi lên Sheet.";
      setSheetNotice(result.warning ? `${result.warning} ${result.count ? queued : ""}` : queued);
      setRefresh(n => n+1);
    } catch(e) { setError((e as Error).message); } finally { setSheetSyncBusy(false); }
  };
  const displayValue = (value: unknown): string => {
    if (!isFilled(value)) return "Chưa nhập";
    if (Array.isArray(value)) return value.map(displayValue).join(", ");
    if (typeof value === "object" && value) return Object.entries(value).map(([key,val]) => `${labels[key] || key}: ${({not_done:"Chưa thực hiện",not_documented:"Không rõ trong hồ sơ",not_applicable:"Không áp dụng"} as Record<string,string>)[String(val)] || String(val)}`).join("; ");
    return String(value);
  };
  const diagnosisText = (answers: ClinicalRecord["answers"] | null) => answers?.pathology?.selected?.map((o,index) => `WHO ${o.slot || index + 1}: ${diagnosisLabels[o.id] || o.id}${o.other_text ? ` (${o.other_text})` : ""}`).join("; ") || "Chưa chọn";
  const resetFilters = () => {setQ("");setQuery("");setState("");setOwner("");setFrom("");setTo("");setPage(1);};
  const toList = () => {setSelected(null);setAdminEditing(false);setShowInfo(false);setHistory(null);setError("");setRefresh(n => n+1);window.scrollTo(0,0);};

  return <div className={`workflow-shell admin-workspace ${!selected ? "admin-dashboard-page" : ""}`}>
    <header className="admin-header">
      <div className="admin-brand"><span className="admin-brand-icon"><FileText size={22}/></span><div><h1>Quản lý phiếu</h1><p>Dữ liệu nghiên cứu bệnh án và giải phẫu bệnh</p></div></div>
      <nav aria-label="Công cụ quản trị" className="admin-header-actions">
        {user.role === "admin" && <button className="admin-secondary" onClick={() => {if(leave())onFormBuilder();}}><FileText size={16}/>Quản lý biểu mẫu</button>}
        {stats?.google_sheet_url && <a className="admin-sheet-link" href={stats.google_sheet_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>Mở Google Sheet</a>}
        <a className="admin-primary" href="/api/v1/admin/export.xlsx"><Download size={16}/>Xuất Excel</a>
        <div ref={menuRef} className="admin-menu-wrap">
          <button type="button" className="admin-user-menu" aria-expanded={showMenu} aria-label="Mở menu quản trị" onClick={() => setShowMenu(v => !v)}><span className="admin-avatar">{user.username.slice(0,1).toUpperCase()}</span><span>{user.username}</span><MoreHorizontal size={18}/></button>
          {showMenu && <div className="admin-menu"><button disabled={sheetSyncBusy} onClick={syncSheets}><Cloud size={16}/>{sheetSyncBusy ? "Đang yêu cầu đồng bộ…" : "Đồng bộ Google Sheets"}</button><a href="/api/v1/admin/export.csv"><Download size={16}/>Tải CSV</a><button onClick={() => { if(leave()){setShowMenu(false);onReports();} }}><FileText size={16}/>Thống kê</button>{user.role === "admin" && <button onClick={() => {setShowMenu(false);setShowAccounts(true);}}><Users size={16}/>Quản lý tài khoản</button>}<button onClick={() => {if(leave()) onLogout();}}><LogOut size={16}/>Đăng xuất</button></div>}
        </div>
      </nav>
    </header>
    {error && <p role="alert" className="workflow-error">{error}</p>}
    {sheetNotice && <div className={`admin-notice ${sheetWarning ? "admin-notice-warning" : ""}`} role={sheetWarning ? "alert" : "status"}><span>{sheetNotice}</span><button className="admin-icon" aria-label="Đóng thông báo đồng bộ" onClick={() => setSheetNotice("")}><X size={16}/></button></div>}
    {selected ? <div className={`admin-detail-layout ${showInfo ? "with-panel" : ""}`}>
      <div className="admin-detail-main">
        <CaseEditor key={`${selected.submission_uuid}:${selected.workflow_status}:${adminEditing ? "edit" : `view-${selected.revision}`}`} initial={selected} adminEdit={adminEditing} userId={user.id} onRecordChange={setSelected} onDirtyChange={setHasUnsaved} onExit={toList} onEdit={() => setAdminEditing(true)} onCancelEdit={() => setAdminEditing(false)} extraActions={<button className={`admin-secondary ${showInfo ? "is-active" : ""}`} type="button" aria-expanded={showInfo} aria-label="Thông tin và lịch sử phiếu" onClick={() => setShowInfo(v => !v)}><Info size={16}/><span>Thông tin</span></button>} />
      </div>
      {showInfo && <button className="admin-panel-backdrop" aria-label="Đóng bảng thông tin" onClick={() => setShowInfo(false)}/>}
      {showInfo && <aside className="admin-detail-panel" aria-label="Thông tin phiếu">
        <div className="admin-panel-heading"><h2>Thông tin phiếu</h2><button className="admin-icon" aria-label="Đóng thông tin phiếu" onClick={() => setShowInfo(false)}><X size={18}/></button></div>
        <dl className="admin-metadata"><dt>Người nhập</dt><dd>{selected.owner_name}</dd><dt>Tạo lúc</dt><dd>{time(selected.created_at)}</dd><dt>Cập nhật gần nhất</dt><dd>{time(selected.updated_at || selected.created_at)}</dd><dt>Biểu mẫu</dt><dd>Phiên bản {selected.form_version}</dd></dl>
        {selected.review_note && <p className="admin-note">Ghi chú: {selected.review_note}</p>}
        <section className="admin-panel-section"><h3><Cloud size={16}/>Google Sheets</h3><p className={`admin-sync sync-${selected.sync_status}`}><span/>{SYNC_LABELS[selected.sync_status]}</p>{selected.sync_error && <p className="admin-muted">{selected.sync_error}</p>}<div className="admin-panel-buttons"><button disabled={busy || hasUnsaved} onClick={async () => {if(selected) {try{setSelected(await workflowApi<ClinicalRecord>(`/records/${selected.submission_uuid}`));}catch(e){setError((e as Error).message);}}}}>Cập nhật trạng thái</button>{["failed","not_configured"].includes(selected.sync_status) && <button disabled={busy} onClick={retrySync}>Thử đồng bộ lại</button>}</div></section>
        <section className="admin-panel-section"><h3><History size={16}/>Lịch sử thay đổi</h3><button className="admin-text-button" disabled={historyBusy} onClick={showHistory}>{historyBusy ? "Đang tải…" : history ? "Làm mới lịch sử" : "Xem lịch sử"}</button>
          {history && <div className="admin-history">{!history.length && <p className="admin-muted">Chưa có lịch sử trước khi nâng cấp.</p>}{history.slice(0,historyLimit).map(event => <article key={event.id}><strong>{ACTION_LABELS[event.action] || event.action}</strong><small>{event.actor} · {time(event.created_at)}</small>{event.note && <p>{event.note}</p>}{event.after_answers && <details><summary>Nội dung thay đổi</summary><ul>{Object.entries(event.after_answers.clinical_data || {}).filter(([key,value]) => JSON.stringify(value) !== JSON.stringify(event.before_answers?.clinical_data?.[key]) && (isFilled(value) || isFilled(event.before_answers?.clinical_data?.[key]))).map(([key,value]) => <li key={key}><b>{labels[key] || (key === "missing_reasons" ? "Lý do thiếu dữ liệu" : key)}</b><span>{displayValue(event.before_answers?.clinical_data?.[key])} → {displayValue(value)}</span></li>)}</ul>{JSON.stringify(event.before_answers?.pathology) !== JSON.stringify(event.after_answers.pathology) && <p>GPB: {diagnosisText(event.before_answers)} → {diagnosisText(event.after_answers)}</p>}</details>}</article>)}{history.length > historyLimit && <button className="admin-text-button" onClick={() => setHistoryLimit(n => n+10)}>Xem thêm</button>}</div>}
        </section>
        {selected.workflow_status !== "cancelled" && <section className="admin-panel-section"><button className="admin-text-button danger" disabled={busy || hasUnsaved} onClick={() => {setNote("");setCancelling(true);}}><Trash2 size={15}/>Hủy phiếu này</button><p className="admin-muted">Dữ liệu và lịch sử được giữ lại.</p></section>}
      </aside>}
    </div> : <div className="admin-dashboard">
    <AdminOverview stats={stats} error={statsError} onRetry={() => setRefresh(n => n+1)} onReports={onReports} onSync={syncSheets} syncing={sheetSyncBusy}/>
    <section className="admin-list-card">
      <div className="admin-list-heading"><div><h2>Danh sách phiếu <span>{data.total}</span></h2><p>Xem và chỉnh sửa các phiếu sinh viên đã nhập.</p></div><button className="admin-icon" disabled={loading} aria-label="Làm mới danh sách" title="Làm mới danh sách" onClick={() => setRefresh(n => n+1)}><RefreshCw size={18} className={loading ? "is-spinning" : ""}/></button></div>
      <div className="admin-search-row"><label className="admin-search"><Search size={18}/><input aria-label="Tìm phiếu" placeholder="Tìm theo tên, số hồ sơ, mã phiếu hoặc mã đợt…" value={q} onChange={e => setQ(e.target.value)}/>{q && <button aria-label="Xóa tìm kiếm" className="admin-icon" onClick={() => setQ("")}><X size={16}/></button>}</label><button className={`admin-secondary ${showFilters ? "is-active" : ""}`} aria-expanded={showFilters} onClick={() => setShowFilters(v => !v)}><SlidersHorizontal size={16}/>Bộ lọc{filterCount > 0 && <span className="admin-filter-count">{filterCount}</span>}</button></div>
      <div className="admin-tabs" aria-label="Lọc trạng thái phiếu">{[["","Tất cả"],["submitted","Đã gửi"],["draft","Nháp"],["cancelled","Đã hủy"]].map(([key,label]) => <button key={key} className={state === key ? "is-active" : ""} aria-pressed={state === key} onClick={() => {setState(key);setPage(1);}}>{label}</button>)}</div>
      {showFilters && <div className="admin-filter-panel"><label>Người nhập<select value={owner} onChange={e => {setOwner(e.target.value);setPage(1);}}><option value="">Tất cả người nhập</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.username}</option>)}</select></label><label>Từ ngày tạo<input type="date" value={from} onChange={e => {setFrom(e.target.value);setPage(1);}}/></label><label>Đến ngày tạo<input type="date" min={from} value={to} onChange={e => {setTo(e.target.value);setPage(1);}}/></label><label>Trạng thái chi tiết<select value={state} onChange={e => {setState(e.target.value);setPage(1);}}><option value="">Tất cả trạng thái</option>{Object.entries(STATE_LABELS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className="admin-text-button" onClick={resetFilters}>Xóa bộ lọc</button></div>}
      <div className="admin-table-wrap" aria-busy={loading}><table className="admin-table"><thead><tr><th>Bệnh nhân / Số hồ sơ</th><th>Mã phiếu / đợt điều trị</th><th>Ngày cập nhật</th><th>Trạng thái</th><th><span className="admin-sr-only">Thao tác</span></th></tr></thead><tbody>
        {data.items.map(record => <tr key={record.submission_uuid}><td><strong className={!record.ho_ten ? "admin-placeholder" : ""}>{record.ho_ten || "Chưa có họ tên"}</strong><small>Số HS: <span className="admin-mono">{record.so_hs || "—"}</span> · #{record.reference_code}</small></td><td>{record.study_code || record.encounter_code || "Chưa cấp mã"}<small>{record.hospital_code || "Chưa có mã bệnh viện"}</small></td><td>{time(record.updated_at || record.created_at)}<small>{record.owner_name}</small></td><td><span className={`state-badge state-${record.workflow_status}`}>{STATE_LABELS[record.workflow_status]}</span><small className={`admin-sync sync-${record.sync_status}`}><span/>{SYNC_LABELS[record.sync_status]}</small></td><td><button className="admin-row-open" disabled={busy} onClick={() => open(record.submission_uuid)}>Xem phiếu<ChevronRight size={16}/></button></td></tr>)}
        {!data.items.length && <tr><td colSpan={5}><div className="admin-empty"><FileText size={30}/><strong>{loading ? "Đang tải phiếu…" : "Chưa có phiếu phù hợp"}</strong><p>{loading ? "" : query || state || filterCount ? "Thử đổi từ khóa hoặc bộ lọc." : "Phiếu sinh viên nhập sẽ xuất hiện tại đây."}</p>{!loading && (query || state || filterCount > 0) && <button className="admin-text-button" onClick={resetFilters}>Xem tất cả phiếu</button>}</div></td></tr>}
      </tbody></table></div>
      <footer className="admin-list-footer"><span role="status">{loading ? "Đang cập nhật…" : `${data.total} phiếu${query || state || filterCount ? " phù hợp" : ""}`}</span><div><button className="admin-icon" disabled={page <= 1 || loading} aria-label="Trang trước" onClick={() => setPage(p => p-1)}><ChevronLeft size={17}/></button><span>Trang {page} / {data.total_pages}</span><button className="admin-icon" disabled={page >= data.total_pages || loading} aria-label="Trang sau" onClick={() => setPage(p => p+1)}><ChevronRight size={17}/></button></div></footer>
    </section></div>}
    {showAccounts && <div className="workflow-overlay"><section className="admin-accounts-dialog" role="dialog" aria-modal="true" aria-labelledby="accounts-title"><div className="admin-panel-heading"><h2 id="accounts-title">Quản lý tài khoản</h2><button className="admin-icon" aria-label="Đóng quản lý tài khoản" onClick={() => setShowAccounts(false)}><X size={20}/></button></div><AccountManager selfId={user.id}/></section></div>}
    {cancelling && selected && <div className="workflow-overlay"><form className="workflow-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-title" onSubmit={e => {e.preventDefault();cancel();}}><h2 id="cancel-title">Hủy phiếu #{selected.reference_code}?</h2><p>Phiếu được loại khỏi dữ liệu xuất. Nội dung và lịch sử vẫn được giữ lại.</p><label>Lý do hủy<textarea autoFocus required maxLength={2000} value={note} onChange={e => setNote(e.target.value)}/></label>{error && <p role="alert" className="workflow-error">{error}</p>}<div className="admin-dialog-actions"><button type="button" className="admin-secondary" disabled={busy} onClick={() => setCancelling(false)}>Quay lại</button><button type="submit" className="admin-danger" disabled={busy}>{busy ? "Đang xử lý…" : "Hủy phiếu"}</button></div></form></div>}
  </div>;
};
