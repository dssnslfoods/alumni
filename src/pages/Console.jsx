import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Palette,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
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

/** ต้องตรงกับ FOLLOW_UP_STATES ที่ server/domain/alumni.js */
const FOLLOW_UP_LABELS = {
  none: "ยังไม่ได้ติดตาม",
  contacted: "ติดต่อแล้ว รอส่งข้อมูล",
  unreachable: "ติดต่อไม่ได้",
  abroad: "อยู่ต่างประเทศ",
  declinedByPhone: "แจ้งไม่ประสงค์ลง (ทางโทรศัพท์)",
  deceased: "เสียชีวิต"
};

export function Console({ user, onSignOut, onChangePassword }) {
  const canManageUsers = ["owner", "admin"].includes(user.role);
  const canImport = ["owner", "admin"].includes(user.role);

  const tabs = useMemo(() => [
    { key: "overview", label: "ภาพรวม", icon: LayoutDashboard, show: true },
    { key: "alumni", label: "รายชื่อนิสิตเก่า", icon: Users, show: true },
    { key: "import", label: "นำเข้า / ส่งออก", icon: FileSpreadsheet, show: canImport },
    { key: "handoff", label: "ส่งมอบงานออกแบบ", icon: Palette, show: canImport },
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
        {tab === "import" && <ImportExport canReset={["owner", "admin"].includes(user.role)} />}
        {tab === "handoff" && <HandoffPanel user={user} />}
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

function Overview({ user }) {
  const { loading, data, error, reload } = useAsync(() => api("/api/admin/summary"));
  if (loading) return <p className="console-loading">กำลังโหลดข้อมูล…</p>;
  if (error) return <Alert>{error}</Alert>;

  const thai = (value) => Number(value || 0).toLocaleString("th-TH");
  const scoped = user?.batchScope?.length ? user.batchScope : null;
  const batches = scoped ? data.byBatch.filter((item) => scoped.includes(item.batch)) : data.byBatch;

  return (
    <div className="dashboard">
      <div className="panel-head dash-head">
        <div>
          <h3>ภาพรวมการจัดทำหนังสืออนุสรณ์</h3>
          <p className="panel-note">
            อัปเดตล่าสุดเมื่อ {data.lastSubmittedAt ? formatTime(data.lastSubmittedAt) : "ยังไม่มีผู้ส่งข้อมูล"}
            {" · "}7 วันที่ผ่านมามีผู้ส่งเพิ่ม {thai(data.submittedLast7Days)} คน
          </p>
        </div>
        <button className="ghost" onClick={reload}><RefreshCw /> รีเฟรช</button>
      </div>

      {/* แถวบน: ความคืบหน้าโดยรวม */}
      <div className="dash-hero">
        <Donut
          percent={data.submittedRate}
          label="ยืนยันลงหนังสือ"
          caption={`${thai(data.submitted)} จาก ${thai(data.total)} คน`}
        />
        <div className="dash-hero-stats">
          <StatusBar
            total={data.total}
            segments={[
              { key: "submitted", label: "ยืนยันลงหนังสือ", value: data.submitted, tone: "ok" },
              { key: "pending", label: "ยังไม่ตอบ", value: data.pending, tone: "wait" },
              { key: "declined", label: "ไม่ประสงค์ลง", value: data.declined, tone: "no" }
            ]}
          />
          <div className="kpi-row">
            <Kpi label="อัตราการตอบกลับ" value={`${data.responseRate}%`} note="ตอบแล้วทั้งยืนยันและปฏิเสธ" />
            <Kpi label="ส่งรูปถ่ายแล้ว" value={`${data.photoRate}%`} note={`${thai(data.withPhoto)} คน · ${(data.photoBytes / 1024 / 1024).toFixed(0)} MB`} />
            <Kpi label="รุ่นที่มีข้อมูล" value={thai(data.batchesWithData)} note={`จากทั้งหมด ${thai(data.maxBatch || 82)} รุ่น`} />
            <Kpi label="เปลี่ยนชื่อ-สกุล" value={thai(data.nameChanged)} note="เทียบกับทะเบียนเดิม" />
          </div>
        </div>
      </div>

      {/* สถานะการนำเข้ารายรุ่น */}
      <div className="dash-card">
        <h4>สถานะการนำเข้าข้อมูลรายรุ่น</h4>
        <BatchCoverage byBatch={data.byBatch} maxBatch={data.maxBatch || 82} />
      </div>

      {/* แนวโน้มรายวัน */}
      <div className="dash-card">
        <h4>ผู้ส่งข้อมูลราย 14 วันล่าสุด</h4>
        <Sparkline points={data.daily} />
      </div>

      {/* ความครบถ้วนของข้อมูล */}
      <div className="dash-grid">
        <div className="dash-card">
          <h4>ความครบถ้วนของข้อมูลที่ยืนยันแล้ว</h4>
          <Completeness
            total={data.submitted}
            items={[
              { label: "มีรูปถ่าย", value: data.withPhoto },
              { label: "มีประวัติโดยย่อ", value: data.withBio },
              { label: "เคยเป็นอาจารย์", value: data.faculty },
              { label: "มีช่องทางติดต่อ", value: data.withContacts }
            ]}
          />
          {data.withoutPhoto > 0 && (
            <p className="dash-hint">
              มี {thai(data.withoutPhoto)} คนที่ต้องใช้ภาพคณะแทน — ทีมออกแบบต้องเตรียมภาพสำรองจำนวนเท่านี้
            </p>
          )}
        </div>

        <div className="dash-card">
          <h4>รุ่นที่ตอบกลับมากที่สุด</h4>
          <RankList items={data.topBatches} tone="ok" />
          <h4 className="dash-gap">รุ่นที่ควรติดตาม</h4>
          <RankList items={data.lowBatches} tone="warn" />
        </div>
      </div>

      {/* รายรุ่น */}
      <div className="dash-card">
        <h4>ความคืบหน้ารายรุ่น</h4>
        {batches.length ? <BatchBars batches={batches} /> : <p className="empty">ยังไม่มีข้อมูล</p>}
      </div>

      <div className="dash-card">
        <h4>การนำเข้าล่าสุด</h4>
        {data.lastImports?.length ? (
          <table className="data-table">
            <thead><tr><th>ไฟล์</th><th>โดย</th><th>เพิ่มใหม่</th><th>อัปเดต</th><th>ข้าม</th><th>เวลา</th></tr></thead>
            <tbody>
              {data.lastImports.map((job) => (
                <tr key={job.jobId}>
                  <td>{job.filename}{job.dryRun && <em> (ทดลอง)</em>}</td>
                  <td>{job.uploadedByUsername}</td>
                  <td>{thai(job.inserted)}</td>
                  <td>{thai(job.updated)}</td>
                  <td>{thai(job.skipped)}</td>
                  <td>{formatTime(job.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="empty">ยังไม่เคยนำเข้าไฟล์</p>}
      </div>
    </div>
  );
}

/** Progress ring. Drawn with stroke-dasharray so it needs no chart library. */
function Donut({ percent, label, caption }) {
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  const radius = 66;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="donut">
      <svg viewBox="0 0 160 160" role="img" aria-label={`${label} ${safe}%`}>
        <circle cx="80" cy="80" r={radius} className="donut-track" />
        <circle
          cx="80"
          cy="80"
          r={radius}
          className="donut-value"
          strokeDasharray={`${(circumference * safe) / 100} ${circumference}`}
          transform="rotate(-90 80 80)"
        />
        <text x="80" y="74" className="donut-number">{safe}%</text>
        <text x="80" y="98" className="donut-caption">{label}</text>
      </svg>
      <small>{caption}</small>
    </div>
  );
}

function StatusBar({ total, segments }) {
  const safeTotal = total || 1;
  return (
    <div className="status-bar">
      <div className="status-track">
        {segments.map((segment) => segment.value > 0 && (
          <div
            key={segment.key}
            className={`status-seg seg-${segment.tone}`}
            style={{ width: `${(segment.value / safeTotal) * 100}%` }}
            title={`${segment.label} ${segment.value}`}
          />
        ))}
      </div>
      <ul className="status-legend">
        {segments.map((segment) => (
          <li key={segment.key}>
            <i className={`seg-${segment.tone}`} />
            {segment.label}
            <strong>{Number(segment.value || 0).toLocaleString("th-TH")}</strong>
            <em>{Math.round((segment.value / safeTotal) * 100)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Kpi({ label, value, note }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function Sparkline({ points }) {
  const max = Math.max(1, ...points.map((item) => item.count));
  return (
    <div className="sparkline">
      {points.map((item) => (
        <div key={item.day} className="spark-col" title={`${item.day} — ${item.count} คน`}>
          <div className="spark-bar" style={{ height: `${Math.max((item.count / max) * 100, item.count ? 6 : 2)}%` }} />
          <small>{item.day.slice(8)}</small>
        </div>
      ))}
    </div>
  );
}

function Completeness({ total, items }) {
  const safeTotal = total || 1;
  return (
    <div className="completeness">
      {items.map((item) => {
        const percent = Math.round((item.value / safeTotal) * 100);
        return (
          <div key={item.label}>
            <div className="completeness-head"><span>{item.label}</span><strong>{percent}%</strong></div>
            <div className="mini-track"><div className="mini-fill" style={{ width: `${percent}%` }} /></div>
            <small>{Number(item.value || 0).toLocaleString("th-TH")} จาก {Number(total || 0).toLocaleString("th-TH")} คน</small>
          </div>
        );
      })}
    </div>
  );
}

function RankList({ items, tone }) {
  if (!items?.length) return <p className="empty">ยังไม่มีข้อมูลมากพอ</p>;
  return (
    <ol className={`rank-list rank-${tone}`}>
      {items.map((item) => (
        <li key={item.batch}>
          <span>รุ่น {item.batch}</span>
          <div className="mini-track"><div className="mini-fill" style={{ width: `${item.rate}%` }} /></div>
          <strong>{item.rate}%</strong>
          <small>{item.submitted}/{item.roster}</small>
        </li>
      ))}
    </ol>
  );
}

function BatchCoverage({ byBatch, maxBatch }) {
  const imported = new Set(byBatch.map((item) => item.batch));
  const missing = [];
  for (let i = 1; i <= maxBatch; i++) {
    if (!imported.has(i)) missing.push(i);
  }
  return (
    <div className="batch-coverage">
      <p className="batch-coverage-summary">
        นำเข้าแล้ว <strong>{imported.size}</strong> รุ่น จากทั้งหมด {maxBatch} รุ่น
        {missing.length > 0 && <span> · ขาดอีก <strong>{missing.length}</strong> รุ่น</span>}
      </p>
      <div className="batch-coverage-grid">
        {Array.from({ length: maxBatch }, (_, i) => {
          const batch = i + 1;
          const entry = byBatch.find((item) => item.batch === batch);
          return (
            <div
              key={batch}
              className={`batch-cell${entry ? " imported" : ""}`}
              title={entry ? `รุ่น ${batch} — ${entry.roster} คน` : `รุ่น ${batch} — ยังไม่ได้นำเข้า`}
            >
              {batch}
            </div>
          );
        })}
      </div>
      {missing.length > 0 && missing.length <= 20 && (
        <p className="batch-coverage-missing">รุ่นที่ยังไม่ได้นำเข้า: {missing.join(", ")}</p>
      )}
    </div>
  );
}

function BatchBars({ batches }) {
  const max = Math.max(1, ...batches.map((item) => item.roster));
  return (
    <div className="batch-bars">
      {batches.map((item) => (
        <div key={item.batch} className="batch-bar" title={`รุ่น ${item.batch} — ยืนยัน ${item.submitted} จาก ${item.roster} คน (${item.rate}%)`}>
          <div className="batch-bar-track">
            <div className="batch-bar-roster" style={{ height: `${(item.roster / max) * 100}%` }}>
              <div className="batch-bar-done" style={{ height: `${item.rate}%` }} />
            </div>
          </div>
          <small>{item.batch}</small>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ alumni records ---------------------------- */

function AlumniTable({ user }) {
  const scoped = user.batchScope?.length ? user.batchScope : null;
  const [batch, setBatch] = useState(scoped ? scoped.join(", ") : "");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState({ batch: scoped ? scoped.join(", ") : "", status: "", query: "" });
  const [message, setMessage] = useState("");
  const [pageSize, setPageSize] = useState(200);
  const [offset, setOffset] = useState(0);

  // Nothing is fetched until the administrator narrows the view. With 10,000+
  // records, loading "everything" by default is slow and rarely what is wanted.
  const criteriaReady = Boolean(applied.batch.trim()) || applied.query.trim().length >= 2;

  const { loading, data, error, reload } = useAsync(() => {
    if (!criteriaReady) return Promise.resolve(null);
    const params = new URLSearchParams();
    if (applied.batch.trim()) params.set("batch", applied.batch.trim());
    if (applied.status) params.set("status", applied.status);
    if (applied.query.trim()) params.set("q", applied.query.trim());
    params.set("limit", String(pageSize));
    params.set("offset", String(offset));
    return api(`/api/admin/alumni?${params}`);
  }, [applied, pageSize, offset, criteriaReady]);

  const total = data?.total ?? 0;
  const shown = data?.records?.length ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = offset + shown;
  const thai = (value) => Number(value || 0).toLocaleString("th-TH");

  const canEdit = ["owner", "admin"].includes(user.role);

  async function updateFollowUp(record, state) {
    setMessage("");
    const note = state === "none" ? "" : window.prompt(
      `บันทึกเพิ่มเติมสำหรับ ${record.legalFirstName} ${record.legalLastName} (ไม่บังคับ)\nเช่น วันที่โทร ผู้ให้ข้อมูล`,
      record.followUp?.note || ""
    );
    if (note === null) return;
    try {
      await api(`/api/admin/alumni/${record.id}/follow-up`, { method: "PATCH", body: { state, note } });
      setMessage(`บันทึกสถานะติดตามของ ${record.legalFirstName} ${record.legalLastName} แล้ว`);
      reload();
    } catch (updateError) {
      setMessage(updateError.message);
    }
  }

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
        {criteriaReady && <button className="ghost" onClick={reload}><RefreshCw /> รีเฟรช</button>}
      </div>

      <p className="panel-note">
        พิมพ์<strong>รุ่น</strong> (หลายรุ่นได้ คั่นด้วยจุลภาค เช่น <code>45, 46, 47</code>) หรือพิมพ์<strong>ชื่อ/รหัสนิสิต</strong>อย่างน้อย 2 ตัวอักษร
        แล้วกดค้นหา — ระบบจะดึงเฉพาะข้อมูลที่ตรงเงื่อนไข ไม่ดึงทั้งฐานข้อมูลขึ้นมา
      </p>

      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setApplied({ batch, status, query });
        }}
      >
        <Field
          label="รุ่น"
          value={batch}
          setValue={setBatch}
          placeholder={scoped ? scoped.join(", ") : "เช่น 45 หรือ 45, 46, 47"}
          hint="(หลายรุ่นคั่นด้วยจุลภาค)"
          inputMode="numeric"
        />
        <label className="field"><span>สถานะ</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">ทุกสถานะ</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <Field label="ค้นหาชื่อ / รหัสนิสิต" value={query} setValue={setQuery} placeholder="เช่น สมชาย หรือ 4500012" />
        <label className="field"><span>แสดงต่อหน้า</span>
          <select value={pageSize} onChange={(event) => { setOffset(0); setPageSize(Number(event.target.value)); }}>
            {[100, 200, 500, 1000].map((size) => <option key={size} value={size}>{size} รายการ</option>)}
          </select>
        </label>
        <button className="next compact-btn" disabled={!batch.trim() && query.trim().length < 2}>ค้นหา</button>
      </form>

      <Alert>{error}</Alert>
      {message && <Alert tone="ok">{message}</Alert>}

      {!criteriaReady ? (
        <p className="empty">ยังไม่ได้ระบุเงื่อนไข — กรุณาเลือกรุ่น หรือพิมพ์ชื่อที่ต้องการค้นหา แล้วกดปุ่มค้นหา</p>
      ) : loading ? (
        <p className="console-loading">กำลังโหลด…</p>
      ) : (
        <>
          <div className="pager">
            <span>
              {total === 0 ? "ไม่พบข้อมูลตามเงื่อนไข" : <>แสดง <strong>{thai(from)}–{thai(to)}</strong> จากทั้งหมด <strong>{thai(total)}</strong> รายการ</>}
            </span>
            <div className="pager-buttons">
              <button className="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(offset - pageSize, 0))}>
                <ChevronLeft /> ก่อนหน้า
              </button>
              <button className="ghost" disabled={to >= total} onClick={() => setOffset(offset + pageSize)}>
                ถัดไป <ChevronRight />
              </button>
            </div>
          </div>

          <table className="data-table">
            <thead>
              <tr>
              <th>รุ่น</th><th>ชื่อสมัยเรียน</th><th>ชื่อในหนังสือ</th><th>สถานะส่งข้อมูล</th>
              <th>เบอร์ติดต่อ</th><th>รูป</th><th>ช่องทางที่ลงหนังสือ</th><th>สถานะติดตาม</th>
            </tr>
            </thead>
            <tbody>
              {(data?.records || []).map((record) => (
                <tr key={record.id} className={record.followUp?.state === "deceased" ? "row-memorial" : ""}>
                  <td>{record.batch}</td>
                  <td>{record.legalFirstName} {record.legalLastName}<br /><small>{record.studentId}</small></td>
                  <td>{record.currentFirstName} {record.currentLastName}</td>
                  <td>
                    {canEdit ? (
                      <select value={record.status} onChange={(event) => updateStatus(record, event.target.value)}>
                        {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                    ) : (
                      <span className={`status-chip status-${record.status}`}>{STATUS_LABELS[record.status]}</span>
                    )}
                  </td>
                  <td className="contact-cell">
                    {record.outreach?.phone
                      ? <a href={`tel:${record.outreach.phone}`}>{formatPhone(record.outreach.phone)}</a>
                      : <span className="muted-cell">ไม่มีเบอร์</span>}
                    {record.outreach?.email && <><br /><a href={`mailto:${record.outreach.email}`}>{record.outreach.email}</a></>}
                    {record.outreach?.note && <><br /><small>{record.outreach.note}</small></>}
                  </td>
                  <td>{record.photo?.downloadUrl ? <a href={record.photo.downloadUrl} target="_blank" rel="noreferrer">ดูรูป</a> : record.photo?.choice === "placeholder" ? "ใช้ภาพคณะ" : "—"}</td>
                  <td>{(record.contacts || []).map((contact) => contact.type).join(", ") || "—"}</td>
                  <td>
                    <select
                      className={`follow-select follow-${record.followUp?.state || "none"}`}
                      value={record.followUp?.state || "none"}
                      onChange={(event) => updateFollowUp(record, event.target.value)}
                    >
                      {Object.entries(FOLLOW_UP_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    {record.followUp?.updatedBy && (
                      <small className="follow-meta">โดย {record.followUp.updatedBy}{record.followUp.note ? ` · ${record.followUp.note}` : ""}</small>
                    )}
                  </td>
                </tr>
              ))}
              {!data?.records?.length && <tr><td colSpan="8" className="empty">ไม่พบข้อมูลตามเงื่อนไข</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/* ----------------------------- import / export ---------------------------- */

function ImportExport({ canReset }) {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportBatch, setExportBatch] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [includeOutreach, setIncludeOutreach] = useState(false);
  const [progress, setProgress] = useState(null);

  const CHUNK_SIZE = 400;

  function describeError(error) {
    return [error.message, error.details?.headersFound ? `พบคอลัมน์ในไฟล์: ${error.details.headersFound.join(", ")}` : ""]
      .filter(Boolean)
      .join(" — ");
  }

  async function exportExcel() {
    setMessage("");
    const params = new URLSearchParams();
    if (exportBatch.trim()) params.set("batch", exportBatch.trim());
    if (exportStatus) params.set("status", exportStatus);
    if (includeOutreach) params.set("includeOutreach", "true");
    const query = params.toString();
    const suffix = exportBatch.trim() ? `-รุ่น${exportBatch.trim().replace(/[\s,;]+/g, "-")}` : "-ทุกรุ่น";
    try {
      await download(`/api/admin/export.xlsx${query ? `?${query}` : ""}`, `ข้อมูลนิสิตเก่า${suffix}.xlsx`);
    } catch (error) {
      setMessage(error.message);
    }
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
    if (!job) return setMessage("กรุณากด \"ตรวจสอบไฟล์ก่อน\" ก่อนนำเข้าจริง");
    if (job.updated > 0 && !confirm(`พบข้อมูลซ้ำ ${job.updated} รายการ — ต้องการนำเข้าและอัปเดตข้อมูลที่ซ้ำหรือไม่?`)) return;

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
      setMessage(`${describeError(error)} — บันทึกสำเร็จไปแล้ว ${(inserted + updated).toLocaleString("th-TH")} รายการ สามารถกด "นำเข้าจริง" ซ้ำเพื่อทำต่อได้`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>นำเข้าฐานรายชื่อจาก Excel</h3>
      <p className="panel-note">
        คอลัมน์ที่จำเป็น: <strong>ชื่อ</strong> และ <strong>นามสกุล</strong> เท่านั้น — รุ่นระบุจากชื่อไฟล์ได้ (เช่น 82-2563.xlsx = รุ่น 82)
        <br />
        ถ้ามีคอลัมน์ <strong>เลขประจำตัวนิสิต</strong> ระบบจะคำนวณปีที่เข้าศึกษาจาก 2 หลักแรก — ถ้าไม่มี ระบบสร้างรหัสให้อัตโนมัติ
        <br />
        ระบบจะสร้าง<strong>รหัสยืนยันตัวตน</strong> (ปีเข้า+ลำดับ เช่น 2563001) ให้ทุกคนอัตโนมัติ ดูได้ในไฟล์ส่งออก
        <br />
        ลำดับคอลัมน์สลับกันได้ และ<strong>ข้อมูลที่นิสิตเก่ากรอกไว้แล้วจะไม่ถูกทับ</strong> — กดปุ่มด้านล่างเพื่อดาวน์โหลดไฟล์ต้นแบบพร้อมคำแนะนำการกรอก
      </p>

      <div className="button-row">
        <button className="ghost" onClick={() => download("/api/admin/import/template.xlsx", "แบบฟอร์มรายชื่อนิสิตเก่า.xlsx")}>
          <Download /> ไฟล์ต้นแบบเปล่า (ใช้กรอกข้อมูลจริง)
        </button>
      </div>

      <p className="panel-note" style={{ marginTop: "0.5rem" }}>
        <strong>ไฟล์ตัวอย่างสำหรับทดลองนำเข้า</strong> — ข้อมูลสมมติ ไม่ใช่ข้อมูลบุคคลจริง
      </p>
      <div className="button-row">
        <button className="ghost" onClick={() => download("/api/admin/import/demo/82-2563", "82-2563.xlsx")}>
          <Download /> รุ่น 82 (148 รายการ, มีรหัสนิสิต)
        </button>
        <button className="ghost" onClick={() => download("/api/admin/import/demo/15-2497", "15-2497.xlsx")}>
          <Download /> รุ่น 15 (83 รายการ, ไม่มีรหัสนิสิต)
        </button>
      </div>
      <p className="panel-note">
        ใช้ทดลองนำเข้าเพื่อดูว่าระบบทำงานอย่างไร — รุ่น 82 มีเลขประจำตัวนิสิต, รุ่น 15 ระบบจะสร้างรหัสให้อัตโนมัติจากชื่อไฟล์
        เมื่อทดสอบเสร็จให้กด "ล้างข้อมูลทั้งหมด" ด้านล่างก่อนนำเข้าข้อมูลจริง
      </p>

      <label
        className={`file-drop${dragOver ? " dragover" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) { setFile(dropped); setPreview(null); setResult(null); setMessage(""); setProgress(null); }
        }}
      >
        <Upload />
        <strong>{file?.name || "ลากไฟล์มาวาง หรือกดเพื่อเลือกไฟล์"}</strong>
        <small>รองรับ .xls, .xlsx และ .csv — ระบบจะตรวจสอบข้อมูลให้ก่อน แล้วจึงยืนยันบันทึกจริง</small>
        <input type="file" accept=".xls,.xlsx,.csv" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setResult(null); setMessage(""); setProgress(null); }} />
      </label>

      <div className="button-row">
        <button className="ghost" disabled={busy || !file} onClick={check}>1. ตรวจสอบไฟล์ก่อน</button>
        <button className="next compact-btn" disabled={busy || !preview} onClick={runImport}>2. นำเข้าจริง</button>
      </div>

      <ProgressBar progress={progress} />
      <Alert>{message}</Alert>
      {preview && <ImportReport job={preview} title={"ผลการตรวจสอบ — ยังไม่บันทึก กด \"นำเข้าจริง\" เพื่อบันทึก"} />}
      {preview && preview.updated > 0 && (
        <div className="import-warning">
          <strong>พบข้อมูลซ้ำ {preview.updated.toLocaleString("th-TH")} รายการ</strong>
          <span>รายชื่อเหล่านี้มีในระบบแล้ว — หากกด "นำเข้าจริง" ระบบจะอัปเดตข้อมูลพื้นฐาน (ชื่อ, รุ่น, รหัสนิสิต) แต่ข้อมูลที่นิสิตเก่ากรอกไว้แล้วจะไม่ถูกทับ</span>
        </div>
      )}
      {result && <ImportReport job={result} title="นำเข้าเรียบร้อยแล้ว" tone="ok" />}

      <h3 className="section-gap">รหัสยืนยันตัวตน</h3>
      <p className="panel-note">
        สร้างรหัสยืนยันตัวตนใหม่ทั้งหมดในรูปแบบ <strong>ปี พ.ศ. + ลำดับ 3 หลัก</strong> (เช่น 2563001)
        <br />
        ใช้เมื่อนำเข้าข้อมูลใหม่แล้วต้องการอัปเดตรหัสให้ตรงรูปแบบ หรือเมื่อต้องการรีเซ็ตรหัสทั้งหมด
      </p>
      <button className="ghost" disabled={busy} onClick={async () => {
        if (!confirm("สร้างรหัสยืนยันตัวตนใหม่ทั้งหมด? รหัสเดิมจะใช้ไม่ได้อีก")) return;
        setBusy(true); setMessage("");
        try {
          const res = await api("/api/admin/regenerate-codes", { method: "POST" });
          setMessage(`สร้างรหัสใหม่เรียบร้อย ${res.total} รายการ`);
        } catch (e) { setMessage(e.message); }
        setBusy(false);
      }}>
        สร้างรหัสยืนยันตัวตนใหม่ทั้งหมด
      </button>

      <h3 className="section-gap">ส่งออกข้อมูล</h3>
      <p className="panel-note">
        ส่งออกข้อมูลนิสิตเก่าเป็นไฟล์ Excel สำหรับใช้งานภายใน เลือกได้ทั้งเฉพาะรุ่นหรือทั้งหมด
        <br />
        ไฟล์ส่งออกจะมี<strong>รหัสยืนยันตัวตน</strong> ปีที่เข้าศึกษา ข้อมูลศิษย์เก่าดีเด่น และรวมทุกสถานะ
        <br />
        หากต้องการไฟล์ส่งมอบให้ทีมออกแบบ (พร้อมรูปถ่ายและไฟล์สำหรับ InDesign) ให้ใช้แท็บ <strong>ส่งมอบงานออกแบบ</strong>
      </p>
      <div className="filters">
        <Field
          label="ระบุรุ่น (เว้นว่าง = ทุกรุ่น)"
          value={exportBatch}
          setValue={setExportBatch}
          placeholder="เช่น 45 หรือ 45, 46, 47"
          hint="(หลายรุ่นคั่นด้วยจุลภาค)"
          inputMode="numeric"
        />
        <label className="field"><span>สถานะ</span>
          <select value={exportStatus} onChange={(event) => setExportStatus(event.target.value)}>
            <option value="">ทุกสถานะ</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <button className="next compact-btn" onClick={exportExcel}>
          <Download /> ส่งออก Excel
        </button>
      </div>
      <label className="switch-row">
        <input type="checkbox" checked={includeOutreach} onChange={(event) => setIncludeOutreach(event.target.checked)} />
        <span>รวมอีเมลและเบอร์โทรที่ผู้ดูแลใช้ติดตามงาน — เป็นข้อมูลภายใน ห้ามส่งต่อให้ทีมออกแบบ</span>
      </label>

      <ResetInputZone canReset={canReset} />
      <DangerZone canReset={canReset} />
    </div>
  );
}

/** Reset user-entered data while keeping Excel-imported base records. */
function ResetInputZone({ canReset }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);
  const PHRASE = "ล้างข้อมูลที่กรอก";

  async function reset() {
    if (!window.confirm("ยืนยันล้างข้อมูลที่นิสิตเก่ากรอกเข้ามา?\n\nข้อมูลพื้นฐานจากไฟล์ Excel (ชื่อ-นามสกุล, รุ่น, รหัสนิสิต) จะยังคงอยู่\nแต่ข้อมูลที่กรอกผ่านระบบ (รูปถ่าย, ช่องทางติดต่อ, ข้อมูลประวัติ, สถานะการส่ง) จะถูกรีเซ็ต")) return;
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      const data = await api("/api/admin/reset-input", { method: "POST", body: { confirm } });
      setResult(data.reset);
      setConfirm("");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="danger-zone" style={{ borderColor: "#d4a843" }}>
      <h3>ล้างข้อมูลที่กรอกผ่านระบบ (เริ่มใช้งานจริง)</h3>
      <p className="panel-note">
        ใช้เมื่อทดสอบระบบ (UAT) เสร็จแล้ว ต้องการเริ่มใช้งานจริงโดยเก็บฐานข้อมูลจากไฟล์ Excel ไว้
        <br />
        <strong>จะถูกล้าง:</strong> รูปถ่าย, ช่องทางติดต่อ, ข้อมูลประวัติ, สถานะการส่ง, ความยินยอม PDPA, สถานะการติดตาม
        <br />
        <strong>จะไม่ถูกล้าง:</strong> ระเบียนนิสิตเก่า (ชื่อ, นามสกุล, รุ่น, รหัสนิสิต), บัญชีผู้ใช้ระบบ, รหัสยืนยันตัวตน
        <br />
        การกระทำนี้ <strong>ย้อนกลับไม่ได้</strong>
      </p>
      {canReset ? (
        <div className="filters">
          <Field label={`พิมพ์ "${PHRASE}" เพื่อยืนยัน`} value={confirm} setValue={setConfirm} placeholder={PHRASE} />
          <button className="danger-btn compact-btn" style={{ background: "#b8860b", borderColor: "#b8860b" }} disabled={busy || confirm.trim() !== PHRASE} onClick={reset}>
            <RotateCcw /> {busy ? "กำลังล้างข้อมูล…" : "ล้างข้อมูลที่กรอก"}
          </button>
        </div>
      ) : (
        <Alert tone="warn">
          บัญชีของท่านไม่มีสิทธิ์ล้างข้อมูล — ทำได้เฉพาะเจ้าของระบบและผู้ดูแลระบบเท่านั้น
        </Alert>
      )}
      <Alert>{message}</Alert>
      {result && (
        <Alert tone="ok">
          ล้างข้อมูลที่กรอกเรียบร้อยแล้ว — รีเซ็ตระเบียน {result.alumni.toLocaleString("th-TH")} รายการ,
          ข้อมูลที่ส่งเข้ามา {result.submissions.toLocaleString("th-TH")} รายการ,
          รูปภาพ {result.photos.toLocaleString("th-TH")} ไฟล์ — ระบบพร้อมเริ่มใช้งานจริงจากฐานข้อมูล Excel
        </Alert>
      )}
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
          บัญชีของท่านไม่มีสิทธิ์ล้างข้อมูล — ทำได้เฉพาะเจ้าของระบบและผู้ดูแลระบบเท่านั้น
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

/* --------------------- ส่งมอบงานออกแบบ (design handoff) ------------------- */

function HandoffPanel({ user }) {
  const scoped = user.batchScope?.length ? user.batchScope.join(", ") : "";
  const [batchInput, setBatchInput] = useState(scoped);
  const [applied, setApplied] = useState(scoped);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [zipProgress, setZipProgress] = useState(null);

  const { loading, data, error, reload } = useAsync(
    () => api(`/api/admin/handoff/summary${applied.trim() ? `?batch=${encodeURIComponent(applied.trim())}` : ""}`),
    [applied]
  );

  const query = applied.trim() ? `?batch=${encodeURIComponent(applied.trim())}` : "";
  const thai = (value) => Number(value || 0).toLocaleString("th-TH");
  const mb = (bytes) => `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`;

  async function grab(path, filename) {
    setBusy(true);
    setMessage("");
    try {
      await download(path, filename);
    } catch (downloadError) {
      setMessage(downloadError.message);
    } finally {
      setBusy(false);
    }
  }

  /** Download every batch archive one after another — never one huge response. */
  async function grabAllPhotos() {
    const batches = (data?.batches || []).filter((item) => item.photos > 0);
    if (!batches.length) return setMessage("ยังไม่มีรูปถ่ายให้ดาวน์โหลด");
    setBusy(true);
    setMessage("");
    try {
      for (const [index, item] of batches.entries()) {
        setZipProgress({ done: index, total: batches.length, batch: item.batch });
        await download(`/api/admin/handoff/photos.zip?batch=${item.batch}`, `yearbook-2569-photos-batch-${item.batch}.zip`);
      }
      setZipProgress({ done: batches.length, total: batches.length });
      setMessage(`ดาวน์โหลดรูปครบทั้ง ${batches.length} รุ่นแล้ว`);
    } catch (downloadError) {
      setMessage(`หยุดกลางคัน: ${downloadError.message} — กดดาวน์โหลดรุ่นที่เหลือทีละรุ่นได้`);
    } finally {
      setBusy(false);
    }
  }

  const totals = data?.totals;

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>ส่งมอบงานให้ทีมออกแบบ</h3>
        <button className="ghost" onClick={reload}><RefreshCw /> รีเฟรช</button>
      </div>
      <p className="panel-note">
        ชุดส่งมอบมีเฉพาะผู้ที่ <strong>ยืนยันลงหนังสือแล้ว</strong> เท่านั้น — คนที่ยังไม่ตอบหรือไม่ประสงค์ลงจะไม่ถูกรวม
        <br />
        ชื่อไฟล์รูปตรงกับคอลัมน์ <strong>ไฟล์รูป</strong> ในไฟล์ข้อมูล ทีมออกแบบจึงวางรูปอัตโนมัติด้วย InDesign Data Merge ได้เลย ไม่ต้องจับคู่เอง
      </p>

      <form className="filters" onSubmit={(event) => { event.preventDefault(); setApplied(batchInput); }}>
        <Field
          label="เลือกรุ่น (เว้นว่าง = ทุกรุ่น)"
          value={batchInput}
          setValue={setBatchInput}
          placeholder="เช่น 45, 46, 47"
          hint="(หลายรุ่นคั่นด้วยจุลภาค)"
        />
        <button className="next compact-btn">ใช้เงื่อนไขนี้</button>
      </form>

      <Alert>{message || error}</Alert>

      {loading ? <p className="console-loading">กำลังรวบรวมข้อมูล…</p> : (
        <>
          <div className="stat-cards">
            <div><span>ยืนยันลงหนังสือ</span><strong>{thai(totals?.people)}</strong></div>
            <div><span>ส่งรูปถ่ายแล้ว</span><strong>{thai(totals?.photos)}</strong></div>
            <div><span>ใช้ภาพคณะแทน</span><strong>{thai(totals?.placeholders)}</strong></div>
            <div><span>ขนาดรูปรวม</span><strong>{mb(totals?.bytes)}</strong></div>
          </div>

          <h4>ขั้นที่ 1 — ไฟล์ข้อมูล</h4>
          <div className="button-row">
            <button className="next compact-btn" disabled={busy || !totals?.people} onClick={() => grab(`/api/admin/handoff/data.xlsx${query}`, "ข้อมูลนิสิตเก่า.xlsx")}>
              <Download /> ไฟล์ข้อมูล (Excel)
            </button>
            <button className="ghost" disabled={busy || !totals?.people} onClick={() => grab(`/api/admin/handoff/data-merge.csv${query}`, "data-merge.csv")}>
              <Download /> data-merge.csv (สำหรับ InDesign)
            </button>
            <button className="ghost" disabled={busy} onClick={() => grab(`/api/admin/handoff/readme.txt${query}`, "อ่านก่อน-README.txt")}>
              <FileText /> คู่มือสำหรับทีมออกแบบ
            </button>
          </div>

          <h4>ขั้นที่ 2 — รูปถ่าย (แยกตามรุ่น)</h4>
          <p className="panel-note">
            แยกเป็นไฟล์ละรุ่นโดยตั้งใจ เพราะรูปทั้งหมดรวมกันมีขนาดหลายกิกะไบต์ ซึ่งใหญ่เกินกว่าจะดาวน์โหลดในครั้งเดียวได้อย่างมั่นคง
            <br />
            แตกไฟล์ ZIP ของทุกรุ่นลงในโฟลเดอร์เดียวกัน โครงสร้าง <code>photos/batch-NN/</code> จะรวมกันเองอัตโนมัติ
          </p>
          <div className="button-row">
            <button className="next compact-btn" disabled={busy || !totals?.photos} onClick={grabAllPhotos}>
              <Download /> ดาวน์โหลดรูปทุกรุ่นเรียงต่อกัน
            </button>
          </div>
          {zipProgress && (
            <div className="progress-panel">
              <div className="progress-head">
                <strong>{zipProgress.done >= zipProgress.total ? "ดาวน์โหลดรูปครบแล้ว" : `กำลังดาวน์โหลดรูปรุ่น ${zipProgress.batch}`}</strong>
                <span>{zipProgress.done} / {zipProgress.total} รุ่น</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.round((zipProgress.done / zipProgress.total) * 100)}%` }} />
              </div>
            </div>
          )}

          <table className="data-table">
            <thead>
              <tr><th>รุ่น</th><th>ยืนยันแล้ว</th><th>มีรูป</th><th>ใช้ภาพคณะ</th><th>ขนาดรูป</th><th>ดาวน์โหลด</th></tr>
            </thead>
            <tbody>
              {(data?.batches || []).map((item) => (
                <tr key={item.batch}>
                  <td>รุ่น {item.batch}</td>
                  <td>{thai(item.people)}</td>
                  <td>{thai(item.photos)}</td>
                  <td>{item.placeholders ? <span className="warn-count">{thai(item.placeholders)}</span> : "—"}</td>
                  <td>{item.photos ? mb(item.bytes) : "—"}</td>
                  <td>
                    <button
                      className="row-download"
                      disabled={busy || !item.photos}
                      onClick={() => grab(`/api/admin/handoff/photos.zip?batch=${item.batch}`, `yearbook-2569-photos-batch-${item.batch}.zip`)}
                    >
                      <Download /> รูปรุ่น {item.batch}
                    </button>
                  </td>
                </tr>
              ))}
              {!data?.batches?.length && <tr><td colSpan="6" className="empty">ยังไม่มีผู้ยืนยันลงหนังสือ</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/* ------------------------------ user manager ------------------------------ */

function UserManager({ user }) {
  const { loading, data, error, reload } = useAsync(() => api("/api/admin/users"));
  const [form, setForm] = useState({ username: "", displayName: "", email: "", phone: "", role: "staff", batchScope: "", alumniId: "", password: "" });
  const [message, setMessage] = useState("");
  const [credential, setCredential] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);

  const assignableRoles = Object.keys(ROLE_LABELS).filter((role) => role !== "owner" && (user.role === "owner" || role !== "admin"));

  function beginEdit(item) {
    setMessage("");
    setCredential(null);
    setEditing({
      uid: item.uid,
      username: item.username,
      displayName: item.displayName || "",
      email: item.email || "",
      phone: item.phone || "",
      role: item.role,
      batchScope: (item.batchScope || []).join(", "),
      alumniId: (item.alumniId || "").replace(/^s-/, "")
    });
  }

  async function saveEdit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/admin/users/${editing.uid}`, {
        method: "PATCH",
        body: {
          displayName: editing.displayName,
          email: editing.email,
          phone: editing.phone,
          role: editing.role,
          batchScope: editing.role === "staff" ? editing.batchScope.split(/[,\s]+/).filter(Boolean) : null,
          alumniId: ["staff", "alumni"].includes(editing.role) && editing.alumniId ? `s-${editing.alumniId.replace(/^s-/, "")}` : ""
        }
      });
      setEditing(null);
      reload();
    } catch (saveError) {
      setMessage(saveError.message);
    } finally {
      setBusy(false);
    }
  }

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
        phone: form.phone,
        role: form.role,
        batchScope: form.role === "staff" ? form.batchScope.split(/[,\s]+/).filter(Boolean) : null,
        alumniId: ["staff", "alumni"].includes(form.role) && form.alumniId ? `s-${form.alumniId.replace(/^s-/, "")}` : null
      };
      if (form.password) payload.password = form.password;
      const data = await api("/api/admin/users", { method: "POST", body: payload });
      setCredential({ username: data.user.username, password: data.initialPassword });
      setForm({ username: "", displayName: "", email: "", phone: "", role: "staff", batchScope: "", alumniId: "", password: "" });
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
          {form.role === "staff" && (
            <>
              <Field label="รุ่นที่ดูแล" value={form.batchScope} setValue={(value) => setForm({ ...form, batchScope: value })} placeholder="เช่น 45, 46" hint="(คั่นด้วยเครื่องหมายจุลภาค)" />
              <Field
                label="เบอร์ติดต่อ"
                value={form.phone}
                setValue={(value) => setForm({ ...form, phone: value })}
                placeholder="081-234-5678"
                hint="(แสดงให้นิสิตเก่าเห็นเมื่อปิดรับข้อมูล)"
                inputMode="tel"
              />
            </>
          )}
          {["staff", "alumni"].includes(form.role) && (
            <Field
              label="รหัสนิสิต"
              value={form.alumniId}
              setValue={(value) => setForm({ ...form, alumniId: value })}
              placeholder="เช่น 2834000001"
              hint={form.role === "staff" ? "(ไม่บังคับ — ผูกเพื่อให้แสดงชื่อจริงในทะเบียน)" : "(บังคับสำหรับบัญชีนิสิตเก่า)"}
            />
          )}
          <Field label="รหัสผ่านเริ่มต้น" value={form.password} setValue={(value) => setForm({ ...form, password: value })} placeholder="เว้นว่างเพื่อให้ระบบสุ่มให้" />
        </div>
        <button className="next compact-btn" disabled={busy || !form.username}><UserPlus /> สร้างบัญชี</button>
      </form>

      {editing && (
        <form className="user-form editing" onSubmit={saveEdit}>
          <h4>แก้ไขบัญชี {editing.username}</h4>
          <p className="form-note">
            ใช้เปลี่ยนตัวแทนรุ่นได้โดยไม่ต้องสร้างบัญชีใหม่ — ย้ายรุ่นที่ดูแลไปให้บัญชีอื่น
            หรือผูกบัญชีเดิมกับนิสิตเก่าคนใหม่พร้อมเปลี่ยนเบอร์ติดต่อ
          </p>
          <div className="form-grid">
            <Field label="ชื่อที่แสดง" value={editing.displayName} setValue={(value) => setEditing({ ...editing, displayName: value })} />
            <Field label="อีเมล (ไม่บังคับ)" value={editing.email} setValue={(value) => setEditing({ ...editing, email: value })} type="email" />
            <label className="field"><span>บทบาท</span>
              <select value={editing.role} onChange={(event) => setEditing({ ...editing, role: event.target.value })}>
                {assignableRoles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
              </select>
            </label>
            {editing.role === "staff" && (
              <>
                <Field label="รุ่นที่ดูแล" value={editing.batchScope} setValue={(value) => setEditing({ ...editing, batchScope: value })} placeholder="เช่น 45, 46" hint="(คั่นด้วยเครื่องหมายจุลภาค)" />
                <Field
                  label="เบอร์ติดต่อ"
                  value={editing.phone}
                  setValue={(value) => setEditing({ ...editing, phone: value })}
                  placeholder="081-234-5678"
                  hint="(แสดงให้นิสิตเก่าเห็นเมื่อปิดรับข้อมูล)"
                  inputMode="tel"
                />
              </>
            )}
            {["staff", "alumni"].includes(editing.role) && (
              <Field
                label="รหัสนิสิต"
                value={editing.alumniId}
                setValue={(value) => setEditing({ ...editing, alumniId: value })}
                placeholder="เช่น 2834000001"
                hint="(เว้นว่างเพื่อยกเลิกการผูก)"
              />
            )}
          </div>
          <div className="row-actions">
            <button className="next compact-btn" disabled={busy}><Save /> บันทึกการแก้ไข</button>
            <button type="button" className="ghost" onClick={() => setEditing(null)}>ยกเลิก</button>
          </div>
          <p className="form-note">
            การเปลี่ยนบทบาทจะบังคับให้บัญชีนั้นเข้าสู่ระบบใหม่ทันที เพื่อไม่ให้สิทธิ์เดิมค้างอยู่
          </p>
        </form>
      )}

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
          <thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อที่แสดง</th><th>บทบาท</th><th>รุ่นที่ดูแล</th><th>ผูกกับนิสิตเก่า</th><th>เบอร์ติดต่อ</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th>จัดการ</th></tr></thead>
          <tbody>
            {(data?.users || []).map((item) => (
              <tr key={item.uid}>
                <td>{item.username}{item.mustChangePassword && <small className="pending-flag"> ยังไม่ตั้งรหัสผ่าน</small>}</td>
                <td>{item.displayName}</td>
                <td><span className={`role-chip role-${item.role}`}>{item.roleLabel}</span></td>
                <td>{item.batchScope?.join(", ") || "ทั้งระบบ"}</td>
                <td>
                  {item.alumniName || (item.alumniId ? <span className="link-broken">ไม่พบระเบียน</span> : "—")}
                  {item.alumniId && <><br /><small>{item.alumniId}</small></>}
                </td>
                <td>{item.phone || "—"}</td>
                <td>{item.status === "active" ? "ใช้งาน" : "ระงับ"}</td>
                <td>{item.lastLoginAt ? formatTime(item.lastLoginAt) : "—"}</td>
                <td className="row-actions">
                  {item.uid !== user.uid && item.role !== "owner" && (
                    <>
                      <button onClick={() => beginEdit(item)}><Pencil /> แก้ไข</button>
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
      <p className="panel-note">
        <strong>รุ่นสูงสุด</strong> คือรุ่นล่าสุดที่สมาคมมี ใช้เป็นเพดานตรวจสอบทุกจุดที่มีการกรอกรุ่น —
        หน้าค้นหาของนิสิตเก่า ตัวกรองรายชื่อ การนำเข้า Excel และการกำหนดรุ่นที่ตัวแทนรุ่นดูแล
        <br />
        ตั้งให้ตรงกับความจริงเพื่อกันการพิมพ์ผิด เช่น พิมพ์ 85 แทน 58 จะถูกปฏิเสธทันทีแทนที่จะสร้างรุ่นที่ไม่มีอยู่จริง
      </p>
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
          <Field
            label="รุ่นสูงสุด"
            value={String(draft.maxBatch)}
            setValue={(value) => setDraft({ ...draft, maxBatch: Number(value.replace(/\D/g, "")) || 88 })}
            hint="(รุ่นล่าสุดของสมาคม — ใช้ตรวจทุกจุดที่กรอกรุ่น)"
            inputMode="numeric"
          />
          <Field
            label="ความยาวประวัติสูงสุด"
            value={String(draft.bioMaxLength)}
            setValue={(value) => setDraft({ ...draft, bioMaxLength: Number(value.replace(/\D/g, "")) || 500 })}
            hint="(จำนวนตัวอักษรของประวัติโดยย่อ)"
            inputMode="numeric"
          />
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

function formatPhone(digits) {
  const value = String(digits || "").replace(/\D/g, "");
  if (value.length === 10) return `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}`;
  if (value.length === 9) return `${value.slice(0, 2)}-${value.slice(2, 5)}-${value.slice(5)}`;
  return value || "—";
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
