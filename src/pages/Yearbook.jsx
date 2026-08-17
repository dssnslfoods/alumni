import { useEffect, useState } from "react";
import { ArrowRight, Check, ChevronLeft, Facebook, ImagePlus, Instagram, Landmark, Phone, Search, ShieldCheck, Upload, UserRoundCheck, X } from "lucide-react";
import { Alert, Field, Review, Shell } from "../components/Shell.jsx";
import { api } from "../lib/api.js";

const MAX_PHOTO_EDGE = 2000;

/** ต้องตรงกับ CONTACT_RULES ที่ server/domain/alumni.js */
const CONTACT_RULES = {
  facebook: { placeholder: "somchai.jaidee หรือ facebook.com/somchai.jaidee", hint: "ใส่ชื่อผู้ใช้ หรือวางลิงก์โปรไฟล์ก็ได้" },
  instagram: { placeholder: "somchai_j", hint: "ใส่ชื่อผู้ใช้ ไม่ต้องใส่ @" },
  line: { placeholder: "somchai2569", hint: "ใส่ LINE ID ไม่ต้องใส่ @ (บัญชีทางการให้ใส่ @ ด้วย)" },
  phone: { placeholder: "081-234-5678", hint: "ตัวเลข 9-10 หลัก ระบบจัดรูปแบบให้อัตโนมัติ" }
};

/** จัดรูปแบบเบอร์ระหว่างพิมพ์ ให้เห็นผลทันทีแบบเดียวกับที่ server จะบันทึก */
function formatPhoneInput(value) {
  const digits = String(value).replace(/\D/g, "").slice(0, 10);
  if (digits.length > 6) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length > 3) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return digits;
}

const steps = ["ความประสงค์", "ค้นหารายชื่อ", "ยืนยันตัวตน", "ข้อมูลหนังสือ", "รูปและติดต่อ", "ยืนยันส่ง"];
const contactOptions = [
  ["facebook", "Facebook", Facebook],
  ["instagram", "Instagram", Instagram],
  ["line", "LINE ID", Landmark],
  ["phone", "โทรศัพท์", Phone],
  ["none", "ไม่แสดงข้อมูลติดต่อ", X]
];

