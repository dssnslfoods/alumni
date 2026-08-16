import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  Download,
  FileSpreadsheet,
  KeyRound,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  Settings,
  Trash2,
  Upload,
  UserPlus,
  Users
} from "lucide-react";
import { Alert, Field, Shell } from "../components/Shell.jsx";
import { api, download, session } from "../lib/api.js";

const ROLE_LABELS = { owner: "เจ้าของระบบ", admin: "ผู้ดูแลระบบ", staff: "ตัวแทนรุ่น", alumni: "นิสิตเก่า" };
const STATUS_LABELS = { pending: "ยังไม่ตอบ", submitted: "ยืนยันแล้ว", declined: "ไม่ประสงค์ลง" };

export function Console({ user, onSignOut, onChangePassword }) {
  const canManageUsers = ["owner", "admin"].includes(user.role);
  const canImport = ["owner", "admin"].includes(user.role);

  const tabs = useMemo(() => [
    { key: "overview", label: "ภาพรวม", icon: LayoutDashboard, show: true },
    { key: "alumni", label: "รายชื่อนิสิตเก่า", icon: Users, show: true },
    { key: "import", label: "นำเข้า / ส่งออก", icon: FileSpreadsheet, show: canImport },
    { key: "users", label: "ผู้ใช้งานระบบ", icon: UserPlus, show: canManageUsers },
    { key: "settings", label: "ตั้งค่า", icon: Settings, show: canManageUsers },
    { key: "audit", label: "บันทึกการใช้งาน", icon: ClipboardList, show: canManageUsers }
  ].filter((tab) => tab.show), [canManageUsers, canImport]);

  const [tab, setTab] = useState("overview");

  return (
    <Shell wide>
      <section className="console">
        <div className="console-head">
          <div>
            <p className="kicker">ระบบจัดการหนังสืออนุสรณ์</p>
            <h2>สวัสดี {user.displayName}</h2>
            <p className="console-sub">
              <span className={`role-chip role-${user.role}`}>{ROLE_LABELS[user.role] || user.role}</span>
              <span>@{user.username}</span>
              {user.batchScope?.length > 0 && <span>ดูแลรุ่น {user.batchScope.join(", ")}</span>}
            </p>
          </div>
          <div className="console-actions">
            <button onClick={onChangePassword}><KeyRound /> เปลี่ยนรหัสผ่าน</button>
            <button className="danger" onClick={onSignOut}><LogOut /> ออกจากระบบ</button>
          </div>
        </div>

        <nav className="console-tabs">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><Icon /> {label}</button>
          ))}
        </nav>

        {tab === "overview" && <Overview user={user} />}
        {tab === "alumni" && <AlumniTable user={user} />}
        {tab === "import" && <ImportExport canReset={user.role === "owner"} />}
        {tab === "users" && <UserManager user={user} />}
        {tab === "settings" && <SettingsPanel />}
        {tab === "audit" && <AuditLog />}
      </section>
    </Shell>
  );
}

