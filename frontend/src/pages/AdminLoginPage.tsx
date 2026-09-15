import React, { useState } from "react";
import { adminLogin } from "../api/client";
import { Lock, AlertCircle, ArrowLeft, KeyRound, User } from "lucide-react";

interface AdminLoginPageProps {
  onLoginSuccess: (token: string) => void;
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
      onLoginSuccess(res.access_token);
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
          maxWidth: "440px",
          boxSizing: "border-box",
          padding: "32px 28px",
          textAlign: "center",
          borderRadius: "14px",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)",
          backgroundColor: "#ffffff",
        }}
      >
        {/* Lock Icon */}
        <div
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            backgroundColor: "var(--primary-light)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "16px",
          }}
        >
          <Lock size={28} color="var(--primary)" />
        </div>

        <h1 style={{ fontSize: "22px", fontWeight: "700", marginBottom: "6px", color: "var(--text-primary)" }}>
          Quản trị Hệ thống Khảo sát
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "24px", lineHeight: "1.5" }}>
          Đăng nhập để xem thống kê, quản lý dữ liệu và xuất báo cáo nghiên cứu
        </p>

        {/* Error Alert */}
        {error && (
          <div
            style={{
              backgroundColor: "var(--error-bg)",
              color: "var(--error)",
              padding: "10px 14px",
              borderRadius: "8px",
              fontSize: "14px",
              marginBottom: "20px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              textAlign: "left",
              border: "1px solid #fca5a5",
              boxSizing: "border-box",
            }}
          >
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ textAlign: "left", width: "100%", boxSizing: "border-box" }}>
          {/* Username */}
          <div style={{ marginBottom: "18px", width: "100%", boxSizing: "border-box" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: "600", marginBottom: "8px", color: "var(--text-primary)" }}>
              <User size={15} color="var(--text-secondary)" />
              <span>Tên đăng nhập</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              className="other-text-input"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "11px 14px",
                fontSize: "15px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
              }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Nhập tên đăng nhập (vd: admin)"
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: "22px", width: "100%", boxSizing: "border-box" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: "600", marginBottom: "8px", color: "var(--text-primary)" }}>
              <KeyRound size={15} color="var(--text-secondary)" />
              <span>Mật khẩu</span>
            </label>
            <input
              type="password"
              required
              className="other-text-input"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "11px 14px",
                fontSize: "15px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
              }}
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
              padding: "12px",
              fontSize: "16px",
              fontWeight: "700",
              borderRadius: "8px",
              cursor: loading ? "not-allowed" : "pointer",
              backgroundColor: loading ? "#9c7fd6" : "var(--primary)",
              boxShadow: "0 2px 6px rgba(103, 58, 183, 0.3)",
              transition: "all 0.15s ease",
            }}
            disabled={loading}
          >
            {loading ? "Đang xác thực..." : "Đăng nhập"}
          </button>
        </form>


        {/* Back to survey link */}
        <div style={{ marginTop: "20px" }}>
          <a
            href="/"
            style={{
              fontSize: "14px",
              color: "var(--primary)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontWeight: "600",
            }}
          >
            <ArrowLeft size={15} />
            <span>Quay lại Biểu mẫu Khảo sát</span>
          </a>
        </div>
      </div>
    </div>
  );
};
