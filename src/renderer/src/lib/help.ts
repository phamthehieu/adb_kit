/**
 * In-app user guide: one topic per feature (shown in the "Hướng dẫn" tab) and, for most
 * topics, a guided tour that dims the window and points at the real buttons one by one.
 * Wording follows the labels on screen exactly, so testers can find what the text says.
 */

/** Panels a tour step can open (same ids as App's panels). */
export type HelpPanel = 'none' | 'files' | 'logcat' | 'shell' | 'net' | 'perm' | 'auto' | 'figma' | 'mini' | 'check' | 'help' | 'install' | 'data'

/** Where a step points: a CSS selector, or a button / label whose text contains `text`. */
export type Target = string | { text: string; within?: string }

export interface TourStep {
  target?: Target
  /** Open this panel first (the element lives inside it). */
  panel?: HelpPanel
  title: string
  body: string
}

export interface HelpTopic {
  id: string
  group: 'Cơ bản' | 'Kiểm thử' | 'Super app & giao diện' | 'Báo lỗi'
  title: string
  /** One line shown in the table of contents. */
  summary: string
  /** Real situations where this feature helps. */
  when?: string[]
  /** Quick step-by-step usage. */
  steps: string[]
  /** What each button / field does: [label on screen, explanation]. */
  buttons?: [string, string][]
  /** A worked example from start to finish. */
  example?: { title: string; steps: string[] }
  /** Common problems: [what you see, what to do]. */
  faq?: [string, string][]
  tips?: string[]
  tour?: TourStep[]
}

export const GROUPS: HelpTopic['group'][] = ['Cơ bản', 'Kiểm thử', 'Super app & giao diện', 'Báo lỗi']

const tool = (id: string): string => `[data-tour="tool-${id}"]`

