import React, { useCallback, useEffect, useRef, useState } from "react";
import { ClinicalRecord, RecordAnswers, STATE_LABELS, workflowApi } from "../api/workflow";
import { ArrowLeft, Pencil, Save, Send, X } from "lucide-react";
import { FormSchemaDefinition } from "../types/schema";
import { ComprehensiveFormPage } from "./ComprehensiveFormPage";

interface Props { extraActions?: React.ReactNode; onEdit: () => void; onCancelEdit: () => void; adminEdit?: boolean; initial: ClinicalRecord; userId: number; onExit: () => void; onRecordChange: (record: ClinicalRecord) => void; onDirtyChange: (dirty: boolean) => void }
export const CaseEditor: React.FC<Props> = ({ initial, userId, onExit, onRecordChange, onDirtyChange, adminEdit = false, onEdit, onCancelEdit, extraActions }) => {
  const [record, setRecord] = useState(initial);
  const current = useRef(initial);
  const [schema, setSchema] = useState<FormSchemaDefinition | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const cacheKey = `record-draft:${userId}:${initial.submission_uuid}`;
  const [startingAnswers] = useState<RecordAnswers>(() => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      if (cached?.revision === initial.revision && ["draft", "changes_requested"].includes(initial.workflow_status)) return cached.answers;
    } catch { /* Server copy remains available. */ }
    return initial.answers;
  });
  const latest = useRef(startingAnswers);
  const saved = useRef(JSON.stringify(initial.answers));
  const saving = useRef<Promise<ClinicalRecord> | null>(null);
  const conflict = useRef(false);
  const [changeNumber, setChangeNumber] = useState(0);
  const editingSent = adminEdit && record.workflow_status !== "draft";
  const editable = adminEdit && record.workflow_status !== "cancelled";
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  useEffect(() => {
    workflowApi<{ schema_json: FormSchemaDefinition }>(`/forms/${initial.form_version}`)
      .then(res => setSchema(res.schema_json)).catch(e => setError(e.message));
  }, [initial.form_version]);

  const changed = useCallback((answers: RecordAnswers) => {
    latest.current = answers;
    const different = JSON.stringify(answers) !== saved.current;
    setDirty(different);
    if (different) setMessage("Có thay đổi chưa được lưu lên máy chủ.");
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ revision: current.current.revision, answers })); } catch { /* Saving to the server still works. */ }
    setChangeNumber(n => n + 1);
  }, [cacheKey]);

  const save = useCallback(async (): Promise<ClinicalRecord> => {
    if (conflict.current) throw new Error("Phiếu có xung đột phiên bản. Tải lại phiếu để đối chiếu trước khi sửa tiếp.");
    while (saving.current) await saving.current;
    const snapshot = latest.current;
    if (JSON.stringify(snapshot) === saved.current) return current.current;
    const promise = workflowApi<ClinicalRecord>(`/records/${initial.submission_uuid}`, {
      method: "PUT", body: JSON.stringify({ revision: current.current.revision, answers: snapshot }),
    });
    saving.current = promise;
    try {
      const updated = await promise;
      current.current = updated;
      setRecord(updated);
      onRecordChange(updated);
      saved.current = JSON.stringify(snapshot);
      const stillDirty = JSON.stringify(latest.current) !== saved.current;
      setDirty(stillDirty);
      setError("");
      setMessage(stillDirty ? "Đang chờ lưu các thay đổi tiếp theo…" : `Đã lưu trên máy chủ lúc ${new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`);
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ revision: updated.revision, answers: latest.current })); } catch { /* Optional recovery cache. */ }
      return updated;
    } catch (e) {
      if ((e as Error).message.includes("phiên khác")) conflict.current = true;
      throw e;
    } finally { if (saving.current === promise) saving.current = null; }
  }, [initial.submission_uuid, cacheKey, onRecordChange]);

  useEffect(() => {
    if (!editable || editingSent || !dirty || busy || conflict.current) return;
    const timer = window.setTimeout(() => { save().catch(e => setError(e.message)); }, 1200);
    return () => window.clearTimeout(timer);
  }, [changeNumber, editable, editingSent, dirty, busy, save]);
  useEffect(() => {
    const retry = () => { if (editable && !editingSent && !conflict.current) save().catch(e => setError(e.message)); };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [editable, editingSent, save]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const saveNow = async () => { setBusy(true); try { await save(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const submit = async (answers: RecordAnswers) => {
    latest.current = answers;
    setBusy(true); setError("");
    try {
      const stored = await save();
      if (editingSent) { setMessage("Đã lưu thay đổi. Excel được cập nhật ngay; Sheet sẽ được đồng bộ tự động."); return; }
      const sent = await workflowApi<ClinicalRecord>(`/records/${stored.submission_uuid}/transition`, { method: "POST", body: JSON.stringify({ revision: stored.revision, action: "submit" }) });
      current.current = sent; setRecord(sent); setDirty(false); sessionStorage.removeItem(cacheKey);
      onRecordChange(sent);
      setMessage("Đã lưu phiếu. Excel và Google Sheets nhận dữ liệu ngay, không cần duyệt.");
    } catch (e) {
      // A lost response after commit is recoverable using the SAME record UUID.
      try {
        const actual = await workflowApi<ClinicalRecord>(`/records/${initial.submission_uuid}`);
        if (!editingSent && actual.workflow_status === "submitted") {
          current.current = actual; setRecord(actual); setDirty(false); sessionStorage.removeItem(cacheKey);
          onRecordChange(actual);
          setMessage("Phiếu đã được máy chủ ghi nhận."); return;
        }
      } catch { /* Preserve the original error and local draft. */ }
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return <>
    <div className="admin-record-bar">
      <div className="admin-record-heading"><button type="button" className="admin-back" aria-label="Quay lại danh sách phiếu" disabled={busy} onClick={() => { if (!dirty || window.confirm("Có thay đổi chưa lưu. Bạn muốn quay lại danh sách?")) onExit(); }}><ArrowLeft size={19}/></button><div><div className="admin-record-title"><h2>Phiếu {record.study_code || `#${record.reference_code}`}</h2><span className={`state-badge state-${record.workflow_status}`}>{STATE_LABELS[record.workflow_status]}</span>{editable && <span className="admin-edit-tag">Đang sửa</span>}</div><p>{record.ho_ten || "Chưa có họ tên"} · Số HS {record.so_hs || "chưa nhập"}</p></div></div>
      <div className="admin-record-actions">
        {editable ? <><button className="admin-secondary" type="button" disabled={busy} onClick={() => {if(!dirty || window.confirm("Bỏ các thay đổi chưa lưu?")){sessionStorage.removeItem(cacheKey);onCancelEdit();}}}><X size={15}/>Đóng chỉnh sửa</button>{record.workflow_status === "draft" && <button className="admin-secondary" type="button" disabled={busy} onClick={() => submit(latest.current)}><Send size={15}/>Gửi phiếu</button>}<button className="admin-primary" type="button" onClick={saveNow} disabled={busy}><Save size={16}/>{busy ? "Đang lưu…" : editingSent ? "Lưu thay đổi" : "Lưu nháp"}</button></> : record.workflow_status !== "cancelled" && <button className="admin-primary" type="button" onClick={onEdit}><Pencil size={16}/>Sửa phiếu</button>}
        {extraActions}
      </div>
    </div>
    {error && <div className="workflow-error" role="alert">{error}<button className="admin-text-button" type="button" onClick={() => {if(!dirty || window.confirm("Tải lại sẽ bỏ các thay đổi chưa lưu. Tiếp tục?")){sessionStorage.removeItem(cacheKey);window.location.reload();}}}>Tải lại danh sách</button></div>}
    {editable && <p className={`admin-save-message ${dirty ? "is-unsaved" : ""}`} role="status">{busy ? "Đang lưu dữ liệu…" : dirty ? "Có thay đổi chưa lưu." : message || "Chỉnh sửa nội dung rồi bấm Lưu thay đổi."}</p>}
    {schema ? <ComprehensiveFormPage key={initial.submission_uuid} initialAnswers={startingAnswers} schema={schema} compact identityVersion={record.identity_version} studyCode={record.study_code}
      readOnly={!editable} busy={busy} onDraftChange={changed} onSubmit={async (answers) => {latest.current=answers;await saveNow();}} submitLabel="Lưu thay đổi" /> : <p className="admin-loading" role="status">Đang tải phiếu…</p>}
  </>;
};
