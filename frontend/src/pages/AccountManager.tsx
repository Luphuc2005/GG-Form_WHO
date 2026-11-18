import React, { useEffect, useState } from "react";
import { Account, Role, workflowApi } from "../api/workflow";

export const AccountManager: React.FC<{ selfId: number }> = ({ selfId }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("doctor");
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => workflowApi<Account[]>("/accounts").then(setAccounts).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (target) await workflowApi(`/accounts/${target}`, { method: "PATCH", body: JSON.stringify({ password }) });
      else await workflowApi("/accounts", { method: "POST", body: JSON.stringify({ username, password, role }) });
      setMessage(target ? "Đã đặt lại mật khẩu." : "Đã tạo tài khoản cá nhân."); setPassword(""); setUsername(""); await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const toggle = async (a: Account) => {
    setBusy(true); setError("");
    try { await workflowApi(`/accounts/${a.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !a.is_active }) }); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="workflow-card"><h2>Tài khoản quản trị</h2><p>Cấp tài khoản cho bác sĩ hoặc người quản lý. Sinh viên không cần tài khoản để nhập form.</p>
    <form className="workflow-filters" onSubmit={create}>
      <label>Thao tác<select value={target} onChange={e => { setTarget(e.target.value); setPassword(""); }}><option value="">Tạo tài khoản mới</option>{accounts.map(a => <option key={a.id} value={a.id}>Đặt lại mật khẩu: {a.username}</option>)}</select></label>
      {!target && <><label>Tên đăng nhập<input required minLength={3} maxLength={64} pattern="[a-zA-Z0-9_.-]+" value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" /></label><label>Vai trò<select value={role} onChange={e => setRole(e.target.value as Role)}><option value="doctor">Bác sĩ</option><option value="admin">Quản trị viên</option></select></label></>}
      <label>Mật khẩu mới (ít nhất 12 ký tự)<input required type="password" minLength={12} maxLength={64} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></label><button disabled={busy} type="submit">{target ? "Đặt lại mật khẩu" : "Tạo tài khoản"}</button>
    </form>{message && <p role="status">{message}</p>}{error && <p role="alert" className="workflow-error">{error}</p>}
    <div className="workflow-table-wrap"><table className="workflow-table"><thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{accounts.map(a => <tr key={a.id}><td>{a.username}</td><td>{a.role === "intern" ? "Thực tập sinh" : a.role === "doctor" ? "Bác sĩ" : "Quản trị viên"}</td><td>{a.is_active ? "Đang hoạt động" : "Đã khóa"}</td><td><button disabled={busy || a.id === selfId} onClick={() => toggle(a)}>{a.is_active ? "Khóa tài khoản" : "Mở khóa"}</button></td></tr>)}</tbody></table></div>
  </section>;
};
