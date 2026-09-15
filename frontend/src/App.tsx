import React, { useEffect, useState } from "react";
import { SurveyPage } from "./pages/SurveyPage";
import { SuccessPage } from "./pages/SuccessPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { DevelopModePage } from "./pages/DevelopModePage";

export const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [adminToken, setAdminToken] = useState<string | null>(() => {
    return sessionStorage.getItem("admin_access_token");
  });

  // Track if a survey has already been submitted in this session
  const [isSubmitted, setIsSubmitted] = useState<boolean>(() => {
    return sessionStorage.getItem("survey_submitted") === "true";
  });

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
      setIsSubmitted(sessionStorage.getItem("survey_submitted") === "true");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleLoginSuccess = (token: string) => {
    sessionStorage.setItem("admin_access_token", token);
    setAdminToken(token);
  };

  const handleLogout = () => {
    sessionStorage.removeItem("admin_access_token");
    setAdminToken(null);
  };

  const handleNavigate = (path: string) => {
    window.history.pushState(null, "", path);
    setCurrentPath(path);
    setIsSubmitted(sessionStorage.getItem("survey_submitted") === "true");
  };

  const handleRestartSurvey = () => {
    sessionStorage.removeItem("survey_submitted");
    sessionStorage.removeItem("survey_submission_uuid");
    sessionStorage.removeItem("survey_reference_code");
    sessionStorage.removeItem("survey_form_version");
    sessionStorage.removeItem("survey-draft:v1");
    sessionStorage.removeItem("survey-draft:preview");
    setIsSubmitted(false);
    window.history.pushState(null, "", "/");
    setCurrentPath("/");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // 1. Develop Mode
  if (currentPath.startsWith("/develop")) {
    return <DevelopModePage token={adminToken || undefined} onNavigate={handleNavigate} />;
  }

  // 2. Admin Route
  if (currentPath.startsWith("/admin")) {
    if (adminToken) {
      return (
        <AdminDashboardPage
          token={adminToken}
          onLogout={handleLogout}
        />
      );
    }
    return <AdminLoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  // 3. If survey is already submitted (persisted in sessionStorage on refresh/F5)
  if (isSubmitted || currentPath === "/success") {
    if (isSubmitted) {
      const savedUuid = sessionStorage.getItem("survey_submission_uuid") || "";
      const savedRef = sessionStorage.getItem("survey_reference_code") || "HOÀN TẤT";
      const savedVersion = parseInt(sessionStorage.getItem("survey_form_version") || "1", 10);

      return (
        <SuccessPage
          response={{
            submission_uuid: savedUuid,
            reference_code: savedRef,
            form_version: savedVersion,
            status: "success",
            created_at: "",
            message: "Đã ghi nhận phiếu",
          }}
          onRestart={handleRestartSurvey}
        />
      );
    }
  }

  // 4. Default: Blank Survey Form
  return <SurveyPage />;
};

export default App;
