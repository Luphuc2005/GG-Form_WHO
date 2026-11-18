import React, { useState } from "react";
import { adminLogin } from "../api/client";
import { Lock, AlertCircle, ArrowLeft, KeyRound, User } from "lucide-react";

interface AdminLoginPageProps {
  onLoginSuccess: (token: string) => void | Promise<void>;
}

export const AdminLoginPage: React.FC<AdminLoginPageProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await adminLogin(username, password);
      await onLoginSuccess(res.access_token);
    } catch (err: any) {
      setError(err.message || "Tên đăng nhập hoặc mật khẩu không chính xác.");
    } finally {
      setLoading(false);
    }
  };


  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        backgroundColor: "var(--background)",
        boxSizing: "border-box",
      }}
    >
      <div
        className="form-card header-card"
        style={{
          width: "100%",
          maxWidth: "420px",
          boxSizing: "border-box",
          padding: "30px 28px 26px",
          textAlign: "center",
          borderRadius: "14px",
          boxShadow: "0 12px 30px -8px rgba(15, 23, 42, 0.08), 0 4px 10px -4px rgba(15, 23, 42, 0.04)",
          backgroundColor: "#ffffff",
        }}
      >
        {/* Lock Icon */}
        <div
          style={{
            width: "52px",
            height: "52px",
            borderRadius: "14px",
            backgroundColor: "var(--primary-soft)",
            border: "1px solid var(--primary-border)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "16px",
          }}
        >
          <Lock size={24} color="var(--primary)" />
        </div>

        <h1 style={{ fontSize: "20px", fontWeight: "700", margin: "0 0 6px", color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
          Đăng nhập quản trị
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "13.5px", margin: "0 0 22px", lineHeight: "1.5" }}>
          Bác sĩ đăng nhập để xem, sửa phiếu, quản lý đồng bộ và xuất Excel. Sinh viên nhập trực tiếp tại trang chủ.
        </p>

        {/* Error Alert */}
        {error && (
          <div
            style={{
              backgroundColor: "var(--error-bg)",
              color: "#b91c1c",
              padding: "10px 12px",
              borderRadius: "8px",
              fontSize: "13px",
              marginBottom: "18px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              textAlign: "left",
              border: "1px solid var(--error-border)",
              boxSizing: "border-box",
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ textAlign: "left", width: "100%", boxSizing: "border-box" }}>
          {/* Username */}
          <div style={{ marginBottom: "15px", width: "100%", boxSizing: "border-box" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13.5px", fontWeight: "600", marginBottom: "6px", color: "#334155" }}>
              <User size={14} color="var(--text-muted)" />
              <span>Tên đăng nhập</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Nhập tên đăng nhập (vd: admin)"
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: "20px", width: "100%", boxSizing: "border-box" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13.5px", fontWeight: "600", marginBottom: "6px", color: "#334155" }}>
              <KeyRound size={14} color="var(--text-muted)" />
              <span>Mật khẩu</span>
            </label>
            <input
              type="password"
              required
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nhập mật khẩu"
            />
          </div>

          {/* Login Button */}
          <button
            type="submit"
            className="btn-submit"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 16px",
              fontSize: "14.5px",
              fontWeight: "600",
              borderRadius: "8px",
            }}
            disabled={loading}
          >
            {loading ? "Đang xác thực..." : "Đăng nhập"}
          </button>
        </form>


        {/* Back to survey link */}
        <div style={{ marginTop: "18px", paddingTop: "14px", borderTop: "1px solid var(--border-subtle)" }}>
          <a
            href="/"
            style={{
              fontSize: "13px",
              color: "var(--primary)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontWeight: "600",
            }}
          >
            <ArrowLeft size={14} />
            <span>Quay lại Biểu mẫu Khảo sát</span>
          </a>
        </div>
      </div>
    </div>
  );
};
