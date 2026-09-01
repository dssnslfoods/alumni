export function Shell({ children, wide = false }) {
  return (
    <main className={wide ? "site wide" : "site"}>
      <header>
        <img className="brand-mark" src="/assets/logo.png" alt="สภจ." />
        <div>
          <strong>สมาคมนิสิตเก่าคณะเภสัชศาสตร์</strong>
          <span>จุฬาลงกรณ์มหาวิทยาลัย</span>
        </div>
        <span className="year">2569</span>
      </header>
      <div className="floral" aria-hidden="true">✦ ✧ ❀</div>
      {children}
      <footer>
        หนังสืออนุสรณ์ สภจ. 2569
        <span>
          <a href="/privacy">Privacy Notice</a> · ข้อมูลของท่านจะใช้ตามความยินยอมที่ระบุเท่านั้น
        </span>
      </footer>
    </main>
  );
}

export function Field({ label, value, setValue, type = "text", hint, ...rest }) {
  return (
    <label className="field">
      <span>{label}{hint && <small> {hint}</small>}</span>
      <input type={type} value={value} onChange={(event) => setValue(event.target.value)} {...rest} />
    </label>
  );
}

export function Review({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function Alert({ tone = "error", children }) {
  if (!children) return null;
  return <div className={`alert ${tone}`} role="alert">{children}</div>;
}