export const TOPICS: HelpTopic[] = [
  /* ================================================================ Cơ bản */
  {
    id: 'start',
    group: 'Cơ bản',
    title: 'Bắt đầu: kết nối điện thoại',
    summary: 'Bật gỡ lỗi USB, cắm máy, hiểu màn hình chính',
    when: ['Lần đầu dùng ADB Kit với một điện thoại mới.', 'Điện thoại không hiện trên thanh trên cùng.'],
    steps: [
      'Trên điện thoại: Cài đặt › Thông tin điện thoại › Thông tin phần mềm › bấm 7 lần vào "Số hiệu bản tạo" (Build number). Máy báo "Đã bật chế độ nhà phát triển".',
      'Quay lại Cài đặt › Tùy chọn nhà phát triển › bật "Gỡ lỗi USB".',
      'Cắm cáp USB (cáp có truyền dữ liệu, không phải cáp chỉ sạc). Trên điện thoại hiện hộp thoại "Cho phép gỡ lỗi USB?" → tick "Luôn cho phép từ máy tính này" → Cho phép.',
      'Tên máy hiện ở thanh trên cùng (chấm xanh = sẵn sàng). Màn hình điện thoại tự hiện bên trái sau 1–2 giây.',
      'Điều khiển bằng chuột và bàn phím như đang cầm máy (xem mục "Điều khiển màn hình").'
    ],
    buttons: [
      ['Tên máy (thanh trên cùng)', 'Bấm để chuyển giữa nhiều máy đang cắm. Biểu tượng cáp = USB, sóng = Wi-Fi. Chữ vàng "unauthorized" = chưa bấm Cho phép trên điện thoại.'],
      ['+', 'Kết nối máy qua Wi-Fi (nhập ip:cổng) hoặc ghép đôi Gỡ lỗi không dây (Android 11+).'],
      ['⚙ (góc phải)', 'Chất lượng mirror: độ phân giải tối đa, bitrate, FPS. Máy tính yếu hoặc mạng Wi-Fi chậm → chọn 1024 / 4 Mbps / 30.'],
      ['Thanh công cụ', 'Mỗi nút mở một bảng bên cạnh màn hình điện thoại; bấm lại để đóng. Kéo thanh dọc giữa điện thoại và bảng để đổi độ rộng, bấm đúp để về mặc định.'],
      ['Dòng chữ dưới cùng', 'Thông báo kết quả gần nhất (ví dụ đường dẫn ảnh vừa chụp — bấm để mở thư mục).']
    ],
    faq: [
      ['Không thấy máy nào', 'Thử cáp khác / cổng USB khác; trên điện thoại kéo thanh thông báo, chọn chế độ USB "Truyền tệp" (MTP). Máy Xiaomi/Oppo: bật thêm "Gỡ lỗi USB (Cài đặt bảo mật)".'],
      ['Máy báo "unauthorized"', 'Mở khóa điện thoại, chờ hộp thoại "Cho phép gỡ lỗi USB?" rồi bấm Cho phép. Không thấy hộp thoại: Tùy chọn nhà phát triển › "Thu hồi ủy quyền gỡ lỗi USB" rồi rút cắm lại.'],
      ['Máy này chưa có adb', 'Bấm "Tải adb từ Google" (khoảng 7 MB, bản chính thức), không cần cài Android SDK.'],
      ['Màn hình đen / "Đang khởi động mirror…" mãi', 'Bấm "Thử lại" trên màn hình; nếu vẫn vậy, giảm độ phân giải trong ⚙. Một số app (ngân hàng) chặn chụp màn hình nên hiện màu đen — đó là bình thường.']
    ],
    tour: [
      { target: '.topbar', title: 'Thiết bị', body: 'Điện thoại đã kết nối hiện ở đây (chấm xanh = sẵn sàng). Bấm để chuyển máy; dấu + để kết nối qua Wi-Fi; ⚙ chỉnh chất lượng hình.' },
      { target: '.phone', panel: 'none', title: 'Màn hình điện thoại', body: 'Điều khiển trực tiếp: bấm = chạm, kéo = vuốt, cuộn chuột = cuộn, gõ phím = nhập chữ. Chuột phải = Back, chuột giữa = Home.' },
      { target: '.screen-box .side', title: 'Nút bên trái', body: 'Cài APK, chụp màn hình (lưu vào Pictures › ADB Kit), kéo thanh thông báo xuống.' },
      { target: '.screen-box .side:last-child', title: 'Nút bên phải', body: 'Nút nguồn, tăng / giảm âm lượng, xoay màn hình, và tắt màn hình điện thoại (vẫn điều khiển được từ đây — tiết kiệm pin, đỡ nóng máy).' },
      { target: '.navbar', title: 'Back · Home · Đa nhiệm', body: 'Ba nút điều hướng của Android.' },
      { target: '.toolbar', title: 'Các công cụ', body: 'Mỗi nút mở một bảng bên cạnh màn hình điện thoại. Bấm lại để đóng. Kéo thanh dọc giữa hai bên để đổi độ rộng.' },
      { target: '[data-tour="bug"]', title: 'Báo lỗi (F8)', body: 'Gặp lỗi lúc đang test tay: bấm đây hoặc F8 — ảnh, video vừa rồi, log, API được lưu ngay.' },
      { target: tool('help'), title: 'Hướng dẫn', body: 'Mở lại hướng dẫn bất cứ lúc nào. Mỗi mục có nút "Chỉ cho tôi" để xem trực tiếp trên giao diện.' }
    ]
  },
  {
    id: 'control',
    group: 'Cơ bản',
    title: 'Điều khiển màn hình điện thoại',
    summary: 'Chuột, bàn phím, dán chữ, xoay, tắt màn hình, chụp ảnh',
    steps: [
      'Bấm chuột trái = chạm. Giữ và kéo = vuốt. Giữ lâu (≥ 0,5 giây) = nhấn giữ.',
      'Cuộn chuột = cuộn danh sách / trang.',
      'Bấm vào màn hình điện thoại một lần rồi gõ phím: chữ được gõ vào ô đang chọn trên điện thoại. Enter, Backspace, phím mũi tên, Home/End, PageUp/PageDown đều dùng được.',
      'Ctrl + V: dán chữ đang copy trên máy tính vào điện thoại (dùng cho chữ tiếng Việt có dấu, mật khẩu dài, link).',
      'Chuột phải = Back, chuột giữa = Home.'
    ],
    buttons: [
      ['Cài APK (bên trái, nút đầu)', 'Mở bảng cài APK.'],
      ['Chụp màn hình', 'Lưu ảnh PNG đúng độ phân giải của máy vào Pictures › ADB Kit; bấm vào dòng thông báo dưới cùng để mở thư mục.'],
      ['Quay video (máy quay)', 'Quay màn hình thành MP4 (Videos › ADB Kit); bấm lại để dừng.'],
      ['Kéo thanh thông báo', 'Mở thanh thông báo của điện thoại.'],
      ['Nút nguồn', 'Như bấm nút nguồn thật (tắt / mở màn hình).'],
      ['Tăng / giảm âm lượng', 'Như nút âm lượng thật.'],
      ['Xoay màn hình', 'Xoay dọc ⇄ ngang (tự tắt "Tự động xoay"). Màn hình chính và nhiều app khóa chiều dọc nên có thể không xoay.'],
      ['Tắt màn hình điện thoại', 'Màn hình thật tối đi nhưng vẫn điều khiển và xem được trên máy tính. Màn hình sáng lại khi dừng mirror.'],
      ['Số fps (góc trên)', 'Số khung hình mỗi giây đang nhận; "đứng yên" = màn hình không đổi (bình thường).']
    ],
    faq: [
      ['Gõ phím không ra chữ trên điện thoại', 'Bấm vào màn hình điện thoại trên ADB Kit một lần (để nó nhận phím), và chạm vào ô nhập trên điện thoại cho bàn phím hiện lên.'],
      ['Gõ tiếng Việt có dấu bị lỗi', 'Gõ bên ngoài (Notepad) rồi Ctrl + V vào điện thoại.'],
      ['Bấm không ăn, có khung "Đang chạy test"', 'Một kịch bản đang chạy nên thao tác tay bị khóa. Đợi chạy xong hoặc bấm "Vẫn cho phép thao tác tay".']
    ],
    tour: [
      { target: '.phone', panel: 'none', title: 'Chạm, vuốt, gõ', body: 'Bấm = chạm, kéo = vuốt, cuộn chuột = cuộn. Bấm vào đây rồi gõ phím để nhập chữ; Ctrl + V để dán.' },
      { target: '.screen-box .side:last-child', title: 'Nút phần cứng', body: 'Nguồn, âm lượng, xoay, và tắt màn hình thật (vẫn điều khiển từ máy tính).' },
      { target: '.fps', title: 'FPS', body: '"đứng yên" nghĩa là màn hình không đổi — không phải lỗi.' }
    ]
  },
  {
    id: 'install',
    group: 'Cơ bản',
    title: 'Cài APK',
    summary: 'Kéo thả hoặc chọn file APK, các tùy chọn cài',
    steps: [
      'Cách nhanh nhất: kéo file .apk từ thư mục Windows thả vào màn hình điện thoại. App được cài với tùy chọn mặc định.',
      'Hoặc bấm nút Cài APK (bên trái màn hình) → "Chọn APK…" hoặc kéo file vào ô → chọn tùy chọn → "Cài đặt".',
      'Kết quả hiện ở mục "Gần đây" (đã cài / thất bại kèm lý do).'
    ],
    buttons: [
      ['Ghi đè app đang có (-r)', 'Cập nhật app mà giữ dữ liệu (đăng nhập, cài đặt). Bỏ tick nếu muốn báo lỗi khi app đã có.'],
      ['Cho phép hạ phiên bản (-d)', 'Cài bản cũ hơn bản đang có (chỉ được với app debug).'],
      ['Cấp sẵn mọi quyền runtime (-g)', 'Không hiện hộp thoại xin quyền — dùng khi không test luồng xin quyền.'],
      ['Cho phép APK chỉ để test (-t)', 'Cần cho APK build từ Android Studio (testOnly).']
    ],
    faq: [
      ['INSTALL_FAILED_UPDATE_INCOMPATIBLE', 'APK ký khác với app đang có (ví dụ bản Store vs bản debug). Gỡ app cũ trước (mất dữ liệu).'],
      ['INSTALL_FAILED_VERSION_DOWNGRADE', 'Bản cài cũ hơn bản đang có: tick "Cho phép hạ phiên bản" (chỉ app debug) hoặc gỡ app trước.'],
      ['Thả file khác (ảnh, pdf…)', 'Không phải APK thì được chép vào /sdcard/Download của điện thoại.']
    ],
    tour: [{ target: '.screen-box .side .iconbtn', panel: 'none', title: 'Cài APK', body: 'Bấm để mở bảng cài APK, hoặc kéo file .apk thả thẳng vào màn hình điện thoại.' }]
  },
  {
    id: 'wifi',
    group: 'Cơ bản',
    title: 'Điều khiển qua Wi-Fi (không cần cáp)',
    summary: 'Chuyển sang Wi-Fi, kết nối bằng ip:cổng, ghép đôi Android 11+',
    when: ['Cần test chức năng liên quan cổng USB / sạc.', 'Điện thoại ở xa máy tính.'],
    steps: [
      'Cách 1 (mọi Android): đang cắm cáp → bấm "Chuyển sang Wi-Fi" trên thanh công cụ → khi máy hiện thêm một dòng có biểu tượng Wi-Fi, rút cáp.',
      'Cách 2 (Android 11+): trên điện thoại Tùy chọn nhà phát triển › Gỡ lỗi không dây › "Ghép đôi thiết bị bằng mã" → trong ADB Kit bấm + → nhập ip:cổng-ghép-đôi và mã → Ghép đôi → rồi nhập ip:cổng hiển thị trên màn Gỡ lỗi không dây → Kết nối.',
      'Máy tính và điện thoại phải cùng mạng Wi-Fi.'
    ],
    faq: [
      ['Mất kết nối sau khi khởi động lại điện thoại', 'Bình thường: chế độ Wi-Fi (cách 1) mất khi điện thoại khởi động lại — cắm cáp và chuyển lại.'],
      ['Mirror giật qua Wi-Fi', 'Giảm độ phân giải / bitrate trong ⚙.'],
      ['Không dùng được "Ngắt mạng thật"', 'Đúng vậy: tắt Wi-Fi khi đang nối adb qua Wi-Fi sẽ mất kết nối, nên chức năng này chỉ cho dùng khi cắm cáp.']
    ],
    tour: [
      { target: { text: 'Chuyển sang Wi-Fi' }, title: 'Chuyển sang Wi-Fi', body: 'Bấm khi đang cắm cáp, rồi rút cáp — vẫn điều khiển được qua Wi-Fi.' },
      { target: '.topbar .pop-wrap', title: 'Kết nối bằng địa chỉ', body: 'Nút +: nhập ip:cổng hoặc ghép đôi bằng mã (Android 11+).' }
    ]
  },
  {
    id: 'files',
    group: 'Cơ bản',
    title: 'Tệp trên điện thoại',
    summary: 'Duyệt, tải lên, tải về, tạo thư mục, xóa',
    steps: [
      'Mở tab Tệp. Chọn gốc: Bộ nhớ trong (/sdcard), Tải xuống, hoặc Gốc (/).',
      'Bấm mũi tên cạnh thư mục để mở. Bấm một dòng để chọn.',
      'Tải lên: chọn thư mục đích → "Tải lên" → chọn file trên máy tính. Hoặc kéo file từ Windows thả vào bảng Tệp (vào thư mục đang chọn).',
      'Tải về: chọn file / thư mục → "Tải về", hoặc nhấp đúp vào file.'
    ],
    buttons: [
      ['Tải lên', 'Chép file từ máy tính vào thư mục đang chọn trên điện thoại.'],
      ['Tải về', 'Chép file / thư mục đang chọn về máy tính.'],
      ['Thư mục mới', 'Tạo thư mục trong thư mục đang chọn (gõ tên rồi Enter).'],
      ['Xóa (đỏ)', 'Xóa file / thư mục đang chọn — có hỏi lại, không thể hoàn tác.'],
      ['Tải lại', 'Đọc lại nội dung thư mục.']
    ],
    faq: [['Không vào được /data', 'Dữ liệu riêng của app bị Android khóa. App bản debug: dùng tab Shell với lệnh "run-as <package>".']],
    tour: [
      { target: tool('files'), panel: 'files', title: 'Tệp', body: 'Duyệt bộ nhớ điện thoại; kéo file từ Windows thả vào bảng để tải lên.' },
      { target: '.roots', panel: 'files', title: 'Chọn gốc', body: 'Bộ nhớ trong, Tải xuống, hoặc gốc hệ thống.' },
      { target: { text: 'Tải lên' }, panel: 'files', title: 'Tải lên / Tải về', body: 'Chọn thư mục rồi Tải lên; chọn file rồi Tải về (hoặc nhấp đúp vào file).' }
    ]
  },
  {
    id: 'logcat',
    group: 'Cơ bản',
    title: 'Logcat',
    summary: 'Log thời gian thực, lọc theo app, mức log, từ khóa',
    when: ['App crash / treo và cần biết lý do.', 'Dev nhờ "gửi log" khi tái hiện lỗi.'],
    steps: [
      'Mở tab Logcat. Chọn app ở ô "Lọc theo app…" để chỉ xem log của app đó (theo PID của app, kiểm tra lại mỗi 2 giây nên vẫn đúng khi app khởi động lại).',
      'Chọn mức log tối thiểu: Verbose < Debug < Info < Warn < Error < Fatal. Chọn Error để chỉ xem lỗi.',
      'Gõ từ khóa vào ô tìm (nội dung hoặc tag). Bật "Aa" để phân biệt hoa thường, ".*" để dùng biểu thức chính quy.',
      'Tái hiện lỗi trên điện thoại, đọc các dòng đỏ (E/F).'
    ],
    buttons: [
      ['Mức log', 'Lọc theo mức tối thiểu.'],
      ['Aa', 'Phân biệt chữ hoa / chữ thường khi tìm.'],
      ['.*', 'Tìm bằng regex, ví dụ: Exception|ANR.'],
      ['Tạm dừng / Tiếp tục', 'Dừng cập nhật để đọc; log mới trong lúc dừng bị bỏ qua.'],
      ['Xóa (cục tẩy)', 'Xóa log trên thiết bị — dùng ngay trước khi tái hiện lỗi để log gọn.'],
      ['Tự cuộn', 'Luôn nhảy tới dòng mới nhất.']
    ],
    example: {
      title: 'Tìm lý do app bị crash',
      steps: ['Chọn app ở "Lọc theo app…", mức Error.', 'Bấm Xóa (cục tẩy).', 'Tái hiện thao tác làm crash.', 'Tìm dòng "FATAL EXCEPTION" màu đỏ — vài dòng ngay dưới là tên lỗi và vị trí trong code.', 'Hoặc bấm F8 để Báo lỗi: crash được đính kèm tự động.']
    },
    tour: [
      { target: tool('logcat'), panel: 'logcat', title: 'Logcat', body: 'Log thời gian thực của điện thoại.' },
      { target: '.log-tools', panel: 'logcat', title: 'Bộ lọc', body: 'Mức log, ô tìm (Aa = phân biệt hoa thường, .* = regex), lọc theo app, tạm dừng, xóa, tự cuộn.' }
    ]
  },
  {
    id: 'shell',
    group: 'Cơ bản',
    title: 'Shell (dòng lệnh)',
    summary: 'adb shell đầy đủ ngay trong app',
    steps: ['Mở tab Shell, gõ lệnh như trong terminal của điện thoại.'],
    example: {
      title: 'Vài lệnh hay dùng',
      steps: [
        'pm list packages | grep tammi — tìm tên package.',
        'dumpsys package <package> | grep version — xem phiên bản app.',
        'am force-stop <package> — tắt hẳn app.',
        'pm clear <package> — xóa sạch dữ liệu app (như mới cài).',
        'run-as <package> ls files — xem dữ liệu app (chỉ bản debug).'
      ]
    },
    tour: [{ target: tool('shell'), panel: 'shell', title: 'Shell', body: 'Dòng lệnh adb shell của điện thoại.' }]
  },

  /* ================================================================ Kiểm thử */
  {
    id: 'net',
    group: 'Kiểm thử',
    title: 'Mạng / API',
    summary: 'Xem mọi request của app; giả lập lỗi, 500, chậm',
    when: ['Màn hình hiện sai dữ liệu — cần biết API trả về gì.', 'Muốn xem app xử lý ra sao khi server lỗi / chậm.', 'Dev hỏi "request gửi đi body gì".'],
    steps: [
      'Mở tab Mạng / API, chọn app. Danh sách lời gọi hiện theo thời gian thực.',
      'Bấm "Tải lại app" để bắt cả các API gọi lúc mở app.',
      'Bấm một dòng để xem chi tiết: URL, header, body gửi đi, body nhận về (JSON được trình bày đẹp).',
      'Lọc: chọn HTTP / Lệnh, gõ vào ô lọc URL, bấm "Lỗi" để chỉ xem lời gọi lỗi.'
    ],
    buttons: [
      ['HTTP', 'Request của WebView (fetch / XHR).'],
      ['HTTP·App', 'Request của app native, đọc từ Chucker (app phải có Chucker).'],
      ['HTTP·Bridge', 'API miniapp gọi qua native (WVFetch) — không đi qua mạng của WebView.'],
      ['Bridge / Sự kiện', 'Lệnh miniapp gọi sang native (JSAPI) / native báo cho miniapp.'],
      ['Lệnh', 'Lệnh Tauri (JS → Rust).'],
      ['Tạo bước kiểm tra', 'Thêm bước "Kiểm tra API này được gọi" vào kịch bản tự động.'],
      ['Giả lập lỗi / 500 / chậm', 'Từ giờ các lời gọi giống thế này bị lỗi mạng / trả 500 / chậm 5 giây. Dòng bị ảnh hưởng có nhãn GIẢ. Hộp vàng phía trên liệt kê các giả lập đang bật, "Bỏ hết" để gỡ.'],
      ['Tạm dừng / Xóa', 'Dừng nhận lời gọi mới / xóa danh sách.']
    ],
    example: {
      title: 'Kiểm tra app khi server lỗi 500',
      steps: ['Chọn app, thao tác tới màn cần test để thấy API của màn đó.', 'Bấm vào dòng API đó → "Giả lập 500".', 'Thao tác lại trên điện thoại: app phải hiện thông báo lỗi thân thiện, không trắng màn hay crash.', 'Xong bấm "Bỏ hết" trong hộp vàng.']
    },
    faq: [
      ['"Không thấy cổng DevTools của WebView, app cũng không có Chucker"', 'App là bản release, hoặc app native không gắn Chucker. Xin dev bản debug/staging.'],
      ['Danh sách trống', 'Thao tác trên app để có lời gọi, hoặc bấm "Tải lại app".']
    ],
    tour: [
      { target: tool('net'), panel: 'net', title: 'Mạng / API', body: 'Theo dõi mọi request của app đang chọn theo thời gian thực.' },
      { target: '.log-tools', panel: 'net', title: 'Chọn app & lọc', body: 'Chọn app, Tải lại app để bắt API lúc khởi động, lọc theo loại / URL / chỉ lỗi.' },
      { target: '.net-body', panel: 'net', title: 'Danh sách lời gọi', body: 'Bấm một dòng để xem header, body; ở khung chi tiết có Tạo bước kiểm tra và các nút Giả lập.' }
    ]
  },
  {
    id: 'netsim',
    group: 'Kiểm thử',
    title: 'Giả lập mạng xấu & mất mạng',
    summary: 'Chậm, chập chờn, mất mạng cho app; ngắt mạng thật cả máy',
    when: ['Test màn hình chờ (loading), nút thử lại, thông báo mất mạng.', 'Kiểm tra app không bị treo / crash khi mạng yếu.'],
    steps: [
      'Mở tab Mạng / API và chọn app (đang theo dõi).',
      'Ở dòng "Giả lập mạng cho app" chọn: Chậm (mỗi API trễ ~2,5 giây), Chập chờn (30% API lỗi, còn lại trễ ngẫu nhiên tới 3 giây), Mất mạng (mọi API lỗi).',
      'Thao tác trên app và quan sát. Chọn "Bình thường" để tắt.',
      'Cần mất mạng thật (cả app native, cả ảnh / video): chọn số giây → "Ngắt mạng". Wi-Fi và dữ liệu di động tắt rồi tự bật lại.'
    ],
    tips: [
      'Giả lập cho app chỉ ảnh hưởng API, không ảnh hưởng file giao diện của trang — trang vẫn mở được.',
      'Giả lập tự hết sau 15 phút và tắt khi ngừng theo dõi.',
      '"Ngắt mạng" chạy lệnh bật lại ngay trên điện thoại: kể cả khi tắt ADB Kit, mạng vẫn tự về. Chỉ dùng được khi cắm cáp USB.'
    ],
    tour: [
      { target: '.net-sim select', panel: 'net', title: 'Giả lập mạng cho app', body: 'Chọn Chậm, Chập chờn hoặc Mất mạng — áp cho mọi API của app (WebView, miniapp, Tauri).' },
      { target: { text: 'Ngắt mạng', within: '.net-sim' }, panel: 'net', title: 'Mất mạng thật', body: 'Tắt Wi-Fi + dữ liệu di động của cả máy trong số giây đã chọn rồi tự bật lại — áp cho cả app native.' }
    ]
  },
  {
    id: 'perm',
    group: 'Kiểm thử',
    title: 'Quyền của app',
    summary: 'Bật / tắt quyền, quyền đặc biệt, đưa app về như mới cài',
    when: ['Test luồng "người dùng từ chối quyền máy ảnh / vị trí".', 'Test lần đầu mở app (hộp thoại xin quyền).'],
    steps: [
      'Mở tab Quyền, chọn app.',
      'Nhóm "Quyền cần người dùng cho phép": bật / tắt bằng công tắc. Chữ "dùng … trước" = lần cuối app dùng quyền đó.',
      'Nhóm "Quyền đặc biệt" (hiển thị trên app khác, báo thức chính xác…): chọn cho phép / chặn / từ chối / mặc định.',
      'Nhóm "Quyền tự cấp khi cài đặt": chỉ xem, không đổi được.'
    ],
    buttons: [
      ['Thu hồi tất cả', 'Thu hồi mọi quyền runtime — app như mới cài, lần mở sau sẽ xin quyền lại. Android sẽ tắt app.'],
      ['Cài đặt app', 'Mở trang Thông tin ứng dụng trên điện thoại.'],
      ['Thêm vào kịch bản (biểu tượng danh sách)', 'Thêm bước kiểm tra trạng thái quyền này vào kịch bản tự động.']
    ],
    faq: [['Công tắc bị mờ', 'Quyền do hệ thống / chính sách cố định, không đổi được.']],
    tour: [
      { target: tool('perm'), panel: 'perm', title: 'Quyền', body: 'Chọn app để bật/tắt từng quyền.' },
      { target: { text: 'Thu hồi tất cả' }, panel: 'perm', title: 'Như mới cài', body: 'Thu hồi mọi quyền để test lại luồng xin quyền lần đầu.' }
    ]
  },
  {
    id: 'auto',
    group: 'Kiểm thử',
    title: 'Tự động test: kịch bản',
    summary: 'Ghi thao tác, soi phần tử, thêm bước kiểm tra, chạy, báo cáo',
    when: ['Một luồng phải test lại sau mỗi bản build (đăng nhập, thanh toán…).', 'Cần chạy lặp nhiều lần để bắt lỗi thỉnh thoảng mới xảy ra.'],
    steps: [
      'Mở tab Tự động test › Kịch bản. Chọn app cần test ở ô đầu.',
      'Bấm "Ghi thao tác" (chấm đỏ). Dùng điện thoại bên trái: mỗi chạm, vuốt, cuộn, gõ chữ, Back/Home thành một bước. Chờ dòng "✓ Sẵn sàng" trước mỗi lần chạm để bước được gắn với phần tử (không chỉ toạ độ).',
      'Bấm "Dừng ghi". Thêm bước kiểm tra: "Soi phần tử" → bấm lên chữ / nút trên điện thoại → chọn "+ Kiểm tra có hiển thị", "+ Kiểm tra không hiển thị", "+ Chờ xuất hiện", "+ Bấm" hoặc "+ Nếu thấy thì bấm".',
      'Thêm bước khác bằng "+ Thêm bước…" (mở app, chờ, chụp, so sánh ảnh, kiểm tra API, quyền, mạng…).',
      'Lưu kịch bản (biểu tượng đĩa) thành file .json.',
      'Bấm "Chạy". Theo dõi từng bước xanh / đỏ. Xong sẽ có báo cáo HTML.'
    ],
    buttons: [
      ['Ghi thao tác', 'Ghi thao tác tay thành các bước.'],
      ['Soi phần tử', 'Bấm lên phần tử trên điện thoại để xem loại / id / chữ và cách app sẽ tìm nó, rồi thêm bước (+ Bấm, + Chờ xuất hiện, + Kiểm tra có / không hiển thị…). Alt + bấm để vẫn thao tác thật.'],
      ['Lên / Xuống / Nhân bản / Xóa', 'Ở cuối mỗi bước: đổi thứ tự, nhân đôi, xóa bước. Bấm vào một bước để chọn — bước mới được thêm sau bước đang chọn.'],
      ['Chạy / Dừng', 'Chạy kịch bản; trong lúc chạy thao tác tay bị khóa.'],
      ['Lượt', 'Chạy cả kịch bản bao nhiêu lần (bắt lỗi thỉnh thoảng).'],
      ['Tốc độ', 'Nhân thời gian các bước chờ đã ghi (chậm ×0.5 … rất nhanh ×4).'],
      ['KBKT', 'Nhập Mục đích kiểm thử / Kết quả mong muốn — dùng khi xuất file KBKT.'],
      ['Tìm lại phần tử khi bấm', 'Trước khi bấm, tìm lại phần tử theo chữ / id — chạy đúng dù giao diện xê dịch.'],
      ['Dừng khi crash/ANR, Dừng khi kiểm tra lỗi', 'Dừng ngay khi có lỗi thay vì chạy tiếp.'],
      ['Quay video', 'Quay màn hình suốt lần chạy, đính kèm vào báo cáo.'],
      ['Bắt lỗi WebView, Ghi API', 'Ghi lỗi JS và mọi request vào báo cáo (cần cho bước Kiểm tra API).'],
      ['Đo hiệu năng', 'Thời gian mở app, RAM / CPU mỗi 2 giây, tỉ lệ khung hình giật — có biểu đồ trong báo cáo.'],
      ['Cập nhật ảnh chuẩn', 'Bước "So sánh màn hình" lưu ảnh mới làm chuẩn (khi giao diện đổi có chủ đích).']
    ],
    example: {
      title: 'Kịch bản đăng nhập',
      steps: [
        '+ Thêm bước › "Mở app" (tick xóa dữ liệu nếu muốn như mới cài).',
        'Ghi thao tác: chạm ô số điện thoại, gõ số, bấm "Đăng nhập với OTP"… Dừng ghi.',
        'Soi phần tử: bấm lên chữ "Trang chủ" → "+ Chờ xuất hiện" (đăng nhập thành công).',
        'Lưu, Chạy 5 lượt, bật Quay video + Ghi API.',
        'Nếu lỗi: báo cáo có ảnh lúc lỗi, video, log, API và nội dung lỗi để dán vào ticket.'
      ]
    },
    faq: [
      ['Bước "Bấm" bấm trượt khi chạy lại', 'Bật "Tìm lại phần tử khi bấm"; khi ghi, chờ "✓ Sẵn sàng" rồi mới chạm.'],
      ['Có popup quảng cáo / đánh giá lúc có lúc không', 'Thêm bước "Nếu thấy chữ thì bấm (popup…)".'],
      ['Mỗi lần chạy dữ liệu khác nhau', 'Dùng Bộ test với file CSV để chạy cùng kịch bản với nhiều bộ dữ liệu.']
    ],
    tour: [
      { target: tool('auto'), panel: 'auto', title: 'Tự động test', body: 'Ghi lại thao tác thành kịch bản và chạy lại bao nhiêu lần cũng được.' },
      { target: '.auto .seg', panel: 'auto', title: 'Kịch bản / Bộ test', body: 'Kịch bản = một luồng test. Bộ test = nhiều kịch bản, gắn với file KBKT.' },
      { target: '.auto-row', panel: 'auto', title: 'App cần test', body: 'Chọn app: crash, lỗi JS, API của app này sẽ được ghi lại khi chạy.' },
      { target: { text: 'Ghi thao tác' }, panel: 'auto', title: 'Ghi thao tác', body: 'Bấm rồi dùng điện thoại bên trái — mỗi thao tác thành một bước. Chờ "✓ Sẵn sàng" trước mỗi lần chạm.' },
      { target: { text: 'Soi phần tử' }, panel: 'auto', title: 'Soi phần tử', body: 'Bấm lên phần tử trên màn hình, rồi chọn + Kiểm tra có hiển thị / không hiển thị / Chờ xuất hiện / Bấm.' },
      { target: { text: 'Chạy' }, panel: 'auto', title: 'Chạy', body: 'Chạy kịch bản; chọn số Lượt và tốc độ bên phải.' },
      { target: '.auto-row.opts', panel: 'auto', title: 'Tùy chọn khi chạy', body: 'Quay video, bắt lỗi WebView, ghi API, đo hiệu năng… "+ Thêm bước…" ở cuối dòng.' },
      { target: '.steps', panel: 'auto', title: 'Danh sách bước', body: 'Bấm để chọn bước; Lên / Xuống / Nhân bản / Xóa ở cuối dòng. Khi chạy, bước xanh = đạt, đỏ = lỗi.' }
    ]
  },
  {
    id: 'steps',
    group: 'Kiểm thử',
    title: 'Các loại bước trong kịch bản',
    summary: 'Danh sách bước "+ Thêm bước…" và dùng khi nào',
    steps: ['Mở tab Tự động test › Kịch bản, chọn ở ô "+ Thêm bước…". Bước được thêm sau bước đang chọn.'],
    buttons: [
      ['Mở app / Tắt hẳn app', 'Khởi động app (có thể xóa dữ liệu trước) / force-stop.'],
      ['Chờ (ms) / Chờ chữ xuất hiện', 'Đợi cố định / đợi tới khi một chữ hiện ra (có giới hạn thời gian).'],
      ['Kiểm tra chữ có hiển thị', 'Bước kiểm tra: đạt nếu chữ có (hoặc không có) trên màn hình.'],
      ['Nếu thấy chữ thì bấm (popup…)', 'Bấm nếu có, bỏ qua nếu không — cho popup lúc có lúc không.'],
      ['Nhập chữ, Phím Back / Home / Enter / Đa nhiệm', 'Gõ chữ / bấm phím.'],
      ['Chụp màn hình', 'Thêm ảnh vào báo cáo.'],
      ['So sánh màn hình với ảnh chuẩn', 'Lần đầu lưu ảnh chuẩn; các lần sau báo lỗi nếu khác quá ngưỡng. Nút "Vùng bỏ qua" để khoanh vùng hay đổi (giờ, quảng cáo).'],
      ['Môi trường: tắt / bật Wi-Fi + 4G', 'Test offline trong kịch bản.'],
      ['Môi trường: cấp quyền, Thu hồi tất cả quyền, Đặt quyền đặc biệt, Kiểm tra quyền', 'Chuẩn bị và kiểm tra trạng thái quyền.'],
      ['Hiệu năng: … ≤ ngưỡng', 'Báo lỗi nếu thời gian mở app / RAM / CPU / tỉ lệ giật vượt ngưỡng.'],
      ['Giả lập: API lỗi / status / chậm, Bỏ mọi giả lập', 'Giả lập server xấu ngay trong kịch bản.'],
      ['Tải lại giao diện app (WebView)', 'Để giả lập có tác dụng ngay từ lúc trang khởi động.'],
      ['Kiểm tra API / lệnh được gọi, Kiểm tra KHÔNG gọi API', 'Đạt nếu API khớp được gọi (đúng status) / không được gọi. Cần bật "Ghi API".'],
      ['Mở deep link / URL', 'Vào thẳng một màn bằng link.'],
      ['Chờ mã OTP (SMS / thông báo) rồi điền', 'Đợi mã mới trong thông báo (mã có từ trước khi chạy bị bỏ qua) rồi gõ vào ô đang chọn. Đặt sau bước chạm vào ô nhập mã.'],
      ['Lệnh adb shell', 'Lệnh tùy ý.']
    ]
  },
  {
    id: 'suite',
    group: 'Kiểm thử',
    title: 'Bộ test & file KBKT',
    summary: 'Gom kịch bản, nhập testcase từ KBKT, ghi kết quả, chạy lại khi lỗi',
    when: ['Chạy cả bộ testcase hồi quy trước khi release.', 'Đánh kết quả test vào file KBKT (mẫu BES / BCCS).'],
    steps: [
      'Tab Tự động test › Bộ test. Điền Tên bộ test, Mã TC, Người lập, Người test (ghi vào file KBKT).',
      'Cách 1: "Thêm kịch bản…" chọn các file .json đã lưu — mỗi kịch bản là một testcase.',
      'Cách 2: "Nhập testcase từ file KBKT…" chọn file Excel tester đã viết. Mỗi dòng: gắn kịch bản tự động, hoặc đánh kết quả test tay (P / F / PE).',
      'Gắn file CSV vào một kịch bản để chạy nó với nhiều bộ dữ liệu (dùng ${tên_cột} trong các bước).',
      'Bấm "Chạy bộ test". Kết quả ghi vào một bản sao của file KBKT trong thư mục báo cáo (file gốc không đổi).'
    ],
    buttons: [
      ['Chạy lại khi lỗi', 'Testcase lỗi chạy lại 1–2 lần; kết quả vào cột KQ lần 2 / lần 3.'],
      ['Mẫu KBKT', 'BES, BCCS, hoặc file mẫu riêng cho file xuất ra.'],
      ['Tắt hẳn app trước mỗi testcase', 'Testcase không phụ thuộc màn hình testcase trước để lại.'],
      ['Ghi kết quả test tay', 'Ghi ngay kết quả test tay vào bản sao file KBKT mà không chạy gì.'],
      ['Nhập lại', 'Đọc lại file KBKT, giữ các liên kết / kết quả đã đánh.']
    ],
    tips: ['Chạy hằng đêm không cần mở cửa sổ: "ADB Kit.exe" --run "đường-dẫn\\bo-test.json" [--serial máy] [--out thư-mục]. Mã thoát 0 = đạt, 1 = có lỗi.'],
    tour: [
      { target: { text: 'Bộ test', within: '.auto .seg' }, panel: 'auto', title: 'Bộ test', body: 'Bấm để chuyển sang Bộ test (gom nhiều kịch bản, xuất KBKT).' }
    ]
  },

  /* ============================================== Super app & giao diện */
  {
    id: 'figma',
    group: 'Super app & giao diện',
    title: 'So với Figma',
    summary: 'Đo kích thước, khoảng cách (dp) của phần tử so với thiết kế',
    when: ['Kiểm tra màn hình làm có đúng thiết kế không (lề, khoảng cách, kích thước).', 'Designer nói "nút này phải cách 16dp" — đo nhanh trên máy thật.'],
    steps: [
      'Lần đầu: bấm biểu tượng chìa khóa, dán Figma Personal Access Token (Figma › Settings › Security › Personal access tokens, quyền "File content: Read-only"). Token được mã hóa trên máy này.',
      'Trong Figma, chuột phải vào trang / frame › Copy link. Dán vào ô link trong ADB Kit → Mở (lần đầu với trang lớn có thể mất ~1 phút).',
      'Mở cùng màn hình đó trên điện thoại. Chọn frame trong danh sách, hoặc bấm "Tìm màn giống" để app tự gợi ý.',
      'Bật "Theo dõi" rồi bấm vào phần tử trên điện thoại: bấm lúc này chỉ để đo, không vào app. Alt + bấm để thao tác thật. Frame tự đổi khi màn hình điện thoại đổi.',
      'Đọc bảng bên phải. Ô lệch quá sai số (±, mặc định 2 dp) tô đỏ.'
    ],
    buttons: [
      ['Mở', 'Tải trang / frame Figma theo link.'],
      ['Tải lại (mũi tên vòng)', 'Lấy thiết kế mới nhất (khi designer vừa sửa).'],
      ['Chìa khóa', 'Đổi Figma token.'],
      ['Trang › Lọc màn › Frame', 'Chọn trang trong file, gõ để lọc, chọn frame (nhóm theo section).'],
      ['Tìm màn giống', 'Đọc chữ trên điện thoại, chọn frame có nhiều chữ trùng nhất.'],
      ['Theo dõi', 'Bấm lên điện thoại để đo; chấm màu = trạng thái đọc màn hình.'],
      ['± dp', 'Sai số cho phép.'],
      ['Thanh kéo giữa ảnh Figma và bảng số đo', 'Đổi độ rộng; bấm đúp để về mặc định.']
    ],
    example: {
      title: 'Đo nút "Đăng nhập"',
      steps: ['Mở màn đăng nhập trên máy, mở frame Login trong Figma.', 'Bật Theo dõi, bấm vào nút Đăng nhập trên điện thoại.', 'Phần tử được tô vàng trên máy, node tương ứng nhấp nháy hồng trên ảnh Figma.', 'Bảng cho biết: cao 48 vs 52 dp (lệch 4 → đỏ), lề trái 16 vs 16 (khớp).']
    },
    faq: [
      ['Ghép nhầm node', 'Bấm thẳng vào node đúng trên ảnh Figma để chọn tay.'],
      ['Chiều rộng lệch nhưng ghi "giãn theo màn"', 'Thiết kế vẽ trên khung iPhone, máy thật rộng khác: hai mép trái/phải vẫn khớp nên không phải lỗi.'],
      ['Figma báo 403 / 404', 'Token sai / hết hạn, hoặc tài khoản không có quyền xem file.']
    ],
    tour: [
      { target: tool('figma'), panel: 'figma', title: 'So với Figma', body: 'So phần tử trên máy thật với thiết kế Figma, theo dp.' },
      { target: '.fg-url', panel: 'figma', title: 'Link Figma', body: 'Dán link trang hoặc frame Figma rồi Enter / Mở. Chìa khóa bên phải để đổi token.' },
      { target: '.fg-bar', panel: 'figma', title: 'Chọn frame', body: 'Chọn trang › frame, hoặc "Tìm màn giống".' },
      { target: '.fg-follow', panel: 'figma', title: 'Theo dõi', body: 'Bật rồi bấm vào phần tử trên điện thoại để đo (Alt + bấm = thao tác thật).' },
      { target: '.fg-info', panel: 'figma', title: 'Bảng số đo', body: 'Kích thước, lề trong cha, khoảng cách tới phần tử bên cạnh, mép màn hình — ô đỏ là lệch quá sai số.' }
    ]
  },
  {
    id: 'mini',
    group: 'Super app & giao diện',
    title: 'Miniapp: WebView, DevTools, danh sách',
    summary: 'Soi trang WebView, mở Chrome DevTools, mở / xóa cache miniapp',
    when: ['Miniapp hiện sai, cần xem DOM / console / lỗi JS.', 'Cần vào thẳng một miniapp không phải bấm 5 màn.', 'Miniapp không lên bản mới — muốn tải lại gói.'],
    steps: [
      'Mở tab Miniapp, chọn super app (bản debug / staging).',
      '"WebView đang mở": mỗi trang đang chạy; chấm xanh = đang hiển thị trên màn hình. Bấm "DevTools" để mở Chrome DevTools cho trang đó (Elements, Console, Network, Sources, Application…).',
      '"Miniapp đã tải về máy": tên, appId, phiên bản, dung lượng, lần cập nhật.',
      'Nhập mẫu deep link (Tammi điền sẵn tammi://miniapp?appId={appId}). Bấm "Mở" ở một dòng để vào thẳng miniapp đó.',
      'Nút cục tẩy = xóa gói đã tải (app bị đóng, lần mở sau tải bản mới nhất).'
    ],
    buttons: [
      ['Chỉ app đã chọn', 'Bỏ tick để thấy WebView của mọi app, kể cả Chrome.'],
      ['DevTools', 'Chrome DevTools đầy đủ cho trang, trong cửa sổ riêng, không cần internet.'],
      ['Deep link mở miniapp', 'Dùng {appId}, {miniAppId}, {name}. Được nhớ theo từng super app.'],
      ['Mở link nhanh', 'Lưu deep link / URL hay dùng: ▶ để mở, ⏱ để đo thời gian mở.'],
      ['Theo dõi API & bridge', 'Chuyển sang tab Mạng / API cho super app này.']
    ],
    faq: [
      ['"App này chưa mở WebView nào có thể soi"', 'Mở một miniapp trên máy, chờ vài giây. Bản release thường tắt debug WebView.'],
      ['"App không phải bản debug — không đọc được dữ liệu miniapp"', 'Danh sách miniapp cần bản debug (run-as). DevTools vẫn dùng được nếu WebView bật debug.'],
      ['Bấm Mở không vào miniapp', 'Super app chưa đăng nhập, hoặc mẫu deep link sai — hỏi dev scheme đúng.']
    ],
    tour: [
      { target: tool('mini'), panel: 'mini', title: 'Miniapp', body: 'Công cụ cho super app có miniapp chạy trên WebView.' },
      { target: '.mini-sec:nth-of-type(1)', panel: 'mini', title: 'WebView đang mở', body: 'Các trang WebView có thể soi; bấm DevTools để mở Chrome DevTools cho trang.' },
      { target: '.mini-tpl', panel: 'mini', title: 'Mẫu deep link', body: 'Mẫu link để mở thẳng một miniapp; {appId} được thay bằng appId của từng dòng.' },
      { target: '.mini-sec:nth-of-type(2)', panel: 'mini', title: 'Miniapp đã tải', body: '▶ Mở thẳng, ⏱ đo thời gian mở, cục tẩy xóa gói đã tải.' },
      { target: { text: 'Theo dõi API' }, panel: 'mini', title: 'API & bridge', body: 'Xem API và lệnh bridge của miniapp ở tab Mạng / API.' }
    ]
  },
  {
    id: 'minitime',
    group: 'Super app & giao diện',
    title: 'Đo thời gian mở miniapp',
    summary: 'Container, HTML, dựng trang, tải xong, mạng yên — so sánh các bản',
    when: ['Người dùng phàn nàn miniapp mở chậm.', 'So sánh trước / sau khi tối ưu, hoặc giữa hai phiên bản miniapp.'],
    steps: [
      'Tab Miniapp. Cần mẫu deep link (xem mục Miniapp).',
      'Bấm ⏱ ở dòng miniapp. App mở miniapp bằng link, chờ trang tải xong và mạng yên (tối đa ~60 giây).',
      'Tick "Như lần đầu" để đo như mở lần đầu sau khi cài / cập nhật (xóa gói, mở lại app — số liệu gồm cả thời gian tải gói).',
      'Kết quả: biểu đồ thanh từng giai đoạn + bảng lịch sử. Bấm một dòng lịch sử để xem lại biểu đồ.'
    ],
    buttons: [
      ['Container + WebView', 'Từ lúc mở link đến khi trang bắt đầu tải: app xử lý link, tải / giải nén gói, tạo WebView. Dài ở lần đầu là bình thường.'],
      ['Tải HTML', 'Nhận xong file HTML.'],
      ['Dựng trang (DOM)', 'Chạy script, DOM sẵn sàng.'],
      ['Tải tài nguyên (load)', 'Ảnh, font, script còn lại.'],
      ['Đến khi mạng yên', 'Request cuối cùng xong — gần với lúc người dùng thấy đủ nội dung.'],
      ['FCP / LCP', 'Lần đầu hiện nội dung / nội dung chính hiện ra (khi trình duyệt ghi được).'],
      ['Chậm nhất', '5 tài nguyên tốn thời gian nhất — gợi ý chỗ cần tối ưu.']
    ],
    tips: ['Đo 3 lần và lấy số ở giữa: lần đo có thể dao động do mạng.', 'API gọi qua bridge (WVFetch) không tính vào "Tài nguyên" — xem ở tab Mạng / API.'],
    tour: [{ target: '.mini-sec:nth-of-type(3)', panel: 'mini', title: 'Thời gian mở miniapp', body: 'Kết quả đo và lịch sử; tick "Như lần đầu" để đo cả lúc tải gói.' }]
  },
  {
    id: 'check',
    group: 'Super app & giao diện',
    title: 'Soát UI & đổi cấu hình máy',
    summary: 'Chế độ tối, cỡ chữ, kích thước hiển thị; tự tìm lỗi giao diện',
    when: ['Kiểm tra app với người dùng để chữ to / chế độ tối.', 'Soát nhanh lỗi giao diện trước khi báo cáo.'],
    steps: [
      'Mở tab Soát UI.',
      'Cấu hình máy: bấm để đổi ngay. Khi có thay đổi, nút "Khôi phục (N)" hiện ra.',
      'Mở màn cần kiểm tra trên điện thoại → bấm "Soát". Danh sách vấn đề hiện ra, lỗi nặng chấm đỏ.',
      'Rê chuột / bấm vào từng mục để khoanh phần tử trên màn hình điện thoại.',
      'Bấm các nhãn phía trên danh sách để lọc theo loại.',
      'Test xong bấm "Khôi phục" để máy về như cũ.'
    ],
    buttons: [
      ['Chế độ tối', 'Sáng / Tối. Máy Samsung khóa thiết lập này: app mở trang Cài đặt để bạn bật tay.'],
      ['Cỡ chữ', '0.85× – 2×. Người lớn tuổi hay để 1.3× trở lên.'],
      ['Kích thước hiển thị', 'Thu nhỏ / phóng to toàn bộ giao diện.'],
      ['Hiệu ứng chuyển động', 'Tắt để test tự động ổn định và nhanh hơn.'],
      ['Hiện viền layout', 'Vẽ khung mọi phần tử (công cụ dev Android) — thấy rõ lề, căn chỉnh.'],
      ['Hiện điểm chạm', 'Vòng tròn ở chỗ chạm — hữu ích khi quay video.'],
      ['Bố cục phải-sang-trái', 'Lật bố cục như tiếng Ả Rập (mở lại app để thấy) — tìm lề căn cứng, mũi tên sai chiều.'],
      ['Ngôn ngữ của app', 'Android 13+: đổi riêng ngôn ngữ một app (Tiếng Việt / English / chữ dài giả en-XA / phải-sang-trái giả ar-XB) để tìm chữ bị cắt và chữ quên dịch.'],
      ['Vị trí GPS giả lập', 'Android 12+. "Đặt 1 điểm": kéo / cuộn bản đồ, bấm vào chỗ muốn đặt, rồi "Đặt vị trí ở đây". "Đi từ A → B": bấm điểm A rồi điểm B trên bản đồ, nhập số giây (app tính luôn tốc độ km/h) → "Bắt đầu đi"; chấm xanh chạy theo vị trí của điện thoại. Có ô tìm địa chỉ, ô dán tọa độ "vĩ độ, kinh độ" từ Google Maps, và các địa điểm có sẵn. "Tắt giả lập" để về GPS thật; tự tắt khi đóng ADB Kit.'],
      ['Thử chữ to 1.3× + soát', 'Đặt cỡ chữ 1.3× rồi soát luôn.'],
      ['Vùng bấm nhỏ', 'Nhỏ hơn 48×48 dp (dưới 32 dp = lỗi nặng) — khó bấm.'],
      ['Thiếu nhãn', 'Nút bấm được nhưng không có chữ / mô tả — TalkBack không đọc được.'],
      ['Đè / chồng nhau', 'Chữ đè lên chữ, hoặc hai vùng bấm chồng nhau.'],
      ['Chữ bị cắt / tràn', 'Có "…", hoặc chữ vượt ra ngoài khung chứa.'],
      ['Tương phản thấp', 'Màu chữ quá gần màu nền (chuẩn WCAG: ≥ 4.5:1, chữ lớn ≥ 3:1).']
    ],
    faq: [
      ['"Màn hình đang là giao diện hệ thống"', 'Đang ở màn khóa / thanh thông báo — mở app rồi soát lại.'],
      ['Báo lỗi nhưng nhìn thấy ổn', 'Đây là kiểm tra tự động theo kinh nghiệm; xem lại bằng mắt trước khi báo lỗi.'],
      ['Quên khôi phục rồi tắt app', 'Mở lại ADB Kit, tab Soát UI vẫn còn nút Khôi phục (giá trị gốc được lưu theo từng máy).']
    ],
    tour: [
      { target: tool('check'), panel: 'check', title: 'Soát UI', body: 'Đổi cấu hình máy và tự tìm lỗi giao diện trên màn đang mở.' },
      { target: '.ck-grid', panel: 'check', title: 'Cấu hình máy', body: 'Bấm để đổi ngay; nút Khôi phục xuất hiện khi có thay đổi.' },
      { target: { text: 'Thử chữ to' }, panel: 'check', title: 'Chữ to + soát', body: 'Cách nhanh nhất để thấy giao diện vỡ khi người dùng để chữ to.' },
      { target: { text: 'Soát', within: '.ck-panel' }, panel: 'check', title: 'Soát màn hình', body: 'Đọc màn hình đang mở và liệt kê lỗi; rê chuột vào từng mục để khoanh trên điện thoại.' }
    ]
  },

  {
    id: 'data',
    group: 'Kiểm thử',
    title: 'OTP & tài khoản test',
    summary: 'Tự lấy mã OTP từ thông báo, điền một chạm; lưu tài khoản test',
    when: ['Đăng nhập bằng OTP nhiều lần mỗi ngày.', 'Tự động hóa luồng đăng nhập có OTP.'],
    steps: [
      'Mở tab Dữ liệu › "OTP & tài khoản test".',
      'Bấm "Chờ mã OTP" TRƯỚC khi bấm "Gửi mã" trong app. Thông báo đã có từ trước bị bỏ qua, nên không bao giờ điền nhầm mã cũ.',
      'Khi tin nhắn / thông báo có mã tới, mã hiện ở đây (to, màu xanh). Chạm vào ô nhập mã trên điện thoại, rồi bấm "Điền". Hoặc bật "Tự điền" để mã được gõ ngay khi tới.',
      'Tài khoản test: nhập tên gợi nhớ, số điện thoại / tài khoản, mật khẩu, ghi chú → Thêm. Sau đó chạm ô trên điện thoại rồi bấm "Điền tài khoản" / "Điền mật khẩu".',
      'Trong kịch bản tự động: thêm bước "Chờ mã OTP (SMS / thông báo) rồi điền" ngay sau bước chạm vào ô nhập mã.'
    ],
    tips: [
      'Chỉ lấy mã số (4–8 chữ số đứng gần chữ OTP / mã / code / xác thực), không lưu nội dung tin nhắn.',
      'Không thấy mã: kiểm tra điện thoại có hiện thông báo tin nhắn không (một số máy ẩn nội dung thông báo trên màn khóa — mở khóa máy).',
      'Mật khẩu tài khoản test lưu dạng thường trên máy tính này — chỉ dùng tài khoản test.'
    ],
    tour: [
      { target: tool('data'), panel: 'data', title: 'Dữ liệu', body: 'OTP & tài khoản test, và xem / sửa dữ liệu của app bản debug.' },
      { target: { text: 'Chờ mã OTP' }, panel: 'data', title: 'Chờ mã OTP', body: 'Bấm trước khi app gửi mã; mã mới sẽ hiện ra để điền một chạm.' }
    ]
  },
  {
    id: 'appdata',
    group: 'Kiểm thử',
    title: 'Xem & sửa dữ liệu app',
    summary: 'SharedPreferences (sửa được), database SQLite, MMKV — bản debug',
    when: ['Bật / tắt feature flag, đổi môi trường dev / staging mà không build lại app.', 'Xóa token để test hết phiên đăng nhập.', 'Kiểm tra app đã lưu đúng dữ liệu vào database chưa.'],
    steps: [
      'Tab Dữ liệu › "Dữ liệu app", chọn app (phải là bản debug).',
      'Bên trái là các file, chia nhóm SharedPreferences / Database / MMKV.',
      'SharedPreferences: sửa giá trị, đổi kiểu, thêm / xóa khóa → "Lưu (đóng app)". App bị đóng để ghi file; mở lại app để áp dụng.',
      'Database: bấm tên bảng để xem 200 dòng đầu, hoặc gõ câu SELECT rồi Ctrl + Enter. Đây là bản sao chỉ đọc.',
      'MMKV: xem khóa và giá trị (kiểu giá trị là đoán; file mã hóa thì không đọc được).'
    ],
    faq: [
      ['"App không phải bản debug"', 'Android chỉ cho đọc dữ liệu riêng của app debuggable (run-as). Xin dev bản debug / staging.'],
      ['Sửa xong mở app vẫn giá trị cũ', 'App có thể đọc từ server hoặc cache khác; kiểm tra lại khóa đúng file chưa.'],
      ['Muốn sửa database', 'Bản này chỉ xem database (an toàn). Dùng tab Shell với run-as + sqlite3 nếu thật cần.']
    ],
    tour: [{ target: { text: 'Dữ liệu app' }, panel: 'data', title: 'Dữ liệu app', body: 'Chọn app debug để xem prefs, database, MMKV.' }]
  },
  {
    id: 'explore',
    group: 'Kiểm thử',
    title: 'Tự khám phá app',
    summary: 'Không cần kịch bản: tự bấm khắp app, tìm crash và lỗi giao diện',
    when: ['Có bản build mới, muốn "quét" nhanh xem có crash không trước khi test kỹ.', 'Cần danh sách / ảnh tất cả các màn của app.'],
    steps: [
      'Mở khóa điện thoại (và tăng "Thời gian tắt màn hình" nếu chạy lâu). Nên đăng nhập sẵn bằng tài khoản test.',
      'Tab Tự động test › "Tự khám phá". Chọn app, số phút, thêm các chữ không được bấm (nếu có) → "Bắt đầu khám phá".',
      'ADB Kit tự: bấm lần lượt các nút chưa bấm trên mỗi màn (trên xuống dưới), cuộn thử một lần, rồi Back; tự đồng ý hộp thoại xin quyền; app crash thì ghi lại và mở lại app.',
      'Xong bấm "Mở báo cáo khám phá": số màn, thao tác, crash / ANR (kèm các bước tái hiện từ lúc mở app và stacktrace), lưới ảnh từng màn với "đến từ / dẫn tới" và các vấn đề giao diện tìm thấy.'
    ],
    tips: [
      'Không bao giờ bấm các nút có chữ như đăng xuất, xóa, thanh toán, mua, đặt hàng, chuyển tiền, nạp tiền, gọi… Ô nhập chữ không được điền.',
      'Chạy kèm "Thử chữ to 1.3×" (Soát UI) hoặc "Mạng chập chờn" (Mạng / API) để tìm thêm lỗi.',
      'Điện thoại tự khóa giữa chừng thì khám phá dừng lại và báo.'
    ],
    tour: [{ target: { text: 'Tự khám phá', within: '.auto .seg' }, panel: 'auto', title: 'Tự khám phá', body: 'Bấm để mở chế độ tự khám phá app.' }]
  },
  {
    id: 'replay',
    group: 'Kiểm thử',
    title: 'Ghi API rồi phát lại',
    summary: 'Cho app nhận lại đúng phản hồi đã ghi — test ổn định, không phụ thuộc server',
    when: ['Test tự động hay lỗi vì dữ liệu server thay đổi.', 'Cần màn hình với dữ liệu khó tạo (đơn 50 sản phẩm, số dư âm…).', 'Server staging đang chết mà vẫn cần test giao diện.'],
    steps: [
      'Tab Mạng / API, chọn app, dùng app bình thường để ghi các API (phản hồi được giữ tới 64 KB mỗi lời gọi).',
      '"Phát lại N": từ giờ app nhận đúng các phản hồi vừa ghi thay vì gọi server. Hoặc chọn một lời gọi → "Giữ phản hồi này" để chỉ cố định API đó.',
      '"Lưu bộ…": lưu thành file .mock.json (mở bằng Notepad để sửa body / status, ví dụ đổi số dư thành âm). "Mở bộ…" để phát lại file đã lưu.',
      'Trong kịch bản: bước "Giả lập: phát lại API đã ghi (file)" → chọn file .mock.json, rồi bước "Tải lại giao diện app" để áp dụng từ lúc khởi động.',
      'Hộp vàng "Đang giả lập…" liệt kê các API đang được phát lại; "Bỏ hết" để về server thật.'
    ],
    tips: ['Áp dụng cho API của WebView và miniapp (WVFetch). App native đọc qua Chucker thì chỉ xem được, không phát lại được.', 'Phản hồi bị cắt (quá 64 KB) hoặc nhị phân thì không phát lại.']
  },
  {
    id: 'links',
    group: 'Kiểm thử',
    title: 'Deep link & màn hình của app',
    summary: 'Mọi deep link và màn hình app khai báo — bấm là vào thẳng',
    steps: [
      'Tab Dữ liệu › "Deep link & màn hình", chọn app (không cần bản debug).',
      'Danh sách deep link (App Link = link https đã xác minh, Web = mở được từ trình duyệt, Intent = chỉ qua intent): sửa phần sau link (id, tham số) rồi "Mở". Nút + lưu vào "Mở link nhanh" (tab Miniapp).',
      'Danh sách màn hình (activity): "Mở" để vào thẳng — chỉ được với màn exported, các màn khác Android sẽ từ chối.'
    ]
  },
  {
    id: 'multi',
    group: 'Kiểm thử',
    title: 'Chạy trên nhiều máy & so sánh 2 lần chạy',
    summary: 'Một bộ test trên nhiều điện thoại cùng lúc; so bản cũ / bản mới',
    when: ['Kiểm tra trên nhiều đời Android / hãng máy trước khi release.', 'Bản build mới có làm hỏng gì không so với bản trước.'],
    steps: [
      'Cắm (hoặc kết nối Wi-Fi) nhiều điện thoại.',
      'Tab Tự động test › Bộ test › "Nhiều máy…" → tick các máy → "Chạy trên N máy". Máy đang hiển thị dùng mirror, các máy khác dùng adb input.',
      'Bảng tiến độ cho thấy từng máy đang chạy testcase nào, bao nhiêu đạt / lỗi. Xong bấm "Mở bảng tổng hợp": testcase × máy, dòng vàng = kết quả khác nhau giữa các máy.',
      'So sánh 2 lần chạy: cuối tab Tự động test bấm "So sánh 2 lần chạy…" → chọn thư mục báo cáo lần trước, rồi lần này (cùng kịch bản).',
      'Trang so sánh: bước mới lỗi / đã hết lỗi / chậm hơn, hiệu năng (mở app, RAM, CPU, giật), API mới / không còn gọi / mới lỗi / chậm hơn, ảnh chụp cùng tên khác bao nhiêu % (kèm ảnh tô đỏ chỗ khác), lỗi JS mới.'
    ],
    tips: [
      'Chỉ so được báo cáo tạo từ bản ADB Kit này trở đi (có report.json).',
      'Đặt tên bước "Chụp màn hình" giống nhau ở hai lần chạy để so ảnh.',
      '"Xu hướng kết quả…" (cuối tab Tự động test): tỉ lệ đạt từng kịch bản 30 ngày, dải màu 20 lần gần nhất, và danh sách test "chập chờn" (lúc đạt lúc lỗi).',
      'Rò rỉ bộ nhớ: chạy kịch bản ≥ 4 lượt với "Đo hiệu năng" — nếu RAM cuối mỗi lượt cứ tăng mà không giảm, báo cáo có cảnh báo vàng "Có dấu hiệu rò rỉ bộ nhớ".'
    ]
  },

  /* ================================================================ Báo lỗi */
  {
    id: 'bug',
    group: 'Báo lỗi',
    title: 'Báo lỗi nhanh (F8)',
    summary: 'Một chạm: ảnh, video vừa rồi, log, API, thao tác',
    when: ['Đang test tay thì gặp lỗi — muốn lưu bằng chứng trước khi màn hình đổi.', 'Lỗi thỉnh thoảng mới xảy ra, khó tái hiện lại.'],
    steps: [
      'Thấy lỗi: bấm "Báo lỗi" hoặc phím F8 ngay. Ảnh màn hình, video 20–40 giây gần nhất, logcat, crash, cây giao diện, API và các thao tác vừa làm được lưu NGAY lúc bấm.',
      'Nhập tiêu đề, chọn mức độ, app (tự điền app đang mở), kết quả thực tế, kết quả mong muốn.',
      'Xem "Các bước tái hiện" (tự ghi từ thao tác trên màn mirror) để kiểm tra.',
      'Bấm "Tạo báo cáo" (Ctrl + Enter). Nội dung lỗi tự được sao chép.',
      'Dán vào Jira / Redmine / Teams; đính kèm file zip ("Mở thư mục (file zip)").'
    ],
    buttons: [
      ['Các nhãn dưới ảnh', 'Cho biết đã lưu được gì: video bao nhiêu giây, bao nhiêu thao tác, bao nhiêu API / lỗi, có crash không.'],
      ['Quay sẵn video', 'Luôn giữ 20–40 giây video gần nhất (tốn thêm ~4% một nhân CPU). Bỏ tick nếu máy tính yếu.'],
      ['Mở báo cáo', 'report.html: ảnh, video, thao tác, API, crash, logcat tô màu.'],
      ['Sao chép nội dung', 'Chép lại nội dung lỗi (Markdown).'],
      ['Hủy', 'Bỏ báo cáo — thư mục tạm bị xóa.']
    ],
    faq: [
      ['"Chưa có API (bật tab Mạng / API)"', 'Mở tab Mạng / API cho app TRƯỚC khi tái hiện lỗi, rồi F8.'],
      ['"Chưa có video (màn hình đứng yên)"', 'Màn hình không đổi trong lúc đó nên không có khung hình mới — ảnh chụp vẫn có.'],
      ['Các bước tái hiện chỉ có toạ độ "Bấm tại 50%, 45%"', 'Đúng: báo lỗi nhanh ghi vị trí bấm; xem video đính kèm để biết bấm vào đâu.']
    ],
    tour: [{ target: '[data-tour="bug"]', title: 'Báo lỗi', body: 'Bấm (hoặc F8) ngay khi thấy lỗi — bằng chứng được lưu trước khi màn hình kịp thay đổi.' }]
  },
  {
    id: 'crash',
    group: 'Báo lỗi',
    title: 'Tự bắt crash / ANR',
    summary: 'App crash hay treo là được báo ngay, kèm bằng chứng',
    steps: [
      'Không cần bật gì: khi điện thoại đang hiển thị trong ADB Kit, mọi crash (Java, native) và ANR (app treo) đều được phát hiện qua logcat.',
      'Ngay lúc đó ADB Kit chụp màn hình, giữ video 20–40 giây trước đó, log và crash; góc dưới bên phải hiện thông báo đỏ.',
      'Bấm "Tạo báo cáo lỗi": hộp thoại Báo lỗi mở với tiêu đề và mô tả (tên lỗi, vài dòng stacktrace) điền sẵn. Hoặc bấm X để bỏ qua.'
    ],
    tips: ['Trong lúc chạy test tự động, crash được ghi vào báo cáo của lần chạy thay vì hiện thông báo.', 'App crash liên tục: mỗi app chỉ báo một lần mỗi 30 giây.']
  },
  {
    id: 'record',
    group: 'Báo lỗi',
    title: 'Quay video màn hình',
    summary: 'Quay MP4 rõ nét bằng chính điện thoại',
    steps: [
      'Bấm nút máy quay (cột nút bên trái màn hình điện thoại). Góc trên màn hình hiện "● QUAY 0:12".',
      'Thao tác như bình thường. Bấm lại nút để dừng: video MP4 được lưu vào Videos › ADB Kit; bấm dòng thông báo dưới cùng để mở thư mục.'
    ],
    tips: ['Video quay bằng screenrecord của điện thoại (đúng độ phân giải máy); quá 3 phút sẽ được chia thành nhiều file.', 'Muốn video NGAY TRƯỚC lúc lỗi: dùng Báo lỗi (F8) — luôn có 20–40 giây gần nhất.'],
    tour: [{ target: '.screen-box .side .iconbtn:nth-child(3)', panel: 'none', title: 'Quay video', body: 'Bấm để bắt đầu / dừng quay màn hình.' }]
  },
  {
    id: 'jira',
    group: 'Báo lỗi',
    title: 'Tạo ticket Jira',
    summary: 'Tạo ticket kèm ảnh và zip ngay từ báo cáo lỗi',
    steps: [
      'Sau khi "Tạo báo cáo" trong hộp thoại Báo lỗi, phần Jira hiện bên dưới nội dung lỗi.',
      'Lần đầu: nhập Địa chỉ Jira (https://tenteam.atlassian.net), E-mail + API token (Jira Cloud: id.atlassian.com › Security › API tokens) — hoặc để trống e-mail và dùng Personal Access Token (Jira Server / Data Center), Mã dự án (ví dụ TAMMI).',
      'Bấm "Kiểm tra kết nối": hiện tên tài khoản, tên dự án và danh sách loại ticket để chọn. Bấm "Lưu".',
      'Bấm "Tạo ticket Jira". Xong bấm "Mở trên Jira" để xem.'
    ],
    buttons: [
      ['Đặt Priority theo mức độ lỗi', 'Nghiêm trọng → Highest, Cao → High, Trung bình → Medium, Thấp → Low. Dự án không cho đặt Priority thì ticket vẫn được tạo, chỉ không có Priority.'],
      ['Bánh răng', 'Đổi cấu hình Jira.']
    ],
    faq: [
      ['Lỗi 401', 'Sai e-mail hoặc token (token Cloud phải đi kèm đúng e-mail tài khoản).'],
      ['Lỗi 404', 'Sai địa chỉ Jira hoặc sai mã dự án.'],
      ['Đã tạo ticket nhưng không đính kèm được', 'File quá lớn hoặc dự án tắt đính kèm — đính kèm tay file zip trong thư mục báo cáo.']
    ],
    tips: ['Token được mã hóa bằng Windows và chỉ gửi tới địa chỉ Jira đã nhập.']
  }
]

export const SHORTCUTS: [string, string][] = [
  ['F8', 'Báo lỗi nhanh'],
  ['Chuột phải', 'Back'],
  ['Chuột giữa', 'Home'],
  ['Ctrl + V', 'Dán chữ từ máy tính vào điện thoại'],
  ['Alt + bấm', 'Thao tác thật khi đang Soi phần tử / Theo dõi Figma'],
  ['Ctrl + Enter', 'Tạo báo cáo trong hộp thoại Báo lỗi'],
  ['Shift + Lưu', 'Lưu kịch bản / bộ test thành file khác'],
  ['← → Enter', 'Lùi / tiếp trong "Chỉ cho tôi"'],
  ['Esc', 'Đóng hộp thoại / hướng dẫn']
]
