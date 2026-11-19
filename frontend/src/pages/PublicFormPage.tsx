import React, { useCallback, useEffect, useRef, useState } from "react";
import { ClinicalRecord, RecordAnswers, WorkflowApiError, workflowApi } from "../api/workflow";
import { FormSchemaDefinition } from "../types/schema";
import { ComprehensiveFormPage } from "./ComprehensiveFormPage";

interface Receipt { submission_uuid: string; reference_code: string; workflow_status: string; study_code?: string | null }
interface Entry { uuid: string; key: string; formVersion: number }
const ENTRY_KEY = "public-form-entry";

export const PublicFormPage: React.FC = () => {
  const [epoch, setEpoch] = useState(0);
  const [record, setRecord] = useState<ClinicalRecord | null>(null);
  const [schema, setSchema] = useState<FormSchemaDefinition | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [startingAnswers, setStartingAnswers] = useState<RecordAnswers | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [changes, setChanges] = useState(0);
  const entry = useRef<Entry | null>(null);
  const current = useRef<ClinicalRecord | null>(null);
  const latest = useRef<RecordAnswers | null>(null);
  const saved = useRef("");
  const saving = useRef<Promise<ClinicalRecord | Receipt> | null>(null);
  const conflicted = useRef(false);
  const recoveryKey = () => `public-form-recovery:${entry.current?.uuid}`;

  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      setError(""); setBusy(true);
      const form = await workflowApi<{version: number; schema_json: FormSchemaDefinition}>("/forms/current");
      if (cancelled) return;
      let pending: Entry | null = null;
      try { pending = JSON.parse(sessionStorage.getItem(ENTRY_KEY) || "null"); } catch { /* Start a fresh entry. */ }
      if (!pending?.uuid || !pending?.key || !pending?.formVersion) {
        pending = { uuid: crypto.randomUUID(), key: crypto.randomUUID()+crypto.randomUUID(), formVersion: form.version };
        sessionStorage.setItem(ENTRY_KEY, JSON.stringify(pending));
      }
      entry.current = pending;
      const restored = await workflowApi<ClinicalRecord | Receipt>("/public/records", { method:"POST", headers:{"X-Draft-Key":pending.key}, body:JSON.stringify({submission_uuid:pending.uuid, form_version:pending.formVersion}) });
      if (cancelled) return;
      if (!("answers" in restored)) { setReceipt(restored); return; }
      const pinned = pending.formVersion === form.version ? form.schema_json : (await workflowApi<{schema_json: FormSchemaDefinition}>(`/forms/${pending.formVersion}`)).schema_json;
      if (cancelled) return;
      current.current = restored; saved.current = JSON.stringify(restored.answers);
      let initial = restored.answers;
      try {
        const cache = JSON.parse(sessionStorage.getItem(recoveryKey()) || "null");
        const emptyDraft = restored.revision === 1 &&
          !Object.keys(restored.answers.clinical_data || {}).length &&
          !restored.answers.pathology.selected.length;
        if (cache?.answers && (cache.revision === restored.revision || emptyDraft)) initial = cache.answers;
      } catch { /* The server draft remains the source of recovery. */ }
      latest.current = initial;
      setRecord(restored); setStartingAnswers(initial); setSchema(pinned);
    };
    setup().catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [epoch]);

  const changed = useCallback((answers: RecordAnswers) => {
    latest.current = answers;
    setDirty(JSON.stringify(answers) !== saved.current);
    setChanges(n => n+1);
    try { sessionStorage.setItem(recoveryKey(), JSON.stringify({revision:current.current?.revision, answers})); } catch { /* Optional tab recovery. */ }
  }, []);
  const save = useCallback(async (force = false): Promise<ClinicalRecord | Receipt> => {
    while (saving.current) {
      try { await saving.current; } catch { /* Retry the latest input after an earlier request failed. */ }
    }
    if (conflicted.current) throw new Error("Bản nháp đã thay đổi ở phiên khác. Tải lại trang để đối chiếu trước khi nhập tiếp.");
    const active = entry.current, original = current.current, answers = latest.current;
    if (!active || !original || !answers) throw new Error("Chưa tải xong biểu mẫu.");
    if (!force && JSON.stringify(answers) === saved.current) return original;
    const persist = async (): Promise<ClinicalRecord | Receipt> => {
      const put = (revision: number) => workflowApi<ClinicalRecord>(`/public/records/${active.uuid}`, {
        method: "PUT", headers: {"X-Draft-Key": active.key}, body: JSON.stringify({revision, answers}),
      });
      try {
        return await put(original.revision);
      } catch (e) {
        if (!(e instanceof WorkflowApiError) || e.status !== 404) throw e;
        // Recreate a missing server draft with its original UUID and private key.
        // The API rejects this if that UUID belongs to a different key or is in trash.
        const restored = await workflowApi<ClinicalRecord | Receipt>("/public/records", {
          method: "POST", headers: {"X-Draft-Key": active.key},
          body: JSON.stringify({submission_uuid: active.uuid, form_version: active.formVersion}),
        });
        if (!("answers" in restored)) return restored;
        if (restored.revision !== 1 && restored.revision !== original.revision) {
          throw new Error("Bản nháp đã thay đổi ở phiên khác. Tải lại trang để đối chiếu trước khi nhập tiếp.");
        }
        return put(restored.revision);
      }
    };
    const promise = persist();
    saving.current = promise;
    try {
      const updated = await promise;
      if (entry.current?.uuid !== active.uuid) return updated;
      if (!("answers" in updated)) {
        setReceipt(updated); setDirty(false); setError("");
        sessionStorage.removeItem(recoveryKey());
        return updated;
      }
      current.current = updated; setRecord(updated); saved.current = JSON.stringify(answers);
      const stillDirty = JSON.stringify(latest.current) !== saved.current;
      setDirty(stillDirty); setError("");
      try { sessionStorage.setItem(recoveryKey(),JSON.stringify({revision:updated.revision,answers:latest.current})); } catch { /* Server copy is saved. */ }
      return updated;
    } catch (e) {
      if ((e as Error).message.includes("phiên khác")) conflicted.current = true;
      if (e instanceof WorkflowApiError && e.status === 404) {
        throw new Error("Bản nháp không thể truy cập bằng khóa của phiên nhập này. Nếu phiếu đã được xóa, hãy nhờ admin khôi phục trong Thùng rác. Nội dung đang nhập được giữ trong tab này.");
      }
      throw e;
    } finally { if(saving.current === promise) saving.current = null; }
  }, []);
  useEffect(() => {
    if (!dirty || busy || receipt || conflicted.current) return;
    const timer = setTimeout(() => save().catch(e => setError(e.message)), 1200);
    return () => clearTimeout(timer);
  }, [changes, dirty, busy, receipt, save]);
  useEffect(() => {
    const retry = () => { if (dirty && !receipt) save().catch(e => setError(e.message)); };
    const warn = (e: BeforeUnloadEvent) => { if(dirty && !receipt) {e.preventDefault();e.returnValue="";} };
    window.addEventListener("online",retry); window.addEventListener("beforeunload",warn);
    return () => { window.removeEventListener("online",retry); window.removeEventListener("beforeunload",warn); };
  }, [dirty, receipt, save]);
  const submit = async (answers: RecordAnswers) => {
    latest.current = answers; setBusy(true); setError("");
    try {
      const stored = await save(true);
      if (!("answers" in stored)) return;
      const result = await workflowApi<Receipt>(`/public/records/${stored.submission_uuid}/submit`, {method:"POST",headers:{"X-Draft-Key":entry.current!.key},body:JSON.stringify({revision:stored.revision})});
      setReceipt(result); setDirty(false); sessionStorage.removeItem(recoveryKey()); window.scrollTo(0,0);
    } catch (e) {
      try {
        const active = entry.current!;
        const actual = await workflowApi<ClinicalRecord | Receipt>(`/public/records/${active.uuid}`, {headers:{"X-Draft-Key":active.key}});
        if (!("answers" in actual)) { setReceipt(actual); setDirty(false); sessionStorage.removeItem(recoveryKey()); window.scrollTo(0,0); return; }
      } catch { /* Keep the draft and original error when offline. */ }
      setError((e as Error).message);
    } finally { setBusy(false); }
  };
  const newForm = () => {
    sessionStorage.removeItem(recoveryKey()); sessionStorage.removeItem(ENTRY_KEY);
    setRecord(null); setStartingAnswers(null); setSchema(null); setReceipt(null); setDirty(false); setError("");
    current.current=null; latest.current=null; saved.current=""; conflicted.current=false;
    setEpoch(n => n+1); window.scrollTo(0,0);
  };
  return <main className={`workflow-shell public-entry${receipt ? " public-entry-receipt" : ""}`}>
    {error && <p className="workflow-error" role="alert">{error}</p>}
    {receipt ? <section className="workflow-card public-receipt"><h1>Đã lưu phiếu thành công</h1><p>Mã phiếu: <strong>{receipt.study_code || receipt.reference_code}</strong></p><p>Phiếu đã có trong trang quản lý và file xuất Excel. Hệ thống tự đồng bộ Google Sheets; không cần chờ bác sĩ duyệt.</p><button className="primary" onClick={newForm}>+ Nhập bệnh án mới</button></section> : <>
      {schema && record && startingAnswers ? <ComprehensiveFormPage key={record.submission_uuid} initialAnswers={startingAnswers} schema={schema} studyCode={record.study_code} saveStatus={dirty ? "Đang chờ lưu nháp…" : "Bản nháp đã lưu"} readOnly={false} busy={busy} onDraftChange={changed} onSubmit={submit} /> : <p role="status">{error ? "Chưa mở được biểu mẫu. Tải lại trang để thử lại." : "Đang tải biểu mẫu…"}</p>}
    </>}
  </main>;
};
