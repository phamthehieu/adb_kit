import { FRESH_LABEL, FRESH_PERMS_LABEL, type FreshMode, type FreshPerms } from '@shared/automation'

/**
 * "Trạng thái app trước khi chạy": works for any app (the script's "App cần test"), on any phone.
 * Used by the script runner and by suites (where it applies before every test case and retry).
 */
export function FreshOptions({
  fresh,
  perms,
  app,
  disabled,
  onChange
}: {
  fresh: FreshMode
  perms: FreshPerms
  /** The app under test; without one nothing can be reset. */
  app?: string
  disabled?: boolean
  onChange: (fresh: FreshMode, perms: FreshPerms) => void
}) {
  const active = fresh !== 'off' || perms !== 'keep'
  return (
    <>
      <label className="field-inline" title="Đưa app cần test về cùng một trạng thái trước mỗi lần chạy, để kết quả không phụ thuộc lần chạy trước. Áp dụng cho app nào cũng được.">
        Trước khi chạy
        <select className="input sm fresh-sel" value={fresh} disabled={disabled} onChange={(e) => onChange(e.target.value as FreshMode, perms)}>
          {(Object.keys(FRESH_LABEL) as FreshMode[]).map((m) => (
            <option key={m} value={m}>{FRESH_LABEL[m]}</option>
          ))}
        </select>
      </label>
      <label className="field-inline" title="Quyền runtime (camera, vị trí, thông báo…) của app: cấp hết để hộp thoại hệ thống không chen vào luồng test, hoặc thu hồi hết để test đúng lúc app xin quyền.">
        Quyền
        <select className="input sm fresh-sel" value={perms} disabled={disabled} onChange={(e) => onChange(fresh, e.target.value as FreshPerms)}>
          {(Object.keys(FRESH_PERMS_LABEL) as FreshPerms[]).map((m) => (
            <option key={m} value={m}>{FRESH_PERMS_LABEL[m]}</option>
          ))}
        </select>
      </label>
      {fresh === 'clear' && <span style={{ color: 'var(--warn)' }}>⚠ Mất đăng nhập và dữ liệu của app mỗi lần</span>}
      {active && !app && <span className="muted">Chưa chọn “App cần test” nên chưa có tác dụng</span>}
    </>
  )
}
