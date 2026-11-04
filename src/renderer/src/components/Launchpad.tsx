import { BellRing, Bot, ClipboardCheck, Gauge, Database, FileText, Hammer, KeyRound, MessageSquareText, Network, ScanEye, ScrollText, ShieldCheck, BookOpen } from 'lucide-react'

interface Task {
  icon: React.ReactNode
  title: string
  desc: string
  panel: string
  /** localStorage values to set first, so the panel opens on the right tab. */
  prefs?: Record<string, string>
}

const TEST: Task[] = [
  { icon: <Bot size={18} />, title: 'Test tự động một luồng', desc: 'Ghi thao tác trên điện thoại rồi chạy lại bao nhiêu lần cũng được', panel: 'auto', prefs: { autoTab: 'script' } },
  { icon: <ClipboardCheck size={18} />, title: 'Test tay theo file KBKT', desc: 'Bấm Đạt / Lỗi — ảnh, log, video tự được lưu và gắn vào Excel', panel: 'auto', prefs: { autoTab: 'manual' } },
  { icon: <KeyRound size={18} />, title: 'Đăng nhập sẵn bằng tài khoản đã lưu', desc: 'Lưu và khôi phục dữ liệu app trong vài giây, khỏi nhập OTP lại', panel: 'data', prefs: { dataTab: 'state' } },
  { icon: <MessageSquareText size={18} />, title: 'Điền mã OTP', desc: 'Lấy mã từ thông báo trên điện thoại và điền một chạm', panel: 'data', prefs: { dataTab: 'otp' } },
  { icon: <ScanEye size={18} />, title: 'Soát giao diện', desc: 'Tìm chữ bị cắt, vùng bấm quá nhỏ; thử cỡ chữ to, chế độ tối', panel: 'check', prefs: { checkTab: 'scan' } },
  { icon: <Hammer size={18} />, title: 'Thử tình huống khó', desc: 'App bị giết, thiếu RAM, Doze, đổi ngôn ngữ / giờ, đầy bộ nhớ', panel: 'stress' },
  { icon: <BellRing size={18} />, title: 'Thử chạm vào thông báo', desc: 'Đăng thông báo thử lên máy, xem app mở đúng màn hình — không cần BE hay khóa Firebase', panel: 'push' },
  { icon: <FileText size={18} />, title: 'Từ tài liệu yêu cầu (BA)', desc: 'Nhập file Word, sinh testcase và soát màn hình theo tài liệu', panel: 'req' }
]

const DEBUG: Task[] = [
  { icon: <Gauge size={18} />, title: 'Xem app có giật, nặng, nóng máy không', desc: 'RAM, CPU, khung hình, pin theo thời gian thực; đánh dấu và lưu ra Excel', panel: 'perf' },
  { icon: <Network size={18} />, title: 'Xem API của app, giả lập lỗi server', desc: 'Mọi request theo thời gian thực; thử 500, mạng chậm, mất mạng', panel: 'net' },
  { icon: <ScrollText size={18} />, title: 'Xem log và crash', desc: 'Logcat lọc theo app, mức log và từ khóa', panel: 'logcat' },
  { icon: <ShieldCheck size={18} />, title: 'Cấp hoặc thu hồi quyền', desc: 'Máy ảnh, vị trí, thông báo… hoặc đưa app về như mới cài', panel: 'perm' },
  { icon: <Database size={18} />, title: 'Xem và sửa dữ liệu app', desc: 'SharedPreferences, database SQLite (app bản debug)', panel: 'data', prefs: { dataTab: 'app' } }
]

/**
 * What the empty workspace offers: the things testers and developers actually come to do, in their
 * own words, each opening the right panel on the right tab. Disappears as soon as a panel is open.
 */
export function Launchpad({ onOpen, only }: { onOpen: (panel: string, prefs?: Record<string, string>) => void; only?: string[] }) {
  const allowed = (t: Task): boolean => !only || only.includes(t.panel)
  const test = TEST.filter(allowed)
  const debug = DEBUG.filter(allowed)
  const card = (t: Task): React.ReactNode => (
    <button key={t.title} className="l-card" onClick={() => onOpen(t.panel, t.prefs)}>
      <span className="l-ico">{t.icon}</span>
      <span className="l-txt">
        <b>{t.title}</b>
        <span>{t.desc}</span>
      </span>
    </button>
  )
  return (
    <aside className="launch" aria-label="Bắt đầu nhanh">
      <h2>Bạn muốn làm gì?</h2>
      <div className="l-sub">Chọn một việc, ADB Kit mở đúng công cụ cho bạn. Điện thoại đã sẵn sàng ở bên trái.</div>
      {only && <div className="l-sub">Đang ở <b>chế độ đơn giản</b> — chỉ hiện công cụ chỉ đọc và test. Bấm “Đơn giản” trên thanh công cụ để hiện đủ.</div>}
      <div className="l-cap">Kiểm thử</div>
      <div className="l-grid">{test.map(card)}</div>
      {debug.length > 0 && <div className="l-cap">Gỡ lỗi</div>}
      <div className="l-grid">{debug.map(card)}</div>
      <div className="l-foot">
        <button className="l-card" onClick={() => onOpen('help')}>
          <span className="l-ico"><BookOpen size={18} /></span>
          <span className="l-txt">
            <b>Mới dùng lần đầu?</b>
            <span>Mở Hướng dẫn: có từng bước và nút “Chỉ cho tôi” trực tiếp trên giao diện</span>
          </span>
        </button>
        <p>
          Gặp lỗi khi đang test? Bấm <kbd>F8</kbd> để báo lỗi: ảnh, video vừa rồi, log và các thao tác được lưu ngay. Chuột phải trên màn hình điện thoại = Back, chuột giữa = Home.
        </p>
      </div>
    </aside>
  )
}
