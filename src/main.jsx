import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Yearbook } from "./pages/Yearbook.jsx";
import { Privacy } from "./pages/Privacy.jsx";
import { ChangePassword, Login } from "./pages/Login.jsx";
import { Console } from "./pages/Console.jsx";
import { api, session } from "./lib/api.js";
import "./styles.css";

function routeFor(pathname) {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/privacy")) return "privacy";
  return "public";
}

function App() {
  const [page, setPage] = useState(() => routeFor(location.pathname));
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(Boolean(session.token));
  const [changing, setChanging] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const onPop = () => setPage(routeFor(location.pathname));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  // Restore an existing session on reload.
  useEffect(() => {
    if (!session.token) return;
    api("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => session.clear())
      .finally(() => setRestoring(false));
  }, []);

  function go(path) {
    history.pushState({}, "", path);
    setPage(routeFor(path));
  }

  if (page === "privacy") return <Privacy onClose={() => go("/")} />;
  if (page !== "admin") return <Yearbook />;

  /** Changing a password revokes the session, so always return to the sign-in page. */
  function passwordChanged(username) {
    session.clear();
    setUser(null);
    setChanging(false);
    setNotice(`เปลี่ยนรหัสผ่านของบัญชี ${username} เรียบร้อยแล้ว กรุณาเข้าสู่ระบบอีกครั้งด้วยรหัสผ่านใหม่`);
  }

  if (restoring) return <div className="boot">กำลังตรวจสอบสิทธิ์การใช้งาน…</div>;
  if (!user) return <Login notice={notice} onSignedIn={(signedIn) => { setNotice(""); setUser(signedIn); }} onClose={() => go("/")} />;
  if (user.mustChangePassword) return <ChangePassword user={user} forced onChanged={passwordChanged} />;
  if (changing) return <ChangePassword user={user} onChanged={passwordChanged} onCancel={() => setChanging(false)} />;

  return (
    <Console
      user={user}
      onChangePassword={() => setChanging(true)}
      onSignOut={() => { session.clear(); setUser(null); }}
    />
  );
}

createRoot(document.getElementById("root")).render(<App />);
