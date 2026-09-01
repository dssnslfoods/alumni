import { useState } from "react";
import { ArrowRight, ChevronLeft, KeyRound, ShieldCheck } from "lucide-react";
import { Alert, Field, Shell } from "../components/Shell.jsx";
import { api, session } from "../lib/api.js";

export function Login({ onSignedIn, onClose, notice = "" }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const data = await api("/api/auth/login", { method: "POST", auth: false, body: { username, password } });
      session.save(data.token);
      onSignedIn(data.user);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <section className="screen compact admin-login">
        <KeyRound />
        <h2>เข้าสู่ระบบผู้ดูแล</h2>
        <p>สำหรับเจ้าของระบบ ผู้ดูแล และตัวแทนรุ่นที่ได้รับสิทธิ์</p>
        {notice && <Alert tone="ok">{notice}</Alert>}
        <form onSubmit={signIn}>
          <Field label="ชื่อผู้ใช้" value={username} setValue={setUsername} autoComplete="username" autoFocus />
          <Field label="รหัสผ่าน" value={password} setValue={setPassword} type="password" autoComplete="current-password" />
          <button className="next" disabled={busy || !username || !password}>เข้าสู่ระบบ <ArrowRight /></button>
        </form>
        <Alert>{message}</Alert>
        <p className="privacy-note"><ShieldCheck /> ระบบจำกัดจำนวนครั้งการเข้าสู่ระบบที่ผิดพลาด และบันทึกการเข้าใช้งานทุกครั้งเพื่อการตรวจสอบ</p>
        <button className="back" onClick={onClose}><ChevronLeft /> กลับหน้าสาธารณะ</button>
      </section>
    </Shell>
  );
}

export function ChangePassword({ user, onChanged, onCancel, forced }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function change(event) {
    event.preventDefault();
    if (newPassword !== confirmPassword) return setMessage("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");
    setBusy(true);
    setMessage("");
    try {
      await api("/api/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
      // The server revoked every session, so drop the token before re-rendering.
      session.clear();
      onChanged(user.username);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <section className="screen compact admin-login">
        <KeyRound />
        <h2>{forced ? "ตั้งรหัสผ่านใหม่ก่อนใช้งาน" : "เปลี่ยนรหัสผ่าน"}</h2>
        <p>
          {forced
            ? `บัญชี ${user.username} ยังใช้รหัสผ่านชั่วคราว กรุณาตั้งรหัสผ่านใหม่เพื่อเริ่มใช้งานระบบ`
            : "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร"}
        </p>
        <p className="privacy-note">
          <ShieldCheck /> เมื่อบันทึกแล้ว ระบบจะออกจากระบบให้อัตโนมัติ และให้เข้าสู่ระบบใหม่ด้วยรหัสผ่านที่เพิ่งตั้ง
        </p>
        <form onSubmit={change}>
          <Field label="รหัสผ่านปัจจุบัน" value={currentPassword} setValue={setCurrentPassword} type="password" autoComplete="current-password" autoFocus />
          <Field label="รหัสผ่านใหม่" value={newPassword} setValue={setNewPassword} type="password" autoComplete="new-password" hint="(อย่างน้อย 6 ตัว)" />
          <Field label="ยืนยันรหัสผ่านใหม่" value={confirmPassword} setValue={setConfirmPassword} type="password" autoComplete="new-password" />
          <button className="next" disabled={busy || !currentPassword || !newPassword}>บันทึกรหัสผ่านใหม่ <ArrowRight /></button>
        </form>
        <Alert>{message}</Alert>
        {!forced && <button className="back" onClick={onCancel}><ChevronLeft /> ยกเลิก</button>}
      </section>
    </Shell>
  );
}
