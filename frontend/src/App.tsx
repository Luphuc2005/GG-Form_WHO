import React, { useEffect, useState } from "react";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { DevelopModePage } from "./pages/DevelopModePage";
import { CaseWorkspace } from "./pages/CaseWorkspace";
import { PublicFormPage } from "./pages/PublicFormPage";
import { FormBuilderPage } from "./pages/FormBuilderPage";
import { Account, workflowApi } from "./api/workflow";
import { adminLogout } from "./api/client";
import "./styles/workflow.css";

export const App: React.FC = () => {
  const [user, setUser] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState(window.location.pathname);
  const [error, setError] = useState("");
  const adminRoute = path.startsWith("/admin") || path.startsWith("/develop");
  const navigate = (value: string) => { window.history.pushState(null, "", value); setPath(value); };
  const clearSession = () => {
    sessionStorage.removeItem("admin_access_token");
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith("record-draft:") || key.startsWith("pending-record:") || key.startsWith("active-record:") || key.startsWith("clinical_form_draft") || key.startsWith("survey-")) sessionStorage.removeItem(key);
    }
    setUser(null);
  };
  useEffect(() => {
    const expired = () => { sessionStorage.removeItem("admin_access_token"); setUser(null); };
    const pop = () => setPath(window.location.pathname);
    window.addEventListener("session-expired", expired);
    window.addEventListener("popstate", pop);
    return () => { window.removeEventListener("session-expired", expired); window.removeEventListener("popstate", pop); };
  }, []);
  useEffect(() => {
    if (!adminRoute) return;
    setLoading(true);
    workflowApi<Account>("/accounts/me").then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
  }, [adminRoute]);
  const login = async (token: string) => {
    sessionStorage.setItem("admin_access_token", token);
    const account = await workflowApi<Account>("/accounts/me");
    setUser(account); setError("");
    // Legacy anonymous drafts cannot be assigned safely to an authenticated user.
    for (const key of Object.keys(sessionStorage)) if (key.startsWith("clinical_form_draft")) sessionStorage.removeItem(key);
  };
  const logout = async () => { await adminLogout().catch(() => {}); clearSession(); navigate("/"); };
  if (!adminRoute) return <PublicFormPage />;
  if (loading) return <p className="workflow-card" role="status">Đang kiểm tra phiên đăng nhập…</p>;
  if (!user) return <>{error && <p className="workflow-error" role="alert">{error}</p>}<AdminLoginPage onLoginSuccess={login} /></>;
  const doctor = user.role !== "intern";
  if (user.role === "admin" && path === "/admin/form-builder") return <FormBuilderPage onBack={() => navigate("/admin")}/>;
  if (doctor && path === "/admin/reports") return <><div className="case-toolbar"><button onClick={() => navigate("/admin")}>← Quản lý phiếu</button><span>CSV và Excel gồm toàn bộ phiếu đã gửi, không cần duyệt trước.</span></div><AdminDashboardPage token={sessionStorage.getItem("admin_access_token") || ""} onLogout={logout} /></>;
  if (doctor && path.startsWith("/develop")) return <><div className="case-toolbar"><button onClick={() => navigate("/admin")}>← Quản lý phiếu</button></div><DevelopModePage token={sessionStorage.getItem("admin_access_token") || undefined} onNavigate={navigate} /></>;
  if (!doctor) return <section className="workflow-card"><p>Trang này dành cho bác sĩ quản lý dữ liệu.</p><a href="/">Về form nhập liệu</a></section>;
  return <CaseWorkspace user={user} onLogout={logout} onReports={() => navigate("/admin/reports")} onFormBuilder={() => navigate("/admin/form-builder")} />;
};
export default App;
