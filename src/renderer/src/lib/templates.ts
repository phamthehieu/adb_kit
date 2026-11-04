import type { Step } from '@shared/automation'

export interface Template {
  id: string
  title: string
  desc: string
  /** What the tester should add or look at; shown after inserting. */
  after: string
  make: (app: string) => Step[]
}

const HOME: Step = { type: 'key', code: 3, name: 'Home' }
const shot = (label: string): Step => ({ type: 'screenshot', label })

/**
 * Ready-made situations real users hit. They only prepare and observe (screenshots at each stage) —
 * the tester adds the checks that matter for their app, so each template works for any app.
 */
export const TEMPLATES: Template[] = [
  {
    id: 'offline',
    title: 'Mất mạng giữa chừng',
    desc: 'Chụp màn hình trước, tắt Wi-Fi + 4G, chụp lại, rồi bật mạng lại và chụp lần nữa.',
    after: 'Chèn các bước thao tác của bạn (vd. bấm Thanh toán) giữa “tắt mạng” và “bật lại mạng”.',
    make: () => [
      shot('Trước khi mất mạng'),
      { type: 'network', wifi: 'off', data: 'off' },
      { type: 'wait', ms: 3000 },
      shot('Khi mất mạng'),
      { type: 'network', wifi: 'on', data: 'on' },
      { type: 'wait', ms: 6000 },
      shot('Sau khi có mạng lại')
    ]
  },
  {
    id: 'killed',
    title: 'App bị hệ điều hành giết rồi mở lại',
    desc: 'Về màn hình chính, giết tiến trình của app (như khi hết RAM), mở lại và chụp.',
    after: 'Thêm bước “Kiểm tra chữ có hiển thị” để chắc app quay về đúng màn hình và còn dữ liệu.',
    make: (app) => [
      shot('Trước khi bị giết'),
      HOME,
      { type: 'wait', ms: 1500 },
      { type: 'shell', cmd: `am kill ${app || '<gói app>'}` },
      { type: 'wait', ms: 1000 },
      { type: 'launch', pkg: app, clear: false },
      { type: 'wait', ms: 3000 },
      shot('Sau khi mở lại')
    ]
  },
  {
    id: 'background',
    title: 'Đưa app xuống nền rồi quay lại',
    desc: 'Bấm Home, đợi 10 giây, mở lại app và chụp.',
    after: 'Hợp để kiểm tra phiên đăng nhập, bộ đếm, video đang phát có còn đúng không.',
    make: (app) => [shot('Trước'), HOME, { type: 'wait', ms: 10_000 }, { type: 'launch', pkg: app, clear: false }, { type: 'wait', ms: 2000 }, shot('Sau khi quay lại')]
  },
  {
    id: 'rotate',
    title: 'Xoay ngang rồi xoay dọc',
    desc: 'Tắt tự xoay, xoay ngang, chụp, xoay dọc, chụp, rồi trả lại cài đặt xoay.',
    after: 'So hai ảnh để thấy giao diện có vỡ hoặc mất dữ liệu khi xoay không.',
    make: () => [
      { type: 'shell', cmd: 'settings put system accelerometer_rotation 0' },
      { type: 'shell', cmd: 'settings put system user_rotation 1' },
      { type: 'wait', ms: 1500 },
      shot('Màn hình ngang'),
      { type: 'shell', cmd: 'settings put system user_rotation 0' },
      { type: 'wait', ms: 1500 },
      shot('Màn hình dọc'),
      { type: 'shell', cmd: 'settings put system accelerometer_rotation 1' }
    ]
  },
  {
    id: 'noperm',
    title: 'Từ chối hết quyền rồi mở app',
    desc: 'Thu hồi mọi quyền của app, mở app, chụp. Dùng cho người dùng bấm “Từ chối” ở mọi hộp thoại.',
    after: 'App phải báo rõ cần quyền gì, không được treo hay thoát ngang.',
    make: (app) => [{ type: 'permRevokeAll', pkg: app }, { type: 'launch', pkg: app, clear: false }, { type: 'wait', ms: 4000 }, shot('Mở app khi chưa có quyền nào')]
  },
  {
    id: 'cold',
    title: 'Đo tốc độ mở app (mở nguội)',
    desc: 'Tắt hẳn app, mở lại và đòi thời gian mở không quá 3 giây.',
    after: 'Đổi ngưỡng 3000 ms theo yêu cầu của dự án.',
    make: (app) => [{ type: 'stopApp', pkg: app }, { type: 'wait', ms: 1000 }, { type: 'launch', pkg: app, clear: false }, { type: 'perf', metric: 'startup', max: 3000 }, shot('Sau khi mở')]
  },
  {
    id: 'fresh',
    title: 'Mở app như người mới cài',
    desc: 'Xóa dữ liệu, thu hồi quyền, mở app và chụp màn hình đầu tiên.',
    after: 'Thêm các bước đi qua màn hình giới thiệu / đăng nhập của app.',
    make: (app) => [{ type: 'permRevokeAll', pkg: app }, { type: 'launch', pkg: app, clear: true }, { type: 'wait', ms: 4000 }, shot('Lần mở đầu tiên')]
  }
]
