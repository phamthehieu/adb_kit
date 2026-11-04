/**
 * "Độ bền": one-tap ways to put the phone (or an app) into the situations real users hit and
 * test benches never do — the process killed in the background, low memory, Doze, a different
 * language, a wrong clock, a nearly full disk — so those bugs show up before release.
 */
export type StressGroup = 'process' | 'power' | 'display' | 'locale' | 'network' | 'storage'

export interface StressChoice {
  value: string
  label: string
}

export interface StressItem {
  id: string
  group: StressGroup
  label: string
  /** What it does and which kind of bug it exposes. */
  desc: string
  /** action = do once; toggle = on/off; choice = pick a value (and "Bình thường" puts it back). */
  kind: 'action' | 'toggle' | 'choice'
  /** Needs the app under test chosen. */
  pkg?: boolean
  /** Can disturb the whole phone (clock, storage, other apps): shown with a warning. */
  careful?: boolean
  choices?: StressChoice[]
  /** First Android API level where it works (a clear message is shown below it). */
  minSdk?: number
}

export const STRESS_GROUPS: Record<StressGroup, { title: string; hint: string }> = {
  process: { title: 'Tiến trình & bộ nhớ', hint: 'App bị hệ điều hành giết hoặc thiếu RAM — nguồn của lỗi “mở lại là mất màn hình / mất dữ liệu”.' },
  power: { title: 'Pin & chế độ chờ', hint: 'Doze, hạn chế chạy nền, pin yếu — nguồn của lỗi thông báo trễ, đồng bộ ngừng, tác vụ nền chết.' },
  display: { title: 'Màn hình', hint: 'Xoay màn hình, không giữ hoạt động, tắt hiệu ứng — nguồn của lỗi mất trạng thái khi tạo lại màn hình.' },
  locale: { title: 'Ngôn ngữ & giờ', hint: 'Ngôn ngữ khác, múi giờ khác, đồng hồ sai — nguồn của lỗi định dạng, token hết hạn, lịch.' },
  network: { title: 'Kết nối', hint: 'Mất mạng toàn máy ở mức hệ thống.' },
  storage: { title: 'Bộ nhớ trống', hint: 'Máy gần đầy — nguồn của lỗi không lưu được, tải thất bại, app crash khi ghi tệp.' }
}

const bool = (id: string, group: StressGroup, label: string, desc: string, extra: Partial<StressItem> = {}): StressItem => ({ id, group, label, desc, kind: 'toggle', ...extra })