export function Yearbook() {
  const [settings, setSettings] = useState({ maxBatch: 88, bioMaxLength: 500, submissionOpen: true, closedMessage: "" });
  const [step, setStep] = useState(0);
  const [intent, setIntent] = useState("yes");
  const [repBatch, setRepBatch] = useState("");
  const [reps, setReps] = useState(null);
  const [stats, setStats] = useState(null);
  const [batch, setBatch] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [last5, setLast5] = useState("");
  const [submitToken, setSubmitToken] = useState("");
  const [alum, setAlum] = useState(null);
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [photoChoice, setPhotoChoice] = useState("upload");
  const [photo, setPhoto] = useState(null);
  const [photoWarning, setPhotoWarning] = useState("");
  const [photoInfo, setPhotoInfo] = useState(null);
  const [uploadStage, setUploadStage] = useState("");
  const [photoResult, setPhotoResult] = useState(null);
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [contactValues, setContactValues] = useState({ facebook: "", instagram: "", line: "", phone: "" });
  const [bio, setBio] = useState("");
  const [pdpa, setPdpa] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/public/settings", { auth: false }).then(setSettings).catch(() => {});
  }, []);

  /**
   * Keep the ticker current without a reload.
   *
   * Polls once a minute, but only while the tab is actually visible — a page
   * left open in a background tab for a day should not keep calling the API.
   * Returning to the tab refreshes immediately so the numbers are never stale
   * on screen.
   */
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api("/api/public/stats", { auth: false })
        .then((data) => { if (!cancelled) setStats(data); })
        .catch(() => {});
    };
    // Only the repeat calls are gated: a page can be opened into a background
    // tab, and skipping the first load there would leave the ticker empty for
    // as long as the tab stays unfocused.
    const loadIfVisible = () => { if (document.visibilityState === "visible") load(); };

    load();
    const timer = setInterval(loadIfVisible, 60_000);
    document.addEventListener("visibilitychange", loadIfVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", loadIfVisible);
    };
  }, []);

  const nameChanged = alum && `${firstName} ${lastName}`.trim() !== `${alum.currentFirstName} ${alum.currentLastName}`.trim();
  const nameChangedFromLegal = alum && `${firstName} ${lastName}`.trim() !== `${alum.legalFirstName} ${alum.legalLastName}`.trim();
  const selectedContactDetails = contactOptions
    .filter(([type]) => selectedContacts.includes(type))
    .map(([type, label]) => ({ type, label, value: contactValues[type] }));

  function move(next) {
    setNotice("");
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function run(action) {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  const search = (event) => {
    event.preventDefault();
    setMatches([]);
    return run(async () => {
      const data = await api("/api/public/search", { method: "POST", auth: false, body: { batch, query } });
      setMatches(data.matches);
      if (!data.matches.length) setNotice("ไม่พบรายชื่อ กรุณาตรวจชื่อเดิมสมัยเรียนและรุ่นอีกครั้ง");
    });
  };

  const verify = (event) => {
    event.preventDefault();
    return run(async () => {
      const data = await api("/api/public/verify", { method: "POST", auth: false, body: { alumniId: selected.id, idCardLast5: last5 } });
      setSubmitToken(data.submitToken);
      setAlum(data.alum);
      // Re-submitting is an edit: everything already on file is loaded back in
      // so the alumnus changes one field instead of retyping the whole form.
      setEditing(data.alum.status === "submitted");
      setFirstName(data.alum.currentFirstName || data.alum.legalFirstName);
      setLastName(data.alum.currentLastName || data.alum.legalLastName);
      setBio(data.alum.bio || "");
      if (data.alum.photo?.choice) setPhotoChoice(data.alum.photo.choice);
      if (data.alum.contacts?.length) {
        setSelectedContacts(data.alum.contacts.map((contact) => contact.type));
        setContactValues((current) => ({ ...current, ...Object.fromEntries(data.alum.contacts.map((contact) => [contact.type, contact.value])) }));
      }
      if (data.alum.pdpa?.consent) setPdpa("yes");
      move(intent === "no" ? 8 : 3);
    });
  };

  /**
   * Check the pixel size before uploading. A photo that is fine on screen can
   * still print soft, and telling the alumnus now is far better than the design
   * team discovering it at proofing when nobody can retake the shot.
   */
  function choosePhoto(file) {
    setPhoto(file);
    setPhotoWarning("");
    setPhotoInfo(null);
    setPhotoResult(null);
    if (!file) return;

    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      const { width, height } = probe;
      const shortEdge = Math.min(width, height);
      // Mirror of the server's rule, so the preview matches the real result.
      const scale = Math.min(MAX_PHOTO_EDGE / Math.max(width, height), 1);
      setPhotoInfo({
        width,
        height,
        bytes: file.size,
        targetWidth: Math.round(width * scale),
        targetHeight: Math.round(height * scale),
        willResize: scale < 1
      });
      if (shortEdge < 700) {
        setPhotoWarning(
          `รูปนี้มีความละเอียด ${width}x${height} พิกเซล ซึ่งค่อนข้างต่ำสำหรับงานพิมพ์ ` +
          "ส่งได้แต่เมื่อพิมพ์อาจไม่คมชัด หากมีไฟล์ต้นฉบับที่ใหญ่กว่านี้แนะนำให้ใช้ไฟล์นั้นแทน"
        );
      }
      URL.revokeObjectURL(url);
    };
    probe.onerror = () => URL.revokeObjectURL(url);
    probe.src = url;
  }

  const findReps = (event) => {
    event.preventDefault();
    setReps(null);
    return run(async () => {
      const data = await api(`/api/public/representatives?batch=${encodeURIComponent(repBatch)}`, { auth: false });
      setReps(data.representatives);
    });
  };

  const confirmDecline = () => run(async () => {
    await api("/api/public/decline", { method: "POST", auth: false, headers: { "x-submit-token": submitToken } });
    move(7);
  });

  const submit = (event) => {
    event.preventDefault();
    if (pdpa !== "yes") return setNotice("กรุณาเลือก “ยินยอม” เพื่ออนุญาตให้ใช้ข้อมูลในหนังสืออนุสรณ์");
    if (photoChoice === "upload" && !photo && !alum?.photo?.downloadUrl) return setNotice("กรุณาเลือกไฟล์รูปภาพ หรือเลือกไม่แสดงรูปในหนังสือ");
    if (selectedContactDetails.some((item) => !item.value.trim())) return setNotice("กรุณากรอกข้อมูลในทุกช่องทางติดต่อที่เลือก");

    const body = new FormData();
    body.append("currentFirstName", firstName);
    body.append("currentLastName", lastName);
    body.append("photoChoice", photoChoice);
    body.append("contacts", JSON.stringify(selectedContactDetails.map(({ type, value }) => ({ type, value }))));
    body.append("bio", bio);
    body.append("pdpaConsent", pdpa);
    if (photo) body.append("photo", photo);

    return run(async () => {
      setUploadStage(photo ? "uploading" : "saving");
      const result = await api("/api/public/submit", { method: "POST", auth: false, headers: { "x-submit-token": submitToken }, body });
      setUploadStage("");
      setPhotoResult(result.photo || null);
      move(6);
    });
  };

  if (step === 6) {
    const print = photoResult?.print;
    return (
      <Shell>
        <section className="screen success">
          <div className="success-mark"><Check /></div>
          <p className="kicker">{editing ? "บันทึกการแก้ไขสำเร็จ" : "ส่งข้อมูลสำเร็จ"}</p>
          <h1>ขอบพระคุณครับ</h1>
          <p className="success-lead">
            {editing ? "ระบบบันทึกข้อมูลที่แก้ไขทับของเดิมเรียบร้อยแล้ว" : "ระบบบันทึกข้อมูลสำหรับหนังสืออนุสรณ์เรียบร้อยแล้ว"}
            <br />
            หากต้องการแก้ไขอีกครั้ง สามารถกลับมายืนยันตัวตนแล้วแก้ไขได้ตลอดจนกว่าจะปิดรับข้อมูล
          </p>

          {photoResult && (
            <div className="photo-done">
              <h3>รูปถ่ายของท่านถูกปรับให้พร้อมพิมพ์แล้ว</h3>
              <dl className="photo-done-facts">
                <div>
                  <dt>ขนาดภาพ</dt>
                  <dd>{photoResult.width.toLocaleString("th-TH")} × {photoResult.height.toLocaleString("th-TH")} พิกเซล</dd>
                </div>
                <div>
                  <dt>ขนาดไฟล์</dt>
                  <dd>{(photoResult.bytes / 1024).toFixed(0)} KB</dd>
                </div>
                {print && (
                  <div>
                    <dt>ขนาดพิมพ์</dt>
                    <dd>{print.widthMm} × {print.heightMm} มม. ที่ {print.dpi} dpi</dd>
                  </div>
                )}
              </dl>
              {print?.quality === "low" && (
                <p className="photo-done-note">
                  ความละเอียดค่อนข้างต่ำสำหรับงานพิมพ์ หากมีไฟล์ต้นฉบับที่ใหญ่กว่านี้ สามารถกลับมาส่งใหม่ได้
                </p>
              )}
            </div>
          )}

          <a className="success-action" href="/">ทำรายการใหม่</a>
        </section>
      </Shell>
    );
  }

  if (!settings.submissionOpen) {
    return (
      <Shell>
        <section className="screen compact">
          <p className="kicker">หนังสืออนุสรณ์ สภจ. 2569</p>
          <h1>ปิดรับข้อมูลแล้ว</h1>
          <p className="closed-lead">{settings.closedMessage}</p>

          <h3 className="section-title">ติดต่อตัวแทนรุ่นของท่าน</h3>
          <p>ระบุรุ่นของท่าน ระบบจะแสดงชื่อและเบอร์ติดต่อของตัวแทนรุ่น</p>
          <form className="search-form" onSubmit={findReps}>
            <input
              inputMode="numeric"
              maxLength="2"
              value={repBatch}
              onChange={(event) => setRepBatch(event.target.value.replace(/\D/g, "").slice(0, 2))}
              placeholder={`รุ่นของท่าน (1-${settings.maxBatch})`}
              autoFocus
            />
            <button aria-label="ค้นหาตัวแทนรุ่น" disabled={busy || !repBatch}><Search /></button>
          </form>

          <Alert>{notice}</Alert>

          {reps && (reps.length ? (
            <div className="rep-list">
              {reps.map((rep) => (
                <div key={`${rep.name}-${rep.phone}`} className="rep-card">
                  <div>
                    <strong>{rep.name}</strong>
                    {rep.formerName && <small>ชื่อสมัยเรียน {rep.formerName}</small>}
                    <span>ตัวแทนรุ่น {repBatch}</span>
                  </div>
                  {rep.phone
                    ? <a className="rep-phone" href={`tel:${rep.phone.replace(/\D/g, "")}`}><Phone /> {rep.phone}</a>
                    : <span className="rep-nophone">ยังไม่ได้ระบุเบอร์ติดต่อ</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="info">
              ยังไม่มีตัวแทนรุ่น {repBatch} ในระบบ กรุณาติดต่อสมาคมนิสิตเก่าคณะเภสัชศาสตร์โดยตรง
            </div>
          ))}
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <Progress current={step} />
      <Alert>{notice}</Alert>

      {step === 0 && (
        <section className="screen welcome-screen">
          <p className="kicker">หนังสืออนุสรณ์ สภจ. 2569</p>
          <h1>ยินดีต้อนรับ</h1>
          <p className="intro">ส่งข้อมูลส่วนตัวสำหรับจัดทำหนังสืออนุสรณ์ สมาคมนิสิตเก่าคณะเภสัชศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย</p>
          <div className="choice-row">
            <button className="intent yes" onClick={() => { setIntent("yes"); move(1); }}>
              <Check /><span>มีความประสงค์</span><small>ส่งข้อมูลเพื่อลงหนังสืออนุสรณ์</small>
            </button>
            <button className="intent no" onClick={() => { setIntent("no"); move(1); }}>
              <X /><span>ไม่มีความประสงค์</span><small>ยืนยันตัวตนเพื่อแจ้งความประสงค์</small>
            </button>
          </div>

          <StatsTicker stats={stats} />
        </section>
      )}

      {step === 1 && (
        <section className="screen compact">
          <p className="kicker">ขั้นตอน 1 จาก 6</p>
          <h2>ระบุรุ่นของท่าน</h2>
          <p>กรอกเป็นตัวเลข ตั้งแต่ 1 ถึง {settings.maxBatch}</p>
          <label className="large-field">
            <span>รุ่น</span>
            <input inputMode="numeric" maxLength="2" value={batch} onChange={(event) => setBatch(event.target.value.replace(/\D/g, "").slice(0, 2))} autoFocus />
          </label>
          <button className="next" disabled={!batch || Number(batch) < 1 || Number(batch) > settings.maxBatch} onClick={() => move(2)}>ถัดไป <ArrowRight /></button>
        </section>
      )}

      {step === 2 && (
        <section className="screen compact">
          <p className="kicker">รุ่น {batch}</p>
          <h2>ค้นหาชื่อเดิมสมัยเรียน</h2>
          <p>กรอกชื่อ หรือนามสกุลเดิมอย่างน้อย 2 ตัวอักษร</p>
          <form className="search-form" onSubmit={search}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="เช่น อนุสรณ์ ทองสะอาด" autoFocus />
            <button aria-label="ค้นหารายชื่อ" disabled={busy}><Search /></button>
          </form>
          <div className="results">
            {matches.map((item) => (
              <button key={item.id} className="result" onClick={() => { setSelected(item); move(3); }}>
                <UserRoundCheck />
                <span>{item.firstName} {item.lastName}</span>
                <small>{item.alreadySubmitted ? "ส่งข้อมูลแล้ว — กดเพื่อแก้ไข" : item.studentId ? `รหัสนิสิต ${item.studentId}` : ""}</small>
                <ArrowRight />
              </button>
            ))}
          </div>
          <button className="back" onClick={() => move(1)}><ChevronLeft /> ย้อนกลับ</button>
        </section>
      )}

      {step === 3 && !alum && (
        <section className="screen compact">
          <p className="kicker">ยืนยันตัวตน</p>
          <h2>ยืนยันว่าเป็นท่าน</h2>
          <div className="identity">
            <span>{selected?.firstName} {selected?.lastName}</span>
            <small>รุ่น {selected?.batch}</small>
          </div>
          <p>
            {intent === "no"
              ? "เพื่อบันทึกความประสงค์ของท่านให้ถูกคน กรุณายืนยันตัวตนด้วยเลขท้ายบัตรประชาชน 5 หลัก"
              : "เพื่อปกป้องข้อมูลส่วนบุคคล กรุณากรอกเลขท้ายบัตรประชาชน 5 หลัก"}
          </p>
          <form onSubmit={verify}>
            <label className="large-field">
              <span>เลขท้ายบัตรประชาชน 5 หลัก</span>
              <input inputMode="numeric" maxLength="5" value={last5} onChange={(event) => setLast5(event.target.value.replace(/\D/g, "").slice(0, 5))} autoFocus />
            </label>
            <button className="next" disabled={last5.length !== 5 || busy}>ยืนยันตัวตน <ShieldCheck /></button>
          </form>
          <p className="privacy-note"><ShieldCheck /> ระบบเก็บเลขนี้ในรูปแบบเข้ารหัสทางเดียวเท่านั้น ใช้ตรวจสอบสิทธิ์ และไม่ปรากฏในหนังสือหรือไฟล์สำหรับออกแบบ</p>
          <button className="back" onClick={() => move(2)}><ChevronLeft /> ย้อนกลับ</button>
        </section>
      )}

      {step === 3 && alum && (
        <section className="screen">
          <p className="kicker">ข้อมูลสำหรับหนังสืออนุสรณ์</p>
          <h2>{editing ? "แก้ไขข้อมูลของท่าน" : "ชื่อที่จะใช้ในหนังสือ"}</h2>
          {editing && (
            <div className="editing-banner">
              <strong>ท่านเคยส่งข้อมูลไว้แล้ว{alum.submittedAt ? ` เมื่อ ${new Date(alum.submittedAt).toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })}` : ""}</strong>
              <span>ระบบดึงข้อมูลเดิมขึ้นมาให้แล้ว ท่านแก้ไขเฉพาะส่วนที่ต้องการ แล้วกดส่งอีกครั้งเพื่อบันทึกทับของเดิมได้เลย</span>
            </div>
          )}
          <p>ยืนยันตัวตนเรียบร้อยแล้ว กรุณากรอกข้อความที่ต้องการให้ปรากฏในหนังสือ</p>
          <div className="identity">
            <span>{alum.legalFirstName} {alum.legalLastName}</span>
            <small>รุ่น {alum.batch}{alum.studentId ? ` · รหัสนิสิต ${alum.studentId}` : ""}</small>
          </div>
          <label className="bio-field">
            <span>ข้อความหรือประวัติโดยย่อ <small>(ไม่เกิน {settings.bioMaxLength} ตัวอักษร)</small></span>
            <textarea value={bio} maxLength={settings.bioMaxLength} rows="4" onChange={(event) => setBio(event.target.value)} placeholder="เช่น ตำแหน่งงานปัจจุบัน หรือข้อความสั้น ๆ ที่ต้องการให้ปรากฏ" />
            <em>{bio.length}/{settings.bioMaxLength}</em>
          </label>
          <div className="purpose">
            <h3>วัตถุประสงค์ของการจัดทำหนังสือ</h3>
            <p>เพื่ออัปเดตชื่อ-นามสกุล รูปถ่ายปัจจุบัน และช่องทางติดต่อของนิสิตเก่า โดยท่านกำหนดได้ว่าจะเปิดเผยข้อมูลใดในหนังสือ</p>
          </div>
          <button className="next" onClick={() => move(4)}>ดำเนินการต่อ <ArrowRight /></button>
        </section>
      )}

      {step === 4 && (
        <section className="screen">
          <p className="kicker">ข้อมูลที่จะแสดงในหนังสือ</p>
          <h2>เลือกข้อมูลที่จะแสดง</h2>

          <h3 className="section-title">ชื่อ-นามสกุลที่จะใช้ในหนังสือ</h3>
          <div className="name-block">
            <div className="name-original">
              <span>ชื่อ-นามสกุลสมัยเรียน</span>
              <strong>{alum?.legalFirstName} {alum?.legalLastName}</strong>
              <small>ระบบเก็บชื่อนี้ไว้เสมอเพื่อใช้ค้นหาและอ้างอิงกับทะเบียนเดิม จะไม่ถูกลบหรือแทนที่</small>
            </div>
            <p className="name-help">หากเปลี่ยนชื่อหรือนามสกุลแล้ว กรอกชื่อปัจจุบันที่ต้องการให้ปรากฏในหนังสือได้เลย</p>
            <div className="two-fields">
              <Field label="ชื่อที่ใช้ในหนังสือ" value={firstName} setValue={setFirstName} />
              <Field label="นามสกุลที่ใช้ในหนังสือ" value={lastName} setValue={setLastName} />
            </div>
            {nameChangedFromLegal && (
              <div className="info">
                ระบบจะบันทึกเพิ่มว่าท่านเปลี่ยนเป็น “{firstName} {lastName}” โดยยังเก็บ
                “{alum?.legalFirstName} {alum?.legalLastName}” ไว้เป็นชื่อสมัยเรียนตามเดิม
              </div>
            )}
            {alum?.nameHistory?.length > 0 && (
              <div className="name-history">
                <span>ชื่อที่เคยบันทึกไว้ก่อนหน้า</span>
                <ul>
                  {alum.nameHistory.map((item) => (
                    <li key={`${item.fullName}-${item.changedAt}`}>
                      {item.fullName}
                      <em>{new Date(item.changedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}</em>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <h3 className="section-title">รูปถ่าย</h3>
          <div className="photo-layout">
            <figure>
              <img src="/assets/yearbook-photo-example.png" alt="ตัวอย่างภาพถ่ายบุคคลที่เหมาะสม" />
              <figcaption>ตัวอย่างภาพที่เหมาะสม</figcaption>
            </figure>
            <div>
              <h3>รูปถ่ายสำหรับหนังสือ</h3>
              <p>ใช้ภาพบุคคลที่เห็นใบหน้าชัด หลีกเลี่ยงภาพหมู่หรือภาพไกล ภาพแนวตั้งและแนวนอนใช้ได้ โดยทีมออกแบบจะครอบภาพเป็นสี่เหลี่ยมจัตุรัส</p>
              <ul>
                <li>พื้นหลังเรียบ แสงเพียงพอ</li>
                <li>ไม่เบลอ และไม่มีสิ่งบังใบหน้า</li>
                <li>JPG, PNG, WEBP หรือ HEIC ไม่เกิน 10 MB</li>
                <li>ควรมีความละเอียดด้านสั้นอย่างน้อย 700 พิกเซล เพื่อให้พิมพ์ออกมาคมชัด</li>
              </ul>
            </div>
          </div>
          <div className="toggle-group">
            <button className={photoChoice === "upload" ? "selected" : ""} onClick={() => setPhotoChoice("upload")}><ImagePlus /> ส่งรูปถ่ายปัจจุบัน</button>
            <button className={photoChoice === "placeholder" ? "selected" : ""} onClick={() => setPhotoChoice("placeholder")}><Landmark /> ไม่แสดงรูป ใช้ภาพคณะแทน</button>
          </div>
          {photoChoice === "upload" && (
            <label className="file-drop">
              <Upload />
              <strong>{photo?.name || (alum?.photo?.downloadUrl ? "มีรูปเดิมอยู่แล้ว — กดเพื่อเปลี่ยนรูป" : "กดเพื่อเลือกรูปภาพ")}</strong>
              <small>ระบบจะย่อและปรับไฟล์ให้พร้อมพิมพ์ 300 dpi ให้อัตโนมัติ</small>
              <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => choosePhoto(event.target.files?.[0] || null)} />
            </label>
          )}
          {photoChoice === "upload" && photoInfo && (
            <div className="photo-status">
              <div className="photo-status-row">
                <span>ไฟล์ที่เลือก</span>
                <strong>{photoInfo.width} x {photoInfo.height} พิกเซล · {(photoInfo.bytes / 1024 / 1024).toFixed(1)} MB</strong>
              </div>
              <div className="photo-status-row">
                <span>ระบบจะปรับให้อัตโนมัติ</span>
                <strong>
                  {photoInfo.willResize
                    ? `ย่อเหลือ ${photoInfo.targetWidth} x ${photoInfo.targetHeight} พิกเซล`
                    : "คงขนาดเดิม (ไม่ต้องย่อ)"}
                </strong>
              </div>
              <ul className="photo-status-list">
                <li>ฝังความละเอียด 300 dpi สำหรับงานพิมพ์</li>
                <li>หมุนภาพให้ตั้งตรงตามที่ถ่ายมา</li>
                <li>ลบข้อมูลตำแหน่ง GPS และข้อมูลกล้องออกทั้งหมด</li>
              </ul>
              <small>พิมพ์ได้สูงสุดประมาณ {Math.round((photoInfo.targetWidth / 300) * 25.4)} x {Math.round((photoInfo.targetHeight / 300) * 25.4)} มม. ที่ 300 dpi</small>
            </div>
          )}
          {photoWarning && <div className="photo-warning">{photoWarning}</div>}
          <h3 className="contact-title">เลือกช่องทางติดต่อที่ต้องการแสดง</h3>
          <p className="contact-help">เลือกได้มากกว่า 1 ช่องทาง หรือเลือกไม่แสดงข้อมูลติดต่อ</p>
          <div className="contact-options">
            {contactOptions.map(([type, label, Icon]) => (
              <button
                key={type}
                className={(type === "none" ? selectedContacts.length === 0 : selectedContacts.includes(type)) ? "selected" : ""}
                onClick={() => type === "none"
                  ? setSelectedContacts([])
                  : setSelectedContacts((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type])}
              >
                <Icon />{label}
              </button>
            ))}
          </div>
          {selectedContactDetails.map((contact) => (
            <Field
              key={contact.type}
              label={contact.label}
              value={contact.value}
              setValue={(value) => setContactValues({
                ...contactValues,
                [contact.type]: contact.type === "phone" ? formatPhoneInput(value) : value
              })}
              placeholder={CONTACT_RULES[contact.type]?.placeholder}
              hint={CONTACT_RULES[contact.type]?.hint}
              inputMode={contact.type === "phone" ? "tel" : "text"}
            />
          ))}
          <button className="next" disabled={!firstName.trim() || !lastName.trim()} onClick={() => move(5)}>ตรวจสอบข้อมูล <ArrowRight /></button>
          <button className="back" onClick={() => move(3)}><ChevronLeft /> ย้อนกลับ</button>
        </section>
      )}

      {step === 5 && (
        <section className="screen">
          <p className="kicker">ยืนยันก่อนส่ง</p>
          <h2>ตรวจสอบข้อมูลของท่าน</h2>
          <div className="review">
            <Review label="ชื่อในหนังสือ" value={`${firstName} ${lastName}`} />
            {nameChangedFromLegal && <Review label="ชื่อสมัยเรียน (เก็บไว้)" value={`${alum?.legalFirstName} ${alum?.legalLastName}`} />}
            <Review label="รูปภาพ" value={photoChoice === "placeholder" ? "ไม่แสดงรูป ใช้ภาพคณะแทน" : photo?.name || (alum?.photo?.downloadUrl ? "ใช้รูปเดิมที่เคยส่งไว้" : "ยังไม่ได้เลือกรูป")} />
            {editing && alum?.photo?.downloadUrl && !photo && photoChoice === "upload" && (
              <div className="existing-photo">
                <span>รูปเดิมของท่าน</span>
                <img src={alum.photo.downloadUrl} alt="รูปถ่ายที่เคยส่งไว้" />
              </div>
            )}
            <Review label="ช่องทางติดต่อ" value={selectedContactDetails.length ? selectedContactDetails.map((item) => `${item.label}: ${item.value}`).join(" | ") : "ไม่ประสงค์แสดง"} />
            <Review label="ประวัติโดยย่อ" value={bio || "ไม่ระบุ"} />
          </div>
          <div className="pdpa">
            <h3>การให้ความยินยอมในการเปิดเผยข้อมูลส่วนบุคคล</h3>
            <p>ข้าพเจ้ายินยอมให้เปิดเผยชื่อ นามสกุล ภาพถ่าย (ถ้ามี) และช่องทางติดต่อ (ถ้ามี) ในหนังสืออนุสรณ์ สภจ. 2569</p>
            <div>
              <button className={pdpa === "yes" ? "consent yes" : "consent"} onClick={() => setPdpa("yes")}><Check /> ยินยอม</button>
              <button className={pdpa === "no" ? "consent no" : "consent"} onClick={() => setPdpa("no")}><X /> ไม่ยินยอม</button>
            </div>
            {pdpa === "no" && <p className="decline-copy">หากไม่ยินยอม ระบบจะไม่บันทึกข้อมูลเพื่อใช้ในหนังสืออนุสรณ์</p>}
          </div>
          {uploadStage && (
            <div className="upload-status">
              <span className="upload-spinner" aria-hidden="true" />
              <div>
                <strong>{uploadStage === "uploading" ? "กำลังอัปโหลดและปรับขนาดรูปให้พร้อมพิมพ์…" : "กำลังบันทึกข้อมูล…"}</strong>
                {uploadStage === "uploading" && <small>ระบบกำลังย่อรูป ฝัง 300 dpi และลบข้อมูลตำแหน่งออก กรุณาอย่าปิดหน้านี้</small>}
              </div>
            </div>
          )}
          <form onSubmit={submit}>
            <button className="submit" disabled={busy || pdpa !== "yes"}>
              {busy ? "กำลังส่งข้อมูล…" : <>{editing ? "บันทึกการแก้ไข" : "ยืนยันและส่งข้อมูล"} <Check /></>}
            </button>
          </form>
          <button className="back" onClick={() => move(4)}><ChevronLeft /> ย้อนกลับ</button>
        </section>
      )}

      {step === 8 && alum && (
        <section className="screen compact">
          <p className="kicker">ยืนยันความประสงค์</p>
          <h2>ไม่ประสงค์ลงหนังสืออนุสรณ์</h2>
          <div className="identity">
            <span>{alum.legalFirstName} {alum.legalLastName}</span>
            <small>รุ่น {alum.batch}</small>
          </div>

          {alum.status === "submitted" ? (
            <div className="decline-warning">
              <strong>ท่านเคยส่งข้อมูลไว้แล้ว</strong>
              <span>
                หากยืนยันไม่ประสงค์ลงหนังสือ ระบบจะ<strong>ลบรูปถ่าย ประวัติโดยย่อ และช่องทางติดต่อ</strong>
                ที่ท่านเคยส่งไว้ออกทั้งหมด และถอนความยินยอมในการเผยแพร่ ข้อมูลเหล่านี้จะกู้คืนไม่ได้
              </span>
            </div>
          ) : (
            <p>
              ระบบจะบันทึกว่าท่านไม่ประสงค์ลงหนังสือ เพื่อให้ตัวแทนรุ่นไม่ต้องติดตามท่านอีก
              โดยไม่มีการเก็บรูปถ่ายหรือข้อมูลส่วนตัวใด ๆ
            </p>
          )}

          <p className="privacy-note">
            <ShieldCheck /> หากเปลี่ยนใจภายหลัง ท่านกลับมายืนยันตัวตนแล้วส่งข้อมูลใหม่ได้ตลอดจนกว่าจะปิดรับ
          </p>

          <button className="decline-confirm" disabled={busy} onClick={confirmDecline}>
            {busy ? "กำลังบันทึก…" : <>ยืนยันไม่ประสงค์ลงหนังสือ <Check /></>}
          </button>
          <button className="back" onClick={() => { setIntent("yes"); move(3); }}>
            <ChevronLeft /> เปลี่ยนใจ ขอส่งข้อมูลแทน
          </button>
        </section>
      )}

      {step === 7 && (
        <section className="screen thank">
          <h1>ขอบพระคุณครับ</h1>
          <p>
            ระบบบันทึกความประสงค์ของท่านเรียบร้อยแล้ว จะไม่มีข้อมูลของท่านปรากฏในหนังสืออนุสรณ์
            และตัวแทนรุ่นจะไม่ติดตามท่านในเรื่องนี้อีก
          </p>
          <a href="/">กลับสู่หน้าแรก</a>
        </section>
      )}
    </Shell>
  );
}

/**
 * Live participation ticker.
 *
 * Shown to encourage batches to respond — seeing that รุ่น 45 is at 89% is a
 * far stronger nudge than a generic "please submit". Only aggregate counts are
 * shown; no names ever appear here.
 */
function StatsTicker({ stats }) {
  if (!stats || !stats.submitted) return null;

  const thai = (value) => Number(value || 0).toLocaleString("th-TH");
  const items = [
    { icon: "✦", text: <>ยืนยันลงหนังสือแล้ว <strong>{thai(stats.submitted)}</strong> คน จากทั้งหมด <strong>{thai(stats.roster)}</strong> คน (<strong>{stats.rate}%</strong>)</> }
  ];

  if (stats.topByRate?.length) {
    items.push({
      icon: "🏆",
      text: <>รุ่นที่ตอบกลับมากที่สุด {stats.topByRate.map((item, index) => (
        <span key={item.batch}>{index > 0 && " · "}<strong>รุ่น {item.batch}</strong> {item.rate}%</span>
      ))}</>
    });
  }
  if (stats.topByCount?.length) {
    items.push({
      icon: "✦",
      text: <>รุ่นที่ส่งข้อมูลมากที่สุด {stats.topByCount.map((item, index) => (
        <span key={item.batch}>{index > 0 && " · "}<strong>รุ่น {item.batch}</strong> {thai(item.submitted)} คน</span>
      ))}</>
    });
  }
  if (stats.needNudge?.length) {
    items.push({
      icon: "📣",
      text: <>ชวนเพื่อนรุ่นเดียวกันมาส่งข้อมูลกันเยอะ ๆ {stats.needNudge.map((item, index) => (
        <span key={item.batch}>{index > 0 && " · "}<strong>รุ่น {item.batch}</strong> {item.rate}%</span>
      ))}</>
    });
  }
  items.push({ icon: "✧", text: <>มีข้อมูลแล้ว <strong>{stats.batchCount}</strong> รุ่น — รุ่นของท่านส่งครบหรือยัง?</> });

  // The list is rendered twice so the loop has no visible seam.
  const strip = (keyPrefix) => items.map((item, index) => (
    <span className="ticker-item" key={`${keyPrefix}-${index}`}>
      <i aria-hidden="true">{item.icon}</i>{item.text}
    </span>
  ));

  return (
    <div className="ticker" role="status" aria-label="สถิติการส่งข้อมูล">
      <div className="ticker-track">
        <div className="ticker-strip">{strip("a")}</div>
        <div className="ticker-strip" aria-hidden="true">{strip("b")}</div>
      </div>
    </div>
  );
}

function Progress({ current }) {
  return (
    <ol className="progress">
      {steps.map((label, index) => (
        <li className={index <= current ? "active" : ""} key={label}>
          <i>{index + 1}</i>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}