function useAsync(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const run = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      setState({ loading: false, data: await loader(), error: "" });
    } catch (error) {
      setState({ loading: false, data: null, error: error.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

/* -------------------------------- overview -------------------------------- */

function Overview() {
  const { loading, data, error, reload } = useAsync(() => api("/api/admin/summary"));
  if (loading) return <p className="console-loading">กำลังโหลดข้อมูล…</p>;
  if (error) return <Alert>{error}</Alert>;

  const cards = [
    ["รายชื่อทั้งหมด", data.total],
    ["ยืนยันลงหนังสือ", data.submitted],
    ["ยังไม่ตอบ", data.pending],
    ["ไม่ประสงค์ลง", data.declined],
    ["ส่งรูปแล้ว", data.withPhoto],
    ["บัญชีผู้ใช้ระบบ", data.userCount]
  ];

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>ภาพรวมข้อมูล</h3>
        <button className="ghost" onClick={reload}><RefreshCw /> รีเฟรช</button>
      </div>
      <div className="stat-cards">
        {cards.map(([label, value]) => (
          <div key={label}><span>{label}</span><strong>{value ?? 0}</strong></div>
        ))}
      </div>

      <h4>จำนวนผู้ยืนยันแยกตามรุ่น</h4>
      {data.byBatch?.length ? (
        <div className="batch-grid">
          {data.byBatch.map((item) => (
            <div key={item.batch}><span>รุ่น {item.batch}</span><strong>{item.responses}</strong></div>
          ))}
        </div>
      ) : <p className="empty">ยังไม่มีผู้ยืนยันข้อมูล</p>}

      <h4>การนำเข้าล่าสุด</h4>
      {data.lastImports?.length ? (
        <table className="data-table">
          <thead><tr><th>ไฟล์</th><th>โดย</th><th>เพิ่มใหม่</th><th>อัปเดต</th><th>ข้าม</th><th>เวลา</th></tr></thead>
          <tbody>
            {data.lastImports.map((job) => (
              <tr key={job.jobId}>
                <td>{job.filename}{job.dryRun && <em> (ทดลอง)</em>}</td>
                <td>{job.uploadedByUsername}</td>
                <td>{job.inserted}</td>
                <td>{job.updated}</td>
                <td>{job.skipped}</td>
                <td>{formatTime(job.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="empty">ยังไม่เคยนำเข้าไฟล์</p>}
    </div>
  );
}

/* ------------------------------ alumni records ---------------------------- */

function AlumniTable({ user }) {
  const scoped = user.batchScope?.length ? user.batchScope : null;
  const [batch, setBatch] = useState(scoped ? String(scoped[0]) : "");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState({ batch: scoped ? String(scoped[0]) : "", status: "", query: "" });
  const [message, setMessage] = useState("");

  const { loading, data, error, reload } = useAsync(() => {
    const params = new URLSearchParams();
    if (applied.batch) params.set("batch", applied.batch);
    if (applied.status) params.set("status", applied.status);
    if (applied.query) params.set("q", applied.query);
    params.set("limit", "200");
    return api(`/api/admin/alumni?${params}`);
  }, [applied]);

  async function updateStatus(record, nextStatus) {
    setMessage("");
    try {
      await api(`/api/admin/alumni/${record.id}`, { method: "PATCH", body: { status: nextStatus } });
      setMessage(`อัปเดตสถานะของ ${record.legalFirstName} ${record.legalLastName} แล้ว`);
      reload();
    } catch (updateError) {
      setMessage(updateError.message);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>รายชื่อนิสิตเก่า</h3>
        <button className="ghost" onClick={reload}><RefreshCw /> รีเฟรช</button>
      </div>

      <form className="filters" onSubmit={(event) => { event.preventDefault(); setApplied({ batch, status, query }); }}>
        {scoped ? (
          <label className="field"><span>รุ่น</span>
            <select value={batch} onChange={(event) => setBatch(event.target.value)}>
              {scoped.map((item) => <option key={item} value={item}>รุ่น {item}</option>)}
            </select>
          </label>
        ) : (
          <Field label="รุ่น" value={batch} setValue={(value) => setBatch(value.replace(/\D/g, "").slice(0, 2))} placeholder="ทุกรุ่น" inputMode="numeric" />
        )}
        <label className="field"><span>สถานะ</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">ทุกสถานะ</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <Field label="ค้นหาชื่อ / รหัสนิสิต" value={query} setValue={setQuery} placeholder="เช่น สมชาย" />
        <button className="next compact-btn">ค้นหา</button>
      </form>

      <Alert>{error}</Alert>
      {message && <Alert tone="ok">{message}</Alert>}

      {loading ? <p className="console-loading">กำลังโหลด…</p> : (
        <table className="data-table">
          <thead>
            <tr><th>รุ่น</th><th>ชื่อสมัยเรียน</th><th>ชื่อในหนังสือ</th><th>สถานะ</th><th>รูป</th><th>ติดต่อ</th><th>จัดการ</th></tr>
          </thead>
          <tbody>
            {(data?.records || []).map((record) => (
              <tr key={record.id}>
                <td>{record.batch}</td>
                <td>{record.legalFirstName} {record.legalLastName}<br /><small>{record.studentId}</small></td>
                <td>{record.currentFirstName} {record.currentLastName}</td>
                <td><span className={`status-chip status-${record.status}`}>{STATUS_LABELS[record.status]}</span></td>
                <td>{record.photo?.downloadUrl ? <a href={record.photo.downloadUrl} target="_blank" rel="noreferrer">ดูรูป</a> : record.photo?.choice === "placeholder" ? "ใช้ภาพคณะ" : "—"}</td>
                <td>{(record.contacts || []).map((contact) => contact.type).join(", ") || "—"}</td>
                <td>
                  <select value={record.status} onChange={(event) => updateStatus(record, event.target.value)}>
                    {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            {!data?.records?.length && <tr><td colSpan="7" className="empty">ไม่พบข้อมูลตามเงื่อนไข</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ----------------------------- import / export ---------------------------- */

function ImportExport({ canReset }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportBatch, setExportBatch] = useState("");
  const [progress, setProgress] = useState(null);

  const CHUNK_SIZE = 400;

  function describeError(error) {
    return [error.message, error.details?.headersFound ? `พบคอลัมน์ในไฟล์: ${error.details.headersFound.join(", ")}` : ""]
      .filter(Boolean)
      .join(" — ");
  }

  /** Parse and validate only — nothing is saved yet. */
  async function check() {
    if (!file) return setMessage("กรุณาเลือกไฟล์ก่อน");
    setBusy(true);
    setMessage("");
    setResult(null);
    setProgress({ phase: "reading", percent: 0, done: 0, total: 0 });
    try {
      const body = new FormData();
      body.append("file", file);
      const data = await api("/api/admin/import/prepare", { method: "POST", body });
      setPreview(data.job);
      setProgress(null);
    } catch (error) {
      setProgress(null);
      setMessage(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Save in slices so the bar reflects real work done. Each slice is written
   * and acknowledged by the server before the next one is sent.
   */
  async function runImport() {
    const job = preview;
    if (!job) return setMessage("กรุณากด “ตรวจสอบไฟล์ก่อน” ก่อนนำเข้าจริง");

    const startedAt = new Date().toISOString();
    const entries = job.entries || [];
    setBusy(true);
    setMessage("");
    setResult(null);
    setProgress({ phase: "writing", percent: 0, done: 0, total: entries.length });

    let inserted = 0;
    let updated = 0;
    try {
      for (let start = 0; start < entries.length; start += CHUNK_SIZE) {
        const slice = entries.slice(start, start + CHUNK_SIZE);
        const written = await api("/api/admin/import/chunk", {
          method: "POST",
          body: { jobId: job.jobId, filename: job.filename, entries: slice }
        });
        inserted += written.inserted;
        updated += written.updated;
        const done = Math.min(start + slice.length, entries.length);
        setProgress({ phase: "writing", percent: Math.round((done / entries.length) * 100), done, total: entries.length });
      }

      setProgress({ phase: "finishing", percent: 100, done: entries.length, total: entries.length });
      const { job: saved } = await api("/api/admin/import/commit", {
        method: "POST",
        body: {
          jobId: job.jobId,
          filename: job.filename,
          headers: job.headers,
          startedAt,
          status: "completed",
          totalRows: job.totalRows,
          validRows: job.validRows,
          inserted,
          updated,
          duplicateRows: job.duplicateRows,
          skipped: job.skipped,
          errors: job.errors
        }
      });
      setResult(saved);
      setPreview(null);
      setProgress({ phase: "done", percent: 100, done: entries.length, total: entries.length });
    } catch (error) {
      // Report how far it actually got — the slices already written are saved.
      setProgress((current) => (current ? { ...current, phase: "failed" } : null));
      setMessage(`${describeError(error)} — บันทึกสำเร็จไปแล้ว ${(inserted + updated).toLocaleString("th-TH")} รายการ สามารถกด “นำเข้าจริง” ซ้ำเพื่อทำต่อได้`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>นำเข้าฐานรายชื่อจาก Excel</h3>
      <p className="panel-note">
        คอลัมน์ที่จำเป็น: <strong>ชื่อ, นามสกุล, รุ่น, เลขท้ายบัตรประชาชน 5 หลัก</strong> — แนะนำอย่างยิ่งให้มี <strong>รหัสนิสิต</strong>
        เพื่อให้การนำเข้าครั้งถัดไปเป็นการอัปเดตระเบียนเดิมแทนการสร้างซ้ำ
        <br />
        คอลัมน์เพิ่มเติมที่รองรับ: ชื่อปัจจุบัน, นามสกุลปัจจุบัน, อีเมลสำหรับติดต่อ, เบอร์โทรสำหรับติดต่อ, คำนำหน้า และหมายเหตุ
        <br />
        ลำดับคอลัมน์สลับกันได้ และ<strong>ข้อมูลที่นิสิตเก่ากรอกไว้แล้วจะไม่ถูกทับ</strong> — กดปุ่มด้านล่างเพื่อดาวน์โหลดไฟล์ต้นแบบพร้อมคำแนะนำการกรอก
      </p>

      <div className="button-row">
        <button className="ghost" onClick={() => download("/api/admin/import/template.xlsx", "แบบฟอร์มรายชื่อนิสิตเก่า.xlsx")}>
          <Download /> ไฟล์ต้นแบบเปล่า (ใช้กรอกข้อมูลจริง)
        </button>
        <button className="ghost" onClick={() => download("/api/admin/import/template.xlsx?rows=8000", "ตัวอย่างข้อมูลนิสิตเก่า-8000-รายการ.xlsx")}>
          <Download /> ไฟล์ตัวอย่างพร้อมข้อมูล 8,000 รายการ
        </button>
      </div>
      <p className="panel-note">
        ไฟล์ตัวอย่างเป็น<strong>ข้อมูลสมมติทั้งหมด ไม่ใช่ข้อมูลของบุคคลจริง</strong> ใช้ทดลองนำเข้าเพื่อดูว่าระบบทำงานอย่างไรที่ปริมาณจริง
        เมื่อทดสอบเสร็จให้กด “ล้างข้อมูลทั้งหมด” ด้านล่างก่อนนำเข้าข้อมูลจริง
      </p>

      <label className="file-drop">
        <Upload />
        <strong>{file?.name || "กดเพื่อเลือกไฟล์ .xlsx หรือ .csv"}</strong>
        <small>ระบบจะตรวจสอบข้อมูลให้ก่อน แล้วจึงยืนยันบันทึกจริง</small>
        <input type="file" accept=".xlsx,.csv" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setResult(null); setMessage(""); setProgress(null); }} />
      </label>

      <div className="button-row">
        <button className="ghost" disabled={busy || !file} onClick={check}>1. ตรวจสอบไฟล์ก่อน</button>
        <button className="next compact-btn" disabled={busy || !preview} onClick={runImport}>2. นำเข้าจริง</button>
      </div>

      <ProgressBar progress={progress} />
      <Alert>{message}</Alert>
      {preview && <ImportReport job={preview} title="ผลการตรวจสอบ — ยังไม่บันทึก กด “นำเข้าจริง” เพื่อบันทึก" />}
      {result && <ImportReport job={result} title="นำเข้าเรียบร้อยแล้ว" tone="ok" />}

      <h3 className="section-gap">ส่งออกข้อมูล</h3>
      <p className="panel-note">
        ไฟล์ส่งออกไม่มีเลขบัตรประชาชนหรือค่าแฮชใด ๆ ลิงก์รูปภาพถือเป็นข้อมูลลับ
        <br />
        <strong>ไฟล์สำหรับทีมออกแบบ</strong> มีเฉพาะข้อมูลที่นิสิตเก่ายินยอมให้ลงหนังสือ ส่วน
        <strong> ไฟล์สำหรับติดตามงาน</strong> จะเพิ่มอีเมลและเบอร์โทรที่ผู้ดูแลใช้ติดต่อ — ห้ามส่งต่อให้ทีมออกแบบ
      </p>
      <div className="filters">
        <Field label="ระบุรุ่น (เว้นว่าง = ทุกรุ่น)" value={exportBatch} setValue={(value) => setExportBatch(value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" />
        <button
          className="next compact-btn"
          onClick={() => download(`/api/admin/export.xlsx${exportBatch ? `?batch=${exportBatch}` : ""}`, `yearbook-2569${exportBatch ? `-batch-${exportBatch}` : ""}.xlsx`)}
        >
          <Download /> ไฟล์สำหรับทีมออกแบบ
        </button>
        <button
          className="ghost compact-btn"
          onClick={() => download(
            `/api/admin/export.xlsx?includeOutreach=true${exportBatch ? `&batch=${exportBatch}` : ""}`,
            `yearbook-2569${exportBatch ? `-batch-${exportBatch}` : ""}-followup.xlsx`
          )}
        >
          <Download /> ไฟล์สำหรับติดตามงาน
        </button>
      </div>

      <DangerZone canReset={canReset} />
    </div>
  );
}

/** Owner-only wipe, used to clear test data before the real round begins. */
function DangerZone({ canReset }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);
  const PHRASE = "ล้างข้อมูลทั้งหมด";

  async function reset() {
    if (!window.confirm(`ยืนยันล้างข้อมูลนิสิตเก่าทั้งหมด?\n\nการกระทำนี้ย้อนกลับไม่ได้ และจะลบระเบียนนิสิตเก่า ข้อมูลที่ส่งเข้ามา ประวัติการนำเข้า และรูปภาพทั้งหมด`)) return;
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      const data = await api("/api/admin/reset", { method: "POST", body: { confirm } });
      setResult(data.deleted);
      setConfirm("");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="danger-zone">
      <h3>ล้างข้อมูลทั้งหมด</h3>
      <p className="panel-note">
        ใช้เมื่อทดสอบระบบเสร็จแล้วและต้องการเริ่มใช้งานจริงจากฐานข้อมูลว่าง
        <br />
        <strong>จะถูกลบ:</strong> ระเบียนนิสิตเก่า ข้อมูลที่นิสิตเก่าส่งเข้ามา ประวัติการนำเข้า และรูปภาพทั้งหมดใน Storage
        <br />
        <strong>จะไม่ถูกลบ:</strong> บัญชีผู้ใช้ระบบ การตั้งค่า และบันทึกการใช้งาน
        <br />
        การกระทำนี้ <strong>ย้อนกลับไม่ได้</strong> และทำได้เฉพาะเจ้าของระบบเท่านั้น
      </p>
      {canReset ? (
        <div className="filters">
          <Field label={`พิมพ์ "${PHRASE}" เพื่อยืนยัน`} value={confirm} setValue={setConfirm} placeholder={PHRASE} />
          <button className="danger-btn compact-btn" disabled={busy || confirm.trim() !== PHRASE} onClick={reset}>
            <Trash2 /> {busy ? "กำลังล้างข้อมูล…" : "ล้างข้อมูลทั้งหมด"}
          </button>
        </div>
      ) : (
        <Alert tone="warn">
          บัญชีของท่านเป็นผู้ดูแลระบบ จึงไม่มีสิทธิ์ล้างข้อมูล — กรุณาออกจากระบบแล้วเข้าใหม่ด้วย
          <strong> บัญชีเจ้าของระบบ</strong> เพื่อใช้งานส่วนนี้
        </Alert>
      )}
      <Alert>{message}</Alert>
      {result && (
        <Alert tone="ok">
          ล้างข้อมูลเรียบร้อยแล้ว — ระเบียนนิสิตเก่า {result.alumni.toLocaleString("th-TH")} รายการ,
          ข้อมูลที่ส่งเข้ามา {result.submissions.toLocaleString("th-TH")} รายการ,
          ประวัติการนำเข้า {result.importJobs.toLocaleString("th-TH")} รายการ,
          รูปภาพ {result.photos.toLocaleString("th-TH")} ไฟล์ — ระบบพร้อมเริ่มใช้งานจริงแล้ว
        </Alert>
      )}
    </div>
  );
}

const PROGRESS_LABELS = {
  reading: "กำลังอ่านและตรวจสอบไฟล์…",
  writing: "กำลังบันทึกลงฐานข้อมูล",
  finishing: "กำลังบันทึกประวัติการนำเข้า…",
  done: "นำเข้าเสร็จสมบูรณ์",
  failed: "การนำเข้าหยุดกลางคัน"
};

function ProgressBar({ progress }) {
  if (!progress) return null;
  const { phase, percent, done, total } = progress;
  const indeterminate = phase === "reading" || phase === "finishing";
  const thai = (value) => value.toLocaleString("th-TH");

  return (
    <div className={`progress-panel phase-${phase}`}>
      <div className="progress-head">
        <strong>{PROGRESS_LABELS[phase]}</strong>
        {phase === "writing" && <span>{thai(done)} / {thai(total)} รายการ ({percent}%)</span>}
        {phase === "done" && <span>{thai(total)} รายการ</span>}
        {phase === "failed" && <span>บันทึกแล้ว {thai(done)} จาก {thai(total)} รายการ</span>}
      </div>
      <div className="progress-track" role="progressbar" aria-valuenow={indeterminate ? undefined : percent} aria-valuemin="0" aria-valuemax="100">
        <div className={indeterminate ? "progress-fill indeterminate" : "progress-fill"} style={indeterminate ? undefined : { width: `${percent}%` }} />
      </div>
      {phase === "writing" && <small>กรุณาอย่าปิดหน้านี้จนกว่าจะเสร็จ — หากหลุดกลางคัน ข้อมูลที่บันทึกไปแล้วจะยังอยู่ และกดนำเข้าซ้ำได้</small>}
    </div>
  );
}

function ImportReport({ job, title, tone }) {
  return (
    <div className={`import-report ${tone === "ok" ? "ok" : ""}`}>
      <h4>{title}</h4>
      <div className="stat-cards small">
        <div><span>แถวทั้งหมด</span><strong>{job.totalRows}</strong></div>
        <div><span>ใช้งานได้</span><strong>{job.validRows}</strong></div>
        <div><span>เพิ่มใหม่</span><strong>{job.inserted}</strong></div>
        <div><span>อัปเดต</span><strong>{job.updated}</strong></div>
        <div><span>ข้าม</span><strong>{job.skipped}</strong></div>
      </div>
      <p className="panel-note">คอลัมน์ที่อ่านได้: {job.headers?.join(", ")}</p>
      {job.errors?.length > 0 && (
        <details>
          <summary>ดูแถวที่ข้าม ({job.errors.length})</summary>
          <ul className="error-list">
            {job.errors.map((item) => <li key={item.rowNumber}>แถวที่ {item.rowNumber}: {item.errors.join(", ")}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

/* ------------------------------ user manager ------------------------------ */

function UserManager({ user }) {
  const { loading, data, error, reload } = useAsync(() => api("/api/admin/users"));
  const [form, setForm] = useState({ username: "", displayName: "", email: "", role: "staff", batchScope: "", alumniId: "", password: "" });
  const [message, setMessage] = useState("");
  const [credential, setCredential] = useState(null);
  const [busy, setBusy] = useState(false);

  const assignableRoles = Object.keys(ROLE_LABELS).filter((role) => role !== "owner" && (user.role === "owner" || role !== "admin"));

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setCredential(null);
    try {
      const payload = {
        username: form.username,
        displayName: form.displayName,
        email: form.email,
        role: form.role,
        batchScope: form.role === "staff" ? form.batchScope.split(/[,\s]+/).filter(Boolean) : null,
        alumniId: form.role === "alumni" ? form.alumniId : null
      };
      if (form.password) payload.password = form.password;
      const data = await api("/api/admin/users", { method: "POST", body: payload });
      setCredential({ username: data.user.username, password: data.initialPassword });
      setForm({ username: "", displayName: "", email: "", role: "staff", batchScope: "", alumniId: "", password: "" });
      reload();
    } catch (createError) {
      setMessage(createError.message);
    } finally {
      setBusy(false);
    }
  }

  async function act(target, action) {
    setMessage("");
    setCredential(null);
    try {
      if (action === "reset") {
        const data = await api(`/api/admin/users/${target.uid}/reset-password`, { method: "POST" });
        setCredential({ username: target.username, password: data.temporaryPassword });
      } else if (action === "delete") {
        if (!window.confirm(`ยืนยันลบบัญชี ${target.username}?`)) return;
        await api(`/api/admin/users/${target.uid}`, { method: "DELETE" });
      } else {
        await api(`/api/admin/users/${target.uid}`, { method: "PATCH", body: { status: target.status === "active" ? "suspended" : "active" } });
      }
      reload();
    } catch (actionError) {
      setMessage(actionError.message);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>ผู้ใช้งานระบบ</h3>
        <button className="ghost" onClick={reload}><RefreshCw /> รีเฟรช</button>
      </div>

      <form className="user-form" onSubmit={create}>
        <h4>สร้างบัญชีใหม่</h4>
        <div className="form-grid">
          <Field label="ชื่อผู้ใช้" value={form.username} setValue={(value) => setForm({ ...form, username: value })} placeholder="เช่น somchai.admin" />
          <Field label="ชื่อที่แสดง" value={form.displayName} setValue={(value) => setForm({ ...form, displayName: value })} />
          <Field label="อีเมล (ไม่บังคับ)" value={form.email} setValue={(value) => setForm({ ...form, email: value })} type="email" />
          <label className="field"><span>บทบาท</span>
            <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
              {assignableRoles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
            </select>
          </label>
          {form.role === "staff" && <Field label="รุ่นที่ดูแล" value={form.batchScope} setValue={(value) => setForm({ ...form, batchScope: value })} placeholder="เช่น 45, 46" hint="(คั่นด้วยเครื่องหมายจุลภาค)" />}
          {form.role === "alumni" && <Field label="รหัสระเบียนนิสิตเก่า" value={form.alumniId} setValue={(value) => setForm({ ...form, alumniId: value })} placeholder="เช่น s-2676061" />}
          <Field label="รหัสผ่านเริ่มต้น" value={form.password} setValue={(value) => setForm({ ...form, password: value })} placeholder="เว้นว่างเพื่อให้ระบบสุ่มให้" />
        </div>
        <button className="next compact-btn" disabled={busy || !form.username}><UserPlus /> สร้างบัญชี</button>
      </form>

      <Alert>{message || error}</Alert>
      {credential && (
        <div className="credential-box">
          <strong>รหัสผ่านชั่วคราวของ {credential.username}</strong>
          <code>{credential.password || "(ใช้รหัสผ่านที่ท่านกำหนดเอง)"}</code>
          <small>แสดงเพียงครั้งเดียวเท่านั้น กรุณาคัดลอกและส่งให้เจ้าของบัญชีผ่านช่องทางที่ปลอดภัย ระบบจะบังคับให้เปลี่ยนรหัสผ่านเมื่อเข้าใช้งานครั้งแรก</small>
        </div>
      )}

      {loading ? <p className="console-loading">กำลังโหลด…</p> : (
        <table className="data-table">
          <thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อที่แสดง</th><th>บทบาท</th><th>ขอบเขต</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th>จัดการ</th></tr></thead>
          <tbody>
            {(data?.users || []).map((item) => (
              <tr key={item.uid}>
                <td>{item.username}{item.mustChangePassword && <small className="pending-flag"> ยังไม่ตั้งรหัสผ่าน</small>}</td>
                <td>{item.displayName}</td>
                <td><span className={`role-chip role-${item.role}`}>{item.roleLabel}</span></td>
                <td>{item.batchScope?.join(", ") || (item.alumniId ? item.alumniId : "ทั้งระบบ")}</td>
                <td>{item.status === "active" ? "ใช้งาน" : "ระงับ"}</td>
                <td>{item.lastLoginAt ? formatTime(item.lastLoginAt) : "—"}</td>
                <td className="row-actions">
                  {item.uid !== user.uid && item.role !== "owner" && (
                    <>
                      <button onClick={() => act(item, "reset")}><KeyRound /> รีเซ็ตรหัส</button>
                      <button onClick={() => act(item, "toggle")}>{item.status === "active" ? "ระงับ" : "เปิดใช้"}</button>
                      <button className="danger" onClick={() => act(item, "delete")}><Trash2 /> ลบ</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* -------------------------------- settings -------------------------------- */

function SettingsPanel() {
  const { loading, data, error, reload } = useAsync(() => api("/api/admin/settings"));
  const [draft, setDraft] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => { if (data?.settings) setDraft(data.settings); }, [data]);

  async function save(event) {
    event.preventDefault();
    setMessage("");
    try {
      await api("/api/admin/settings", { method: "PUT", body: draft });
      setMessage("บันทึกการตั้งค่าแล้ว");
      reload();
    } catch (saveError) {
      setMessage(saveError.message);
    }
  }

  if (loading || !draft) return <p className="console-loading">กำลังโหลด…</p>;

  return (
    <div className="panel">
      <h3>ตั้งค่าระบบ</h3>
      <Alert>{error}</Alert>
      {message && <Alert tone="ok">{message}</Alert>}
      <form onSubmit={save}>
        <label className="switch-row">
          <input type="checkbox" checked={draft.submissionOpen} onChange={(event) => setDraft({ ...draft, submissionOpen: event.target.checked })} />
          <span>เปิดรับข้อมูลจากนิสิตเก่า</span>
        </label>
        <div className="form-grid">
          <Field label="ข้อความเมื่อปิดรับข้อมูล" value={draft.closedMessage} setValue={(value) => setDraft({ ...draft, closedMessage: value })} />
          <Field label="ชื่อหนังสือ" value={draft.bookTitle} setValue={(value) => setDraft({ ...draft, bookTitle: value })} />
          <Field label="รุ่นสูงสุด" value={String(draft.maxBatch)} setValue={(value) => setDraft({ ...draft, maxBatch: Number(value.replace(/\D/g, "")) || 88 })} inputMode="numeric" />
          <Field label="ความยาวประวัติสูงสุด" value={String(draft.bioMaxLength)} setValue={(value) => setDraft({ ...draft, bioMaxLength: Number(value.replace(/\D/g, "")) || 500 })} inputMode="numeric" />
          <Field label="เวอร์ชันคำยินยอม PDPA" value={draft.pdpaVersion} setValue={(value) => setDraft({ ...draft, pdpaVersion: value })} hint="(เปลี่ยนเมื่อแก้ข้อความคำยินยอม)" />
        </div>
        <button className="next compact-btn">บันทึกการตั้งค่า</button>
      </form>
    </div>
  );
}

/* ------------------------------- audit log -------------------------------- */

function AuditLog() {
  const { loading, data, error, reload } = useAsync(() => api("/api/admin/audit?limit=150"));
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>บันทึกการใช้งาน</h3>
        <button className="ghost" onClick={reload}><RefreshCw /> รีเฟรช</button>
      </div>
      <p className="panel-note">บันทึกเก็บเฉพาะรหัสอ้างอิงและค่าแฮชของหมายเลข IP ไม่มีข้อมูลส่วนบุคคล</p>
      <Alert>{error}</Alert>
      {loading ? <p className="console-loading">กำลังโหลด…</p> : (
        <table className="data-table">
          <thead><tr><th>เวลา</th><th>ผู้ทำรายการ</th><th>การกระทำ</th><th>เป้าหมาย</th><th>รายละเอียด</th></tr></thead>
          <tbody>
            {(data?.logs || []).map((log) => (
              <tr key={log.id}>
                <td>{formatTime(log.at)}</td>
                <td>{log.actorUsername || "—"}</td>
                <td><code>{log.action}</code></td>
                <td>{log.targetId || "—"}</td>
                <td className="meta-cell">{Object.keys(log.meta || {}).length ? JSON.stringify(log.meta) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return value;
  }
}

export function signOut() {
  session.clear();
}