export const STRESS_ITEMS: StressItem[] = [
  {
    id: 'kill-return',
    group: 'process',
    label: 'Giết tiến trình rồi quay lại app',
    desc: 'Về màn hình chính, hệ điều hành “giết” tiến trình của app (như khi hết RAM), rồi mở lại. App phải khôi phục đúng màn hình và dữ liệu đang nhập.',
    kind: 'action',
    pkg: true
  },
  {
    id: 'trim-memory',
    group: 'process',
    label: 'Báo thiếu bộ nhớ cho app',
    desc: 'Gửi tín hiệu “hết RAM” để app phải giải phóng cache và bitmap; mức càng nặng càng giống máy yếu.',
    kind: 'choice',
    pkg: true,
    choices: [
      { value: 'RUNNING_MODERATE', label: 'Vừa (đang chạy)' },
      { value: 'RUNNING_LOW', label: 'Thấp (đang chạy)' },
      { value: 'RUNNING_CRITICAL', label: 'Nguy cấp (đang chạy)' },
      { value: 'HIDDEN', label: 'Giao diện bị ẩn' },
      { value: 'COMPLETE', label: 'Sắp bị giết (nền)' }
    ]
  },
  {
    id: 'kill-all-bg',
    group: 'process',
    label: 'Giết mọi app đang chạy nền',
    desc: 'Máy đầy RAM: mọi tiến trình nền bị dọn. Thử xem app có tự dựng lại dịch vụ và dữ liệu khi quay về không.',
    kind: 'action',
    careful: true
  },
  bool('dont-keep', 'display', 'Không giữ hoạt động (Don’t keep activities)', 'Mỗi màn hình bị hủy ngay khi rời đi, để lộ lỗi không lưu / khôi phục trạng thái màn hình.'),

  bool('doze', 'power', 'Chế độ Doze sâu', 'Giả lập máy để yên lâu: mạng, báo thức và tác vụ nền bị chặn. Kiểm tra thông báo đẩy và đồng bộ nền.', { careful: true }),
  {
    id: 'standby-bucket',
    group: 'power',
    label: 'Nhóm chờ của app (App Standby)',
    desc: 'Hạ app xuống nhóm ít dùng: tác vụ nền, báo thức và thông báo bị giới hạn nặng hơn.',
    kind: 'choice',
    pkg: true,
    choices: [
      { value: 'active', label: 'Đang dùng' },
      { value: 'working_set', label: 'Dùng thường xuyên' },
      { value: 'frequent', label: 'Ít khi dùng' },
      { value: 'rare', label: 'Hiếm khi dùng' },
      { value: 'restricted', label: 'Bị hạn chế' }
    ]
  },
  bool('bg-restrict', 'power', 'Cấm app chạy nền', 'Như khi người dùng bật “Hạn chế hoạt động nền” cho app: dịch vụ nền bị dừng.', { pkg: true }),
  {
    id: 'battery-level',
    group: 'power',
    label: 'Giả lập mức pin',
    desc: 'Đặt phần trăm pin giả để xem app xử lý pin yếu (cảnh báo, ngừng đồng bộ, tắt video).',
    kind: 'choice',
    choices: [
      { value: '5', label: '5%' },
      { value: '15', label: '15%' },
      { value: '50', label: '50%' }
    ]
  },
  bool('battery-saver', 'power', 'Chế độ tiết kiệm pin', 'Bật tiết kiệm pin của hệ điều hành: nền bị hạn chế, hiệu ứng giảm.'),

  {
    id: 'rotation',
    group: 'display',
    label: 'Xoay màn hình',
    desc: 'Khóa hướng màn hình theo ý muốn để thử giao diện ngang và việc tạo lại màn hình khi xoay.',
    kind: 'choice',
    choices: [
      { value: '0', label: 'Dọc' },
      { value: '1', label: 'Ngang (xoay trái)' },
      { value: '3', label: 'Ngang (xoay phải)' },
      { value: '2', label: 'Dọc ngược' }
    ]
  },
  bool('animations', 'display', 'Tắt hiệu ứng chuyển động', 'Đặt thang hiệu ứng về 0: test tự động chạy nhanh và ổn định hơn.'),
  bool('touches', 'display', 'Hiện điểm chạm trên màn hình', 'Vẽ chấm mỗi lần chạm — hữu ích khi quay video lỗi cho dev xem.'),

  {
    id: 'app-locale',
    group: 'locale',
    label: 'Ngôn ngữ riêng của app',
    desc: 'Đổi ngôn ngữ chỉ cho app này (Android 13+). Thử văn bản dài, định dạng ngày giờ, tiền tệ và chữ phải-sang-trái (Ả Rập).',
    kind: 'choice',
    pkg: true,
    minSdk: 33,
    choices: [
      { value: 'vi-VN', label: 'Tiếng Việt' },
      { value: 'en-US', label: 'English (US)' },
      { value: 'ja-JP', label: '日本語' },
      { value: 'ar-SA', label: 'العربية (phải sang trái)' },
      { value: 'de-DE', label: 'Deutsch (chữ dài)' }
    ]
  },
  {
    id: 'open-locale',
    group: 'locale',
    label: 'Mở cài đặt ngôn ngữ của máy',
    desc: 'Máy dưới Android 13 không đổi ngôn ngữ từng app được: mở trang cài đặt để đổi ngôn ngữ cả máy.',
    kind: 'action'
  },
  {
    id: 'timezone',
    group: 'locale',
    label: 'Múi giờ',
    desc: 'Đổi múi giờ máy để lộ lỗi hiển thị và tính toán thời gian (nửa đêm, lệch ngày).',
    kind: 'choice',
    careful: true,
    choices: [
      { value: 'UTC', label: 'UTC' },
      { value: 'Asia/Tokyo', label: 'Tokyo (+9)' },
      { value: 'America/Los_Angeles', label: 'Los Angeles (−8)' },
      { value: 'Pacific/Kiritimati', label: 'Kiritimati (+14)' }
    ]
  },
  {
    id: 'clock',
    group: 'locale',
    label: 'Đổi đồng hồ máy',
    desc: 'Đẩy giờ máy tới hoặc lui để thử token hết hạn, mã OTP, ưu đãi theo ngày. Máy có thể từ chối trên một số hãng; ADB Kit tự trả giờ về đúng khi khôi phục.',
    kind: 'choice',
    careful: true,
    choices: [
      { value: String(60 * 60_000), label: '+1 giờ' },
      { value: String(24 * 60 * 60_000), label: '+1 ngày' },
      { value: String(30 * 24 * 60 * 60_000), label: '+30 ngày' },
      { value: String(-24 * 60 * 60_000), label: '−1 ngày' }
    ]
  },

  bool('airplane', 'network', 'Chế độ máy bay', 'Cắt mọi kết nối ở mức hệ thống. Không dùng được khi đang nối adb qua Wi-Fi.', { careful: true }),

  {
    id: 'fill-storage',
    group: 'storage',
    label: 'Làm đầy bộ nhớ máy',
    desc: 'Tạo một tệp lớn để chỉ còn một lượng trống nhất định. Luôn chừa tối thiểu 100 MB để máy không treo; “Khôi phục” xóa tệp ngay.',
    kind: 'choice',
    careful: true,
    choices: [
      { value: '1000', label: 'Chỉ còn 1 GB' },
      { value: '500', label: 'Chỉ còn 500 MB' },
      { value: '200', label: 'Chỉ còn 200 MB' },
      { value: '100', label: 'Chỉ còn 100 MB' }
    ]
  }
]

/** What ADB Kit has changed on a phone and not yet put back. */
export interface StressApplied {
  id: string
  label: string
  /** Human text of the value, e.g. "Ngang (xoay trái)". */
  value: string
  at: number
}

export interface StressStatus {
  applied: StressApplied[]
  /** Android API level of the phone (0 = unknown). */
  sdk: number
  /** Free space on the data partition, in MB (-1 = unknown). */
  freeMb: number
}

export interface StressResult {
  ok: boolean
  message: string
}
