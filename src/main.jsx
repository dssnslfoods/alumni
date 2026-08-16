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

  if (restoring) return <div className="boot">กำลังตรวจสอบสิทธิ์การใช้งาน…</div>;
  if (!user) return <Login onSignedIn={setUser} onClose={() => go("/")} />;
  if (user.mustChangePassword) return <ChangePassword user={user} forced onDone={setUser} />;
  if (changing) return <ChangePassword user={user} onDone={(updated) => { setUser(updated); setChanging(false); }} />;

  return (
    <Console
      user={user}
      onChangePassword={() => setChanging(true)}
      onSignOut={() => { session.clear(); setUser(null); }}
    />
  );
}

createRoot(document.getElementById("root")).render(<App />);
