# ADB Kit (desktop)

Electron + TypeScript app để mirror, điều khiển và debug thiết bị Android qua ADB.

## Chạy

```bash
npm install
npm run dev        # chạy dev, có hot reload
npm run build      # build vào out/
npm start          # chạy bản build
npm run dist       # đóng gói installer Windows (electron-builder)
```

- Cần `adb`. App tự tìm theo thứ tự: `ADB_PATH`, `ANDROID_HOME`, `%LOCALAPPDATA%\Android\Sdk`, bản ADB Kit tự tải (trong thư mục dữ liệu app), rồi đến `PATH`. Nếu không tìm thấy, app hiện nút **"Tải adb từ Google"** (~8 MB, bản chính thức). Trên Windows, máy vẫn cần **driver USB** của hãng điện thoại.
- `npm run dist` tạo bộ cài `dist\ADB Kit Setup <version>.exe` (~124 MB, chưa ký số nên Windows SmartScreen sẽ cảnh báo lần đầu).
- Nếu tiến trình cha có đặt `ELECTRON_RUN_AS_NODE=1` (một số extension của VS Code làm vậy) thì phải bỏ biến này đi, nếu không Electron sẽ chạy như Node thuần.
- Muốn xem log debug của luồng mirror: đặt `ADBKIT_DEBUG=1`.

## Chức năng

- **Thiết bị:** tab cho từng máy (USB / Wi-Fi), kết nối và pair qua Wi-Fi (nút `+`), nút "Switch to Wi-Fi" (`adb tcpip 5555`).
- **Mirror và điều khiển:** dùng scrcpy-server 5.0.1, stream H.264, giải mã bằng WebCodecs (GPU).
  - Chuột trái = chạm/vuốt, cuộn chuột = cuộn, gõ phím = nhập chữ, Ctrl+V = dán clipboard của PC.
  - Chuột phải = Back, chuột giữa = Home.
  - Có nút nguồn, âm lượng, xoay màn hình, kéo thanh thông báo, chụp màn hình (lưu vào `Pictures\ADB Kit`).
  - Kéo thả file APK vào màn hình điện thoại để cài; file khác sẽ được copy vào `/sdcard/Download`.
  - **Xoay:** chuyển dọc ⇄ ngang, tự tắt auto-rotate (nếu không, cảm biến sẽ xoay ngược lại ngay). App báo rõ khi màn hình hiện tại bị khóa chiều (ví dụ màn hình chính của Samsung). Khung hiển thị tự co giãn theo chiều xoay.
  - **Tắt màn hình máy (nút gạch chéo màn hình):** màn hình thật tắt nhưng vẫn mirror và điều khiển được từ PC. Cài đặt này được ghi nhớ, tự áp dụng lại sau khi bấm nút nguồn hoặc xoay, và màn hình tự sáng lại khi dừng mirror. Lưu ý: khi cắm USB thì máy được giữ thức; khi dùng qua Wi-Fi, máy vẫn có thể ngủ theo thời gian tắt màn hình đã cài trên máy.
- **Bố cục:** Files, Quyền và Install mở bên trái điện thoại; Logcat, Shell, Mạng/API và Tự động test mở bên phải.
- **Mạng / API** (app WebView bản build debug):
  - Theo dõi trực tiếp request HTTP (fetch/XHR…): status, thời gian, nội dung gửi/nhận.
  - Với **app Tauri**: hiện cả các **lệnh JS → Rust** (`plugin:sql|select` kèm câu SQL, lệnh riêng của app…) và giải mã request của plugin HTTP chạy bên Rust. Để làm được, ADB Kit chèn một đoạn móc trong bộ nhớ vào `window.ipc`; đoạn này mất khi app khởi động lại.
  - "Tải lại app" để bắt cả những gì app gọi lúc khởi động. "Tạo bước kiểm tra" để thêm bước "Kiểm tra API" vào kịch bản.
- **Quyền:** xem quyền runtime (có công tắc cấp/thu hồi), quyền đặc biệt (chọn chế độ appops), quyền tự cấp khi cài, và **lần dùng gần nhất**. Có nút "Cấp hết", "Làm sạch app" (xóa dữ liệu như mới cài, cấp lại quyền đang có), "Thu hồi tất cả" và "Cài đặt app". Lưu ý: thu hồi quyền runtime thì Android sẽ tắt app.
- **Trạng thái app trước khi chạy (mọi app, không riêng app nào):** ở tab Kịch bản và Bộ test chọn *Giữ nguyên / Tắt hẳn app / Xóa dữ liệu (như mới cài)* và *Giữ quyền / Cấp hết / Thu hồi hết*. Áp dụng cho "App cần test" của từng kịch bản ở đầu mỗi lượt (bộ test: trước mỗi testcase và mỗi lần chạy lại; chạy nhiều máy cũng vậy), nên mỗi lần chạy xuất phát từ cùng một trạng thái mà không cần máy ảo. Chọn xóa dữ liệu hoặc thu hồi quyền sẽ **hỏi xác nhận** trước khi chạy. ADB Kit từ chối xóa dữ liệu của thành phần hệ thống (`android`, SystemUI, Settings, Phone, Google Play services…). Quyền bị hệ thống khóa hoặc không cấp được qua `pm grant` (tùy bản Android) được báo trong nhật ký chứ không làm hỏng lần chạy.
- **Độ bền (tab riêng, nhóm Kiểm thử):** đưa máy hoặc app vào những tình huống người dùng gặp mà bàn test không có, để bắt lỗi "chỉ xảy ra ở máy khách". Mỗi mục có mô tả bug nó lộ ra và kết quả hiện ngay bên dưới:
  - *Tiến trình & bộ nhớ:* giết tiến trình rồi mở lại app (kiểm tra khôi phục màn hình / dữ liệu), báo thiếu RAM theo mức, giết mọi app nền, "Không giữ hoạt động".
  - *Pin & chờ:* Doze sâu, nhóm chờ App Standby, cấm chạy nền, mức pin giả, tiết kiệm pin.
  - *Màn hình:* xoay/khóa hướng, tắt hiệu ứng, hiện điểm chạm. *Ngôn ngữ & giờ:* ngôn ngữ riêng của app (Android 13+), múi giờ, đổi đồng hồ máy. *Kết nối:* chế độ máy bay (chặn khi nối adb qua Wi-Fi). *Bộ nhớ trống:* làm đầy để chỉ còn 1 GB … 100 MB (luôn chừa ≥ 100 MB).
  - Mọi thay đổi thiết lập đều **ghi lại giá trị gốc** vào `stress-state.json` trước khi đổi, nên "Khôi phục" / "Khôi phục tất cả" trả đúng giá trị cũ kể cả khi đã đóng ADB Kit. Thiết lập chưa từng tồn tại được xóa thay vì để lại `null`. Lệnh bị máy từ chối (đổi giờ, múi giờ trên một số hãng) báo rõ và không ghi nhận là đã đổi.
- **Hiệu năng (tab riêng):** theo dõi app đang dùng theo thời gian thực — RAM (PSS), CPU (% một lõi), khung hình/giây và số khung giật, nhiệt độ/pin của máy — mỗi giây một điểm, chỉ đọc (`cat /proc/<pid>/stat`, `dumpsys meminfo|gfxinfo|battery`) nên không đổi gì trên máy. Có **Đánh dấu** ghi chú tại thời điểm hiện tại, khung **Đáng chú ý** (RAM tăng đều, khung giật > 10%, CPU cao liên tục, pin nóng lên — chỉ là gợi ý) và **Lưu CSV** (mở bằng Excel, cột ghi chú chứa các dấu đánh).
- **Thông báo (tab riêng):** đăng một thông báo thật lên máy bằng `cmd notification post` — tiêu đề, nội dung, kiểu chữ dài — mà khi chạm vào sẽ **mở app kèm dữ liệu đính kèm** hoặc **mở deep link**, để kiểm tra app xử lý chạm thông báo (kể cả khi đã bị tắt hẳn) mà không cần BE hay khóa Firebase; hoặc "chỉ mô phỏng lúc chạm". **Giới hạn:** không bắn được tin FCM thẳng vào app (Android chỉ cho Google Play Services gửi — shell không có quyền `c2dm.permission.SEND`); muốn thử đúng đường FCM dùng Send test message của Firebase Console. Liên kết và dữ liệu đính kèm không được có dấu cách.
- **Mẫu kịch bản** (Tự động test › Kịch bản › Mẫu có sẵn): chèn nhiều bước một lúc cho tình huống thường gặp — mất mạng giữa chừng, app bị giết rồi mở lại, xuống nền 10 giây, xoay ngang/dọc, từ chối hết quyền, đo tốc độ mở nguội, mở như mới cài. Mẫu chỉ chuẩn bị và chụp màn hình từng giai đoạn; kiểm tra riêng của app do người dùng thêm.
- **Chế độ đơn giản** (nút "Đủ công cụ / Đơn giản" góc trên phải): chỉ giữ công cụ chỉ đọc và test (Tự động test, Tài liệu YC, Hiệu năng, Soát UI, Figma, Logcat), ẩn Shell, Tệp, Dữ liệu, Quyền, Độ bền… cho BA, PM, người mới. Màn hình bắt đầu cũng lọc theo.- **Lưu và khôi phục trạng thái app** (Dữ liệu › Trạng thái app): chép dữ liệu riêng của app **debug** (`databases`, `files`, `shared_prefs`, `no_backup`, `datastore`, `app_*` gồm cả cookie WebView) bằng `run-as … tar` về thư mục dữ liệu của ADB Kit (`userData\appstates`), rồi khôi phục trong vài giây — đăng nhập sẵn tài khoản A / B / "mới cài" mà không phải nhập OTP. Thư mục cache được bỏ qua cả khi lưu lẫn khi khôi phục (trên một app thật: 174 MB → 43 MB, miniapp không phải tải lại). File lưu được kiểm tra toàn vẹn (đọc lại tar) trước khi tin; xuất / nhập `.adbstate` để chia sẻ. Có thêm **bước "Khôi phục trạng thái app"** trong kịch bản tự động (cũng chạy được từ dòng lệnh) để mỗi testcase bắt đầu từ đúng tài khoản. Lưu ý: bản lưu chứa token đăng nhập, chỉ nằm trên máy bạn.
- **Test tay theo KBKT có bằng chứng** (Tự động test › Test tay): nhập KBKT, chọn testcase, làm theo các bước trên điện thoại rồi bấm **Đạt / Lỗi / Xem xét** (`Alt+1/2/3`). Mỗi kết quả tự lưu vào `Documents\ADB Kit\test-tay\<KBKT>\<mã testcase>\<giờ>_<kết quả>\`: ảnh màn hình, thông tin máy + app + phiên bản + màn hình đang mở, và với Lỗi kèm logcat (cùng bộ đệm crash) và video 20 giây vừa rồi, cùng trang `index.html` tóm tắt. **Ghi vào KBKT** tạo bản sao file Excel với cột kết quả điền sẵn và ô ghi chú là liên kết mở thẳng trang bằng chứng (thư mục `…\ket-qua\<giờ>\` nằm cạnh nên liên kết tương đối vẫn đúng khi nén gửi đi). Sau khi chấm Lỗi có nút **Tạo báo lỗi** mở hộp báo lỗi điền sẵn tiêu đề, các bước, kết quả mong muốn. Dùng chung danh sách với tab Bộ test.
- **Automation (cho tester):**
  - **Record:** thao tác trên màn hình mirror (chạm, giữ, vuốt, cuộn, gõ phím, Back/Home...) được ghi thành các bước. Khoảng nghỉ giữa các thao tác thành bước `Wait`; các ký tự gõ liên tiếp được gộp thành một bước. Tọa độ được lưu theo tỷ lệ 0..1 nên chạy được trên máy có độ phân giải khác. Khi có thể, mỗi lần chạm còn ghi lại phần tử bên dưới (id/text) để lúc phát lại tìm đúng phần tử ("Smart targets").
  - **Inspect:** bấm vào một phần tử trên màn hình để xem class/id/text, rồi thêm bước Tap / Wait for / Assert visible / Assert gone.
  - **Các bước khác:** Launch app (có tùy chọn xóa dữ liệu), Force-stop, Wait, Type text, các phím, Screenshot.
  - **Run:** chạy lặp N lần, chỉnh tốc độ, dừng khi có crash hoặc kiểm tra thất bại. Nếu đang mirror thì thao tác đi qua scrcpy, nếu không thì dùng `adb shell input`.
  - **Auto debug:** trong lúc chạy, logcat được theo dõi để bắt crash Java (`FATAL EXCEPTION`), ANR và native crash của app được kiểm thử.
  - Mỗi lần chạy xuất một báo cáo vào `Documents\ADB Kit\reports\<thời gian>_<tên>\`: `report.html` (kết quả, crash + stack trace, thông tin máy, các bước tái hiện, ảnh chụp, logcat), `logcat.txt`, `script.json`, ảnh `.png`.
  - Kịch bản lưu dạng `.json` (mặc định trong `Documents\ADB Kit\tests`).
  - **Kiểu so khớp chữ:** `đúng y` / `chứa` / `bắt đầu bằng` (ví dụ tab "5 Từ vựng" → chứa "Từ vựng").
  - **Nếu thấy thì bấm:** dùng cho popup lúc có lúc không; không thấy thì tự bỏ qua (cảnh báo, không làm test lỗi).
  - **Tăng tốc:** các bước kiểm tra liền nhau dùng chung một lần đọc màn hình (~2 giây/lần đọc).
  - **Quay video** (`screenrecord --bugreport`, có dấu thời gian, tự nối nhiều đoạn 3 phút) và đính kèm vào báo cáo.
  - **Bộ test (tab "Bộ test"):** gom nhiều kịch bản `.json`, mỗi kịch bản là một testcase. Có thể đặt **nhóm** (dòng vàng trong KBKT) và gắn file **CSV** để chạy một kịch bản với nhiều bộ dữ liệu (dùng `${tên_cột}` trong các bước, mỗi dòng CSV là một testcase). Có tùy chọn **chạy lại khi lỗi** (kết quả ghi vào KQ lần 2/3) và **tắt hẳn app trước mỗi testcase**. Đường dẫn trong file bộ test được lưu tương đối, nên copy cả thư mục `tests` sang máy khác vẫn chạy được.
  - **Kết quả bộ test:** `tong-hop.html` cùng file **`KBKT_<tên>.xlsx` theo mẫu KBKT của BES** (`resources/templates/template_KBKT_BES.xlsx`): D2–D5 là thông tin chung, nhóm tô vàng, Mục đích / Các bước / Kết quả mong muốn tự sinh (hoặc lấy từ nút "KBKT" trong tab Kịch bản), KQ lần 1/2/3 là P/F, cột Ghi chú có link tới báo cáo chi tiết.
  - **Bước kiểm tra API:** URL/lệnh chứa…, method, status, kết quả chứa…; chỉ xét các lời gọi xảy ra sau thao tác trước đó. Có cả kiểu "KHÔNG được gọi". Báo cáo có bảng mọi API/lệnh theo từng bước, kèm file `api.har` (mở bằng Chrome DevTools → Network → Import).
  - **Bước quyền:** kiểm tra quyền đang cấp/từ chối, cấp/thu hồi, thu hồi tất cả (như mới cài), đặt quyền đặc biệt. Báo cáo liệt kê quyền app đã dùng trong lúc test.
  - **Bước chuẩn bị môi trường:** bật/tắt Wi-Fi và 4G, cấp/thu quyền, mở deep link, lệnh adb shell (có kiểm tra kết quả).
  - **Bắt lỗi WebView:** với app build debug, kết nối DevTools của WebView (`webview_devtools_remote_<pid>`) để ghi lại exception JS (kèm stack), `console.error`, request mạng lỗi / HTTP ≥ 400, và bước đang chạy lúc đó. Có tùy chọn "Lỗi JS = test lỗi".
- **Logcat:** lọc theo mức log, tìm kiếm (phân biệt hoa thường / regex), lọc theo app (package → PID, tự cập nhật khi app khởi động lại), tạm dừng, xóa, tự cuộn theo log mới.
- **Files:** cây thư mục, upload/download, tạo thư mục, xóa, kéo file từ PC thả vào để upload.
- **Shell:** terminal tương tác (xterm.js + `adb shell -tt`).
- **Install APK:** các tùy chọn `-r`, `-d`, `-g`, `-t`, có lịch sử các lần cài.

## Đợt 2: so sánh ảnh, giả lập lỗi, báo lỗi, chạy từ dòng lệnh

- **So sánh màn hình với ảnh chuẩn** (bước "So sánh màn hình"):
  - Lần chạy đầu lưu màn hình làm ảnh chuẩn; các lần sau so từng điểm ảnh, báo lỗi nếu lệch quá ngưỡng (mặc định 1–2%).
  - Mặc định bỏ qua thanh trạng thái và thanh điều hướng.
  - Báo cáo hiện ảnh chuẩn, ảnh hiện tại và ảnh khác biệt (tô đỏ) cạnh nhau.
  - Ảnh chuẩn lưu ở `Documents\ADB Kit\baselines\<kịch bản>\<dòng máy>\`. Tùy chọn **"Cập nhật ảnh chuẩn"** dùng khi giao diện được đổi có chủ đích.
- **Giả lập lỗi API** (bước "Giả lập…", hoặc trực tiếp trong panel Mạng):
  - Request HTTP từ WebView: trả status tùy ý (500…), lỗi mạng, hoặc chậm.
  - Lệnh Tauri (JS → Rust): bị từ chối, trả kết quả giả, hoặc chậm.
  - Bước **"Tải lại giao diện app"** để áp dụng giả lập ngay từ lúc khởi động.
  - Giả lập tự gỡ khi kết thúc chạy và tự hết hạn sau 15 phút. Lời gọi bị giả lập được gắn nhãn **GIẢ**.
- **Báo lỗi một chạm**: lần chạy lỗi sẽ có `bao-loi.md` và nút **"Chép nội dung báo lỗi"** (trong app và trong report.html), gồm tiêu đề, môi trường (máy, Android, phiên bản app), bước tái hiện, kết quả mong muốn/thực tế, lỗi JS/API liên quan, đường dẫn đính kèm. Dán thẳng vào Jira / Redmine.
- **Chạy từ dòng lệnh** (CI, chạy hằng đêm) — không mở cửa sổ:

  ```bat
  "ADB Kit.exe" --run "D:\tests\BoTest_MyEnglish.json" [--serial <máy>] [--out <thư mục>] [--no-video] [--fresh off|stop|clear] [--perms keep|all|none]
  rem bản dev:  npm run build && npm run cli -- "D:\tests\kich_ban.json"
  ```

  `--fresh` / `--perms` ghi đè lựa chọn "Trước khi chạy" / "Quyền" trong file (ví dụ CI luôn chạy với `--fresh clear --perms all`). Nhận cả kịch bản lẫn bộ test. In tiến trình ra terminal, ghi `ket-qua.json`, **mã thoát** 0 = đạt, 1 = có lỗi, 2 = không chạy được. Bộ test vẫn xuất file KBKT như khi chạy trong app.

## Đợt 3: vùng bỏ qua, hiệu năng, KBKT

- **Khoanh vùng bỏ qua** cho bước "So sánh màn hình": bấm nút **"Vùng bỏ qua"** trên bước, rồi kéo chuột khoanh ngay trên màn hình điện thoại các vùng hay thay đổi (ngày giờ, lời chào, quảng cáo…). Lúc vẽ không gửi thao tác nào tới máy.
- **Đo hiệu năng** (tùy chọn "Đo hiệu năng", bật sẵn):
  - Bước "Mở app" đo **thời gian mở app** (`am start -W`, phân biệt khởi động nguội).
  - Trong lúc chạy, lấy mẫu **RAM** (PSS) và **CPU** của app mỗi 2 giây; cuối lần chạy đọc **tỉ lệ khung hình giật** (`dumpsys gfxinfo`, kèm p90/p99).
  - Báo cáo có thẻ tóm tắt và biểu đồ RAM/CPU theo thời gian, có vạch đánh dấu từng bước.
  - Bước "Hiệu năng: … ≤ ngưỡng" (mở app ms, RAM MB, CPU %, giật %) để test báo lỗi khi vượt ngưỡng.
- **Mẫu KBKT**: chọn **BES**, **BCCS**, hoặc **file mẫu riêng** cho file KBKT xuất ra từ bộ test. App tự nhận dạng cấu trúc BES/BCCS theo dòng tiêu đề. Với BCCS (chỉ có 1 cột Result), các lần chạy lại và lý do lỗi được ghi vào ghi chú (comment) của ô.
- **Nhập testcase từ file KBKT có sẵn** (tab Bộ test → "Nhập testcase từ file KBKT…"):
  - Đọc mọi sheet đúng mẫu BES/BCCS, chia theo nhóm.
  - Mỗi dòng **gắn kịch bản tự động**, hoặc **đánh kết quả test tay** (P / F / PE).
  - Khi chạy bộ test, kết quả tự động và test tay được ghi vào **một bản sao** của file trong thư mục báo cáo (file gốc không đổi). Nút "Ghi kết quả test tay" ghi ngay mà không cần chạy.

## API của app native (Chucker)

App Android native (Kotlin/Java dùng OkHttp) không có WebView nên không bắt API qua DevTools được. Nếu bản debug/staging của app có gắn **Chucker** (thông báo "Recording HTTP activity"), ADB Kit đọc thẳng file `databases/chucker.db` của app qua `run-as`:

- Tab **Mạng / API** tự nhận ra, nhãn **HTTP·App**: method, URL, mã trạng thái, thời gian, header và body gửi/nhận, lỗi kết nối (timeout…). Danh sách cập nhật mỗi giây; lời gọi đang chờ tự chuyển sang kết quả khi xong.
- **Tải lại app** với app native = khởi động lại app để bắt cả API lúc mở app.
- Bước **"Kiểm tra API"** trong kịch bản và file `api.har` của báo cáo cũng dùng được (có header).
- Chỉ đọc bản sao của database, không ghi gì vào app. Cần app **debuggable** (bản release không đọc được).
- Chưa hỗ trợ **giả lập lỗi API** cho app native (cần proxy + chứng chỉ).

## So với Figma (đo kích thước, khoảng cách)

Tab **So với Figma**: so một phần tử trên máy thật với node tương ứng trong thiết kế Figma, theo dp.

1. Lần đầu: nhập **Figma Personal Access Token** (Figma → Settings → Security → Personal access tokens, quyền `File content: Read-only`). Token được mã hóa (DPAPI) và chỉ lưu trên máy này. Khi chạy dev, nếu có file `.figma-token` cạnh `package.json` thì app dùng luôn file đó.
2. Dán link Figma (link tới một trang hoặc một section/frame, có `node-id`) rồi bấm **Mở**. App lấy mọi frame cỡ màn hình điện thoại (rộng 320–480). Trang lớn có thể mất khoảng 1 phút ở lần đầu. Sau đó dữ liệu được lưu sẵn (đã bỏ vector, khoảng 1 MB cho ~100 màn) nên mở lại gần như ngay. Muốn lấy thiết kế mới thì bấm nút tải lại.
3. Chọn frame trong danh sách (nhóm theo section, có ô lọc), hoặc bấm **Tìm màn giống**: app đọc chữ trên màn hình điện thoại và gợi ý các frame có nhiều chữ trùng nhất.
4. Bật **Theo dõi** rồi bấm vào phần tử trên màn mirror. Lúc này cú bấm **không** đi vào app mà chỉ dùng để đo; muốn thao tác thật thì giữ **Alt** khi bấm. Cuộn chuột, phím và các nút Back/Home vẫn gửi vào máy như thường. App tự tìm node Figma tương ứng, trước hết theo chữ, sau đó theo chữ bên trong, cuối cùng theo vị trí so với chữ gần nhất. Nếu tìm sai, bấm thẳng lên ảnh Figma để chọn tay. Khi màn hình điện thoại đổi (do Alt + bấm, cuộn, hoặc app tự chuyển màn), frame Figma tự đổi theo.
   - Kéo thanh dọc giữa điện thoại và panel, hoặc giữa ảnh Figma và bảng số đo, để đổi độ rộng. Bấm đúp vào thanh để về mặc định.
   - **Thanh công cụ chia nhóm** theo mục đích: *Điện thoại* (Tệp, Logcat, Shell), *Gỡ lỗi* (Mạng/API, Dữ liệu, Quyền, Miniapp), *Kiểm thử* (Tự động test, Tài liệu YC, Soát UI, So với Figma). Cửa sổ hẹp thì chỉ công cụ đang mở hiện tên, các nút còn lại giữ biểu tượng và tooltip để thanh luôn nằm trên một hàng. Thông tin máy (Android, pin) và nút Wi-Fi nằm cạnh thanh thiết bị.
   - **Mỗi panel có thanh tiêu đề**: tên, một dòng mô tả, nút **Cách dùng** (mở đúng mục hướng dẫn của panel) và nút đóng.
   - **Hộp thoại xác nhận trong app** thay cho hộp thoại hệ điều hành: cùng giao diện tối, hành động không hoàn tác được thì nút "Hủy" được chọn sẵn, **Esc** = hủy.
   - **Tùy chọn chạy** (tab Tự động test) gom thành hộp có nhóm *Khi chạy / Ghi vào báo cáo / Trạng thái app trước khi chạy / Nâng cao*, thu gọn mặc định kèm một dòng tóm tắt đang ghi gì. Tương tự, **Giả lập & phát lại** (tab Mạng/API) gom giả lập mạng, ghi/phát lại và "Ngắt mạng cả máy" (nhóm có viền đỏ vì tác động lên cả điện thoại).
   - **Chuyển động mượt**: mở/đóng/đổi panel thì điện thoại trượt sang bên và panel trượt vào (View Transitions của Chromium, chỉ dùng transform/opacity); hộp tuỳ chọn, hộp thoại, chi tiết request hiện ra nhẹ nhàng; nút có phản hồi khi rê và bấm. Tự tắt hết khi Windows bật "giảm chuyển động" (Cài đặt › Trợ năng › Hiệu ứng).
   - **Tự động test dễ dùng hơn**: danh sách bước thu gọn mỗi bước một dòng, biểu tượng màu theo nhóm (thao tác / chờ & kiểm tra / app & môi trường / giả lập), chỉ bước đang chọn mới mở ô sửa; nút **Thêm bước** mở menu chia nhóm có mô tả một dòng, "Hay dùng" và ô tìm (↑/↓ + Enter); kịch bản trống hiện hai điểm bắt đầu (Ghi thao tác / Soi phần tử). Tab **Bộ test** gom mã testcase, người lập, người test, chạy lại, mẫu KBKT, trạng thái app trước khi chạy vào mục thu gọn **Chi tiết bộ test** kèm dòng tóm tắt. Tab **Dữ liệu**: OTP có trạng thái "đang chờ mã" rõ ràng và hướng dẫn 3 bước, form tài khoản có nhãn và chỉ hiện khi bấm "Thêm tài khoản", lỗi app không phải bản debug có giải thích và cách xử lý.
   - **Màn hình chính có định hướng**: khi chưa mở panel nào, bên phải điện thoại hiện "Bạn muốn làm gì?" — các việc hay làm (test tự động, test tay KBKT, đăng nhập sẵn, điền OTP, soát giao diện, tình huống khó, xem API / log, quyền, dữ liệu app) mỗi việc một thẻ mở đúng công cụ ở đúng tab. Màn hình "chưa có thiết bị" có nút mở hướng dẫn kết nối.
   - **Soát UI chia ba tab** (Soát giao diện — mở sẵn, Cấu hình máy, Vị trí GPS) thay vì một trang dài nơi chức năng chính nằm dưới bản đồ. **Tab Quyền** ghi tên quyền bằng tiếng Việt dễ hiểu kèm tên kỹ thuật.
   - **Dễ đọc và dùng bàn phím**: cỡ chữ nhỏ nhất 11px, chữ phụ đạt độ tương phản ≥ 4,5:1, mọi nút/ô nhập cùng cao 28px, có viền focus khi duyệt bằng Tab, nút chỉ có biểu tượng tự có `aria-label` theo tooltip, tôn trọng thiết lập "giảm chuyển động" của Windows.
   - Các khung xếp chồng (Mạng/API: danh sách ↔ chi tiết; Tự động test: các bước ↔ nhật ký; Dữ liệu và Tài liệu YC: danh sách ↔ nội dung) có thanh kéo riêng, đổi chiều cao hoặc độ rộng tùy panel đang rộng hay hẹp. Hai nút mũi tên giữa thanh ẩn khung này để khung kia chiếm hết chỗ, bấm lại để mở. Kích thước và trạng thái ẩn/hiện được nhớ cho lần sau.
5. Bảng so sánh: rộng/cao, lề trong phần tử cha, khoảng cách tới phần tử trên/dưới/trái/phải, khoảng cách tới mép màn hình. Ô nào lệch quá **sai số** (mặc định 2dp) thì tô đỏ. Phần tử cha và phần tử kế bên cũng được ghép cặp sang Figma, nên hai bên luôn đo tới cùng một phần tử. Có kèm thông số thiết kế: cỡ chữ, màu, bo góc, auto layout (gap/padding), cách co giãn.

Lưu ý:

- Không so toạ độ tuyệt đối, vì thiết kế thường vẽ trên khung iPhone (393×852, status bar 50) còn máy thật có kích thước khác. Nếu chiều rộng lệch nhưng hai mép trái/phải khớp, app ghi "giãn theo màn" chứ không báo lỗi. Với chữ, khung TextView thường giãn hết chiều ngang nên độ rộng chỉ được ghi chú, không tính là lỗi.
- Các thanh hệ thống vẽ trong thiết kế (Status Bar, Home Indicator, bàn phím) không được dùng làm phần tử kế bên.
- App Jetpack Compose không có `resource-id`, nên app ghép cặp theo chữ. Nếu dev bật `testTagsAsResourceId` và đặt `testTag` trùng tên layer Figma thì sẽ ghép chính xác hơn (chưa dùng ở bản này).

## Đợt 4: OTP, dữ liệu app, crash nền, quay video, GPS, nhiều máy, so sánh bản build

- **OTP & tài khoản test** (tab **Dữ liệu**): "Chờ mã OTP" đọc mã mới trong thông báo của điện thoại (`dumpsys notification`, chỉ lấy mã 4–8 chữ số gần chữ OTP / mã / code; thông báo đã có trước đó bị bỏ qua). Có nút **Điền** hoặc chế độ **Tự điền**. Bước kịch bản **"Chờ mã OTP rồi điền"** giúp tự động hóa luồng đăng nhập OTP. Danh sách tài khoản test điền một chạm (lưu trên máy tính này).
- **Dữ liệu app** (tab **Dữ liệu**, app debug, qua `run-as`):
  - **SharedPreferences**: xem, sửa, thêm, xóa khóa. Khi lưu, app được đóng trước, file đi qua `/data/local/tmp` rồi bị xóa ngay.
  - **SQLite**: kéo bản sao kèm WAL, chỉ cho chạy SELECT / WITH / PRAGMA, tối đa 500 dòng.
  - **MMKV**: chỉ xem, giải mã theo kiểu đoán; file mã hóa thì báo là không đọc được.
- **Tự bắt crash / ANR**: theo dõi logcat của máy đang hiển thị. Khi có crash Java / native hoặc ANR, app chụp ngay ảnh, giữ video 20–40 giây trước đó, log và crash, rồi hiện thông báo kèm nút **Tạo báo cáo lỗi** (hộp thoại Báo lỗi điền sẵn). Mỗi app báo tối đa một lần mỗi 30 giây; trong lúc chạy test thì bỏ qua (runner tự ghi).
- **Quay video màn hình**: nút máy quay cạnh màn hình điện thoại, dùng `screenrecord` của máy (MP4), lưu vào `Videos/ADB Kit`.
- **Vị trí GPS giả lập** (tab Soát UI, Android 12+): **chọn trên bản đồ**, kéo để di chuyển và cuộn để phóng to. Có hai chế độ: đặt một điểm, hoặc bấm A rồi B để đi thẳng A → B trong N giây (hiện quãng đường, tốc độ, và chấm vị trí chạy theo).
  - Tìm địa chỉ qua Photon (dự phòng Nominatim), có ô dán tọa độ và các địa điểm có sẵn.
  - Bản đồ là component tự viết, không dùng thư viện. Ảnh bản đồ lấy từ OpenStreetMap France, tự chuyển sang Esri / tile.openstreetmap.org nếu mạng chặn nguồn trước, và gửi kèm User-Agent định danh ADB Kit. Dùng lệnh có sẵn `cmd location providers` (không cần cài app phụ) và tự tắt khi đóng ADB Kit. Máy cũ hơn sẽ được hướng dẫn dùng app Fake GPS.
- **Chạy trên nhiều máy** (Bộ test › "Nhiều máy…"): mỗi máy một `SuiteRunner` chạy song song (máy đang hiển thị dùng mirror, máy khác dùng `adb input`), mỗi máy có báo cáo và KBKT riêng, và một trang `tong-hop.html` testcase × máy, tô vàng các testcase có kết quả khác nhau giữa các máy.
- **So sánh 2 lần chạy** (cuối tab Tự động test): mỗi lần chạy giờ lưu thêm `report.json`. Chọn thư mục lần trước và lần này để tạo `so-sanh.html` gồm:
  - bước mới lỗi / đã hết lỗi / chậm hơn;
  - hiệu năng;
  - API theo endpoint (gộp id): mới, không còn gọi, mới lỗi, chậm hơn;
  - ảnh chụp cùng tên so từng điểm ảnh, kèm ảnh khác biệt;
  - lỗi JS mới.

## Đợt 5: tự khám phá, phát lại API, deep link, rò rỉ RAM, xu hướng, RTL

- **Tự khám phá app** (Tự động test › "Tự khám phá"): không cần kịch bản.
  - Cách chạy: mở app, đọc từng màn (nhận diện màn bằng chữ ký id + chữ, bỏ qua số), bấm lần lượt các nút chưa bấm, cuộn thử một lần, rồi Back. Tự đồng ý hộp thoại xin quyền, mở lại app khi bị văng ra, và dừng nếu máy khóa màn hình.
  - **Không bao giờ bấm** nút đăng xuất, xóa, thanh toán, mua, chuyển tiền, gọi…; người dùng có thể thêm từ cấm riêng.
  - Kết quả `kham-pha.html`: ảnh từng màn, quan hệ "đến từ / dẫn tới", vấn đề giao diện (luật Soát UI), và crash / ANR kèm các bước tái hiện từ lúc mở app.
- **Ghi API rồi phát lại** (tab Mạng / API):
  - "Phát lại N" biến các phản hồi vừa ghi thành giả lập (cùng status và body, đường dẫn dài được ưu tiên). "Giữ phản hồi này" chỉ cố định một API.
  - "Lưu bộ… / Mở bộ…" lưu và mở file `.mock.json`, sửa tay được.
  - Bước kịch bản **"Giả lập: phát lại API đã ghi (file)"**. Phản hồi nay được giữ tới 64 KB.
- **Deep link & màn hình** (tab Dữ liệu): đọc Activity Resolver Table của `dumpsys package` (không cần bản debug), liệt kê deep link (App Link / Web / Intent, sửa được trước khi mở) và các activity (mở được nếu exported).
- **Rò rỉ bộ nhớ**: khi chạy nhiều lượt và có đo hiệu năng, app đo RAM cuối mỗi lượt. RAM tăng ở ≥ 75% số lượt và tổng tăng hơn 20% / 25 MB (tính từ lượt 2) thì báo cáo có cảnh báo, kèm RAM từng lượt.
- **Xu hướng kết quả** (cuối tab Tự động test): `xu-huong.html` gom mọi `report.json` 30 ngày theo kịch bản, gồm tỉ lệ đạt, dải 20 lần gần nhất (bấm để mở báo cáo), test **chập chờn** (đổi đạt/lỗi ≥ 2 lần trong 10 lần gần nhất) và kịch bản luôn lỗi.
- **Bố cục phải-sang-trái** (Soát UI, mọi Android) và **ngôn ngữ riêng của app** (Android 13+, gồm en-XA chữ dài giả và ar-XB RTL giả).

## Tài liệu yêu cầu (BA): testcase và soát màn hình theo tài liệu

Tab **Tài liệu YC** nhận file Word của BA (TLNV / MTYCTD `.docx`, kéo thả hoặc "Nhập .docx").

- **Đọc tài liệu.** Bảng được nhận diện theo dòng tiêu đề, không theo vị trí. Các dạng nhận được:
  - TLNV: `# | Title | Component Type | Editable | Mandatory | Description` và API `Danh mục | Nội dung chi tiết` (Mục đích / Input / Output / Xử lý theo Bước, nhánh Hợp lệ / Không hợp lệ / Lỗi).
  - MTYCTD: `STT | Tên | Loại Control | Bắt buộc | Độ dài tối đa | Read only | Mô tả`, `Tham số | Kiểu dữ liệu | Bắt buộc | Mô tả | Map …`, `Step | Description`, `Status Code`, khối `curl` (chỉ giữ đường dẫn, bỏ host / query / header).
- **Cách gom màn hình.**
  - Màn hình là tiêu đề sâu nhất không phải tiêu đề chung ("Thay đổi về giao diện", "Xử lý sự kiện…", "Mapping API").
  - Tiêu đề "Block / Header…" được gộp vào màn hình làm một phần (section).
  - Màn trùng tên (Android / iOS, cá nhân / doanh nghiệp) được thêm tên nhánh để phân biệt.
  - Ảnh mockup trong từng mục được lấy ra để xem cạnh bảng.
- **Quy tắc trường.** ADB Kit rút quy tắc từ mô tả: tối đa / tối thiểu N ký tự, `dd/MM/yyyy`, email, SĐT, chỉ số, không ký tự đặc biệt, disable / không cho sửa, danh sách lựa chọn, giá trị mặc định. Khi tài liệu tự mâu thuẫn (cột Editable = No nhưng mô tả "cho phép chỉnh sửa"), ADB Kit đánh dấu ⚠ để hỏi lại BA.
- **Testcase → KBKT.** Mỗi màn hình sinh các nhóm ca:
  - giao diện;
  - bỏ trống trường bắt buộc;
  - giá trị biên (N và N+1 ký tự, sai định dạng);
  - lựa chọn và mặc định;
  - trạng thái disable;
  - từng nhánh "Nếu… thì…" hoặc "Tab chọn… thì…".

  Mỗi API sinh ca: thiếu tham số bắt buộc, từng nhánh của từng bước (bỏ nhánh chỉ "thực hiện bước N"), và trả về thành công. Lọc, bỏ chọn rồi xuất theo mẫu BES / BCCS; tên file là tên tài liệu đổi tiền tố thành `KBKT`.
- **Soát trên máy.**
  - Quét đọc chữ và ô nhập của màn hình đang mở: native qua uiautomator, miniapp qua DevTools WebView. Chỉ đọc nhãn, maxlength, khoá / mở, không đọc giá trị đã nhập.
  - ADB Kit đoán màn trong tài liệu (xếp hạng theo số thành phần thấy × tỉ lệ) rồi báo thành phần thiếu, ô bị khoá sai, maxlength lệch tài liệu.
- **Giá trị thử.** Mỗi ô nhập có nút điền sẵn: đúng giới hạn, vượt 1, email sai, ngày không tồn tại, chỉ khoảng trắng…
  - Trong WebView, giá trị được điền vào đúng ô có nhãn đó, cắt theo maxlength như khi gõ thật, và phát sự kiện input / change / blur để validate chạy.
  - Ngoài WebView, giá trị được gõ qua bàn phím ảo; chữ có dấu thì dán qua clipboard.
- **Đối chiếu API với tài liệu** (tab API › "Bắt API"):
  - ADB Kit theo dõi API của app đang mở và ghép từng API trong tài liệu với một đường dẫn thật. Việc ghép tự động dựa vào đường dẫn hoặc curl trong tài liệu, hoặc tên dạng `find-staff`; chọn tay cũng được và ADB Kit sẽ nhớ.
  - Với lần gọi thật gần nhất (bỏ qua các lần đã giả lập), ADB Kit báo: tham số bắt buộc app không gửi, trường trả về sai kiểu (`Number` nhưng nhận chuỗi…), trường chưa thấy, trường app gửi / nhận thêm mà tài liệu không ghi, phương thức lệch.
  - TLNV chỉ ghi tên tiếng Việt ("Số giấy tờ"), nên cần ghép một lần với trường thật (`idNo`).
- **Giả lập nhánh lỗi**:
  - Mỗi API có sẵn các nút theo tài liệu: từng nhánh lỗi của từng bước (bỏ nhánh chỉ "thực hiện bước N"), từng mã lỗi ở bảng Status Code, `success = false`, HTTP 500 / 401, mất mạng, chậm 15 giây.
  - Phản hồi giả dùng đúng tên trường của tài liệu (`success` / `code` / `message`).
  - Kèm theo là dòng kỳ vọng lấy từ tài liệu, gồm cả xử lý của màn hình (ví dụ "Nếu success = false thì hiển thị popup…").
  - Chỉ áp cho API gọi từ WebView / miniapp, tự hết sau 15 phút, và được gỡ khi dừng theo dõi hoặc đóng tab.
- Tài liệu đã phân tích được lưu trong `%APPDATA%/adb-kit/reqdocs`, không gửi đi đâu.

## Hướng dẫn trong app

Nút **Hướng dẫn** trên thanh công cụ (đọc được cả khi chưa cắm điện thoại):

- Mục lục theo từng tính năng, có ô tìm kiếm; mỗi mục có các bước dùng, mẹo và lưu ý. Cuối mục lục là danh sách phím tắt.
- **Chỉ cho tôi**: làm tối cửa sổ, khoanh sáng đúng nút / vùng cần dùng và giải thích từng bước (Tiếp / Trước / Bỏ qua, phím ← → Enter Esc). Bảng liên quan được tự mở.
- Lần đầu mở ADB Kit có điện thoại kết nối sẽ tự chạy tour giới thiệu ngắn (chỉ một lần).
- Nội dung nằm trong `src/renderer/src/lib/help.ts`: thêm mục mới hoặc bước tour mới chỉ cần sửa file này (bước tour trỏ bằng CSS selector hoặc chữ trên nút).

## Soát UI: đổi cấu hình nhanh + soát màn hình

Tab **Soát UI** dùng để kiểm tra app có vỡ giao diện khi người dùng đổi thiết lập máy hay không.

**Cấu hình máy** (bấm là đổi ngay):

- **Chế độ tối** sáng/tối. Một số máy (như Samsung One UI) khóa thiết lập này: ADB Kit tự trả lại như cũ và mở trang **Cài đặt › Màn hình** trên điện thoại để bật tay.
- **Cỡ chữ** 0.85× đến 2×.
- **Kích thước hiển thị** (mật độ màn hình) Nhỏ / Mặc định / Lớn / Rất lớn.
- **Hiệu ứng chuyển động** tắt / 0.5× / bình thường; tắt đi giúp test tự động ổn định hơn.
- **Hiện viền layout**, **Hiện điểm chạm**.
- Giá trị gốc được ghi nhớ theo từng máy (kể cả sau khi tắt ADB Kit). Nút **Khôi phục (N)** đưa mọi thiết lập đã đổi về đúng như lúc đầu, với mật độ màn hình là trả về đúng con số cũ chứ không "reset" (trên Samsung, `wm density reset` nhảy về mật độ gốc của tấm nền, làm giao diện nhỏ đi).

**Soát màn hình này**: đọc cây giao diện và chụp màn hình rồi báo:

- vùng bấm nhỏ hơn **48×48 dp** (dưới 32 dp là lỗi nặng);
- nút bấm được nhưng **không có nhãn** (TalkBack không đọc được);
- **chữ đè lên nhau**, hai vùng bấm chồng nhau;
- chữ bị cắt "…", chữ **tràn ra ngoài khung**, chữ sát mép màn hình;
- **tương phản chữ** thấp theo WCAG (dưới 4.5:1, chữ lớn dưới 3:1), đo từ màu thật trên ảnh chụp, bỏ qua chữ nằm trên ảnh/gradient.

Rê chuột hoặc bấm vào từng mục để khoanh phần tử trên màn hình điện thoại. Nút **Thử chữ to 1.3× + soát** làm cả hai bước một lần. Khi đã có kết quả, đổi cấu hình nào cũng tự soát lại. Đây là kiểm tra theo kinh nghiệm, nên xem lại bằng mắt trước khi báo lỗi. Màn hệ thống (màn khóa, thanh thông báo) không được soát.

## Báo lỗi nhanh (F8)

Tester gặp lỗi khi đang thao tác tay thì bấm **Báo lỗi** trên thanh công cụ, hoặc phím **F8**. Ngay lúc bấm, trước khi tester kịp gõ gì, ADB Kit lưu lại:

- **ảnh màn hình**, **video 20–40 giây gần nhất** của màn mirror (luôn quay sẵn ở 8 fps, chỉ ghi ra đĩa khi tạo báo cáo; tốn thêm khoảng 4% một nhân CPU, tắt được bằng ô "Quay sẵn video");
- **các thao tác vừa làm** trên màn mirror (bấm, vuốt, cuộn, gõ chữ, phím) làm "Các bước tái hiện";
- **logcat** (toàn máy và riêng app), **crash** trong 10 phút gần nhất, **cây giao diện** (`ui.json`), app và màn đang mở;
- **API và lệnh bridge** 5 phút gần nhất kèm lỗi JS, nếu tab **Mạng / API** đang theo dõi app đó (`api.har`, `calls.json`).

Tester chỉ cần nhập tiêu đề, mức độ, kết quả thực tế và mong muốn, rồi bấm **Tạo báo cáo** (Ctrl + Enter). Nội dung lỗi dạng Markdown được **tự sao chép** để dán vào Jira, Redmine hoặc Teams. Báo cáo gồm thư mục `Documents/ADB Kit/reports/<thời điểm>_bao-loi` với `report.html` và một file **zip** để đính kèm ticket. Bấm Hủy thì thư mục tạm bị xóa. Báo cáo cũ được dọn cùng chức năng "Dọn báo cáo cũ".

## Miniapp (super app)

Tab **Miniapp** dành cho dev và tester làm super app có miniapp chạy trên WebView, ví dụ Tammi (container Capacitor, tương thích WindVane).

- **WebView đang mở**: liệt kê mọi trang WebView có thể soi trên máy, theo từng app. Danh sách tự cập nhật mỗi 3 giây khi miniapp được mở hoặc đóng. Chấm xanh nghĩa là trang đang hiển thị. Bấm **DevTools** để mở Chrome DevTools đầy đủ cho trang đó (Elements, Console, Network, Sources, Application…) trong một cửa sổ riêng, không cần mạng và không cần `chrome://inspect`. Bỏ tick "Chỉ app đã chọn" để thấy cả Chrome và các app khác.
- **Miniapp đã tải về máy**: tên, appId, phiên bản, dung lượng gói và lần cập nhật, đọc từ dữ liệu của app qua `run-as` (cần app **debuggable**). Có hai nút:
  - **Mở**: mở thẳng miniapp bằng deep link theo mẫu (Tammi: `tammi://miniapp?appId={appId}`; mẫu sửa được và được nhớ theo từng app).
  - **Xóa cache**: đóng app và xóa gói đã tải, để lần mở sau app tải lại bản mới nhất từ server.
- **Mở link nhanh**: lưu sẵn các deep link hoặc URL, một cú bấm là vào thẳng màn cần test.
- **Theo dõi API & bridge**: chuyển sang tab **Mạng / API** cho app này. Ngoài request HTTP của WebView, tab còn thấy:
  - **Bridge**: miniapp gọi hàm native (JSAPI), ví dụ `WVUI.toast` hoặc `WVUser.getUserInfo`, kèm tham số và kết quả hoặc lỗi.
  - **HTTP·Bridge**: API mà miniapp gọi qua native (`WVFetch.request`). Các API khác domain của miniapp đi đường này nên **không** hiện trong Network của WebView/DevTools; ADB Kit bắt được vì móc vào bridge.
  - **Sự kiện**: native báo cho miniapp (ví dụ app ra nền hoặc vào lại).
  - Cột tên trang cho biết lời gọi đến từ miniapp nào. Giả lập lỗi, 500 hoặc chậm và bước "Kiểm tra API" trong kịch bản đều dùng được với lời gọi bridge.

- **Thời gian mở miniapp**: bấm ⏱ ở dòng miniapp (hoặc ở link nhanh). ADB Kit mở miniapp bằng deep link, chờ WebView mới, rồi đọc mốc thời gian của chính trang đó (đồng hồ máy được căn theo PC):
  - **Container + WebView**: từ lúc mở đến khi trang bắt đầu tải, gồm xử lý link, tải/giải nén gói và tạo WebView.
  - **Tải HTML**, **Dựng trang (DOM)**, **Tải tài nguyên (load)**, **Đến khi mạng yên**, cùng mốc **FCP / LCP** nếu trình duyệt ghi được.
  - Số tài nguyên, dung lượng tải qua mạng và 5 tài nguyên chậm nhất.
  - Tick **Như lần đầu** để xóa gói và khởi động lại app trước khi đo (như lần mở đầu sau khi cài hoặc cập nhật).
  - Lịch sử đo được lưu trên máy để so sánh giữa các phiên bản và giữa lần đầu với lần có cache.
  - API gọi qua bridge (`WVFetch`) không nằm trong số liệu tài nguyên của trang.

Lưu ý: hook chỉ nằm trong bộ nhớ của trang, không sửa gì trong app; app tải lại mà không có ADB Kit thì hook mất. Cần bản build có bật debug WebView (bản debug/staging).

## Giả lập mạng xấu

Trong tab **Mạng / API**:

- **Giả lập mạng cho app**: Chậm (như 3G yếu), Chập chờn (30% lời gọi lỗi, còn lại trễ ngẫu nhiên), Mất mạng. Áp cho **mọi API** của app đang theo dõi: fetch/XHR của WebView (file của trang không bị ảnh hưởng), API miniapp qua bridge (`WVFetch`), HTTP của Tauri. Lời gọi bị ảnh hưởng có nhãn **MẠNG**. Tự hết sau 15 phút, và tắt khi ngừng theo dõi.
- **Mất mạng thật cả máy** 5–60 giây: tắt Wi-Fi và dữ liệu di động rồi tự bật lại. Áp cho mọi app, kể cả app native. Lệnh bật lại chạy ngay trên điện thoại, nên mạng vẫn về kể cả khi ADB Kit bị tắt giữa chừng. Chỉ dùng được khi cắm cáp USB (nối adb qua Wi-Fi mà tắt Wi-Fi thì mất kết nối).

## Tạo ticket Jira

Sau khi tạo báo cáo lỗi (F8), bấm **Tạo ticket Jira**: ADB Kit tạo ticket kèm mô tả (định dạng Jira), ảnh màn hình (hiện ngay trong ticket) và file zip.

- Lần đầu cần nhập: địa chỉ Jira, e-mail + **API token** (Jira Cloud) hoặc để trống e-mail và dùng **Personal Access Token** (Jira Server / Data Center), mã dự án, loại ticket. Bấm **Kiểm tra kết nối** để xem tên tài khoản, dự án và chọn loại ticket có sẵn.
- Token được mã hóa bằng Windows (DPAPI) và chỉ gửi tới địa chỉ Jira đã nhập. Địa chỉ phải là `https://`.
- Mức độ lỗi được đổi thành Priority (Highest/High/Medium/Low). Nếu dự án không cho đặt Priority khi tạo, ticket vẫn được tạo, chỉ không có Priority.

## An toàn khi dùng cho tester

- **Giao diện tiếng Việt** toàn bộ.
- **Lỗi một panel không làm sập cả app**: panel đó hiện thông báo kèm nút "Thử lại"; kịch bản và bộ test luôn được tự lưu.
- **Hỏi xác nhận trước khi chạy** nếu kịch bản hoặc bộ test có bước thay đổi dữ liệu/thiết lập: xóa dữ liệu app, thu hồi quyền, quyền đặc biệt, tắt mạng, hoặc lệnh shell có ghi/xóa. Lệnh chỉ đọc như `getprop`, `dumpsys` không bị hỏi.
- **Khóa thao tác tay trên màn hình mirror khi đang chạy test**, để tester không vô tình làm sai kết quả. Vẫn có nút "Vẫn cho phép thao tác tay".
- **Dọn báo cáo cũ**: xem dung lượng và xóa báo cáo cũ hơn N ngày (cuối panel Tự động test). Chỉ xóa trong thư mục báo cáo của ADB Kit.
- **Khi ghi thao tác**, có dòng báo "✓ Sẵn sàng" lúc lần chạm tiếp theo sẽ được gắn với phần tử. Chữ có số huy hiệu (như "5 Từ vựng") tự chuyển sang so khớp kiểu "chứa".

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `src/main/adb.ts` | tìm adb, chạy lệnh, liệt kê thiết bị |
| `src/main/scrcpy.ts` | phiên scrcpy: push server, adb forward, đọc gói video, gửi lệnh điều khiển |
| `src/main/services.ts` | logcat, shell, files, cài APK, danh sách app |
| `src/main/index.ts` | cửa sổ và các IPC handler |
| `src/main/figma.ts` | Figma REST API: token, tải trang (rút gọn, có cache), ảnh frame |
| `src/renderer/src/lib/figmaMeasure.ts` | ghép phần tử app ↔ node Figma, đo kích thước/khoảng cách, gợi ý frame |
| `src/renderer/src/components/FigmaPanel.tsx` | tab So với Figma |
| `src/main/miniapp.ts` | WebView trên máy, mở DevTools, đọc/xóa cache miniapp, mở deep link |
| `src/main/bridgeHook.ts` | script móc vào bridge Capacitor/WindVane để thấy lệnh JSAPI và `WVFetch` |
| `src/renderer/src/components/MiniAppPanel.tsx` | tab Miniapp |
| `src/main/bugquick.ts` | báo lỗi nhanh: chụp bằng chứng, ghi report.html / bug.md / zip |
| `src/renderer/src/lib/rollingVideo.ts` | quay sẵn video vòng lặp từ màn mirror |
| `src/renderer/src/components/BugDialog.tsx` | hộp thoại Báo lỗi |
| `src/main/devconf.ts` | đổi / khôi phục cấu hình máy (chế độ tối, cỡ chữ, mật độ, hiệu ứng…) |
| `src/shared/uiLint.ts` | luật soát giao diện: vùng bấm, nhãn, chữ đè/cắt, tương phản |
| `src/renderer/src/components/CheckPanel.tsx` | tab Soát UI |
| `src/main/jira.ts` | Jira REST v2: cấu hình, kiểm tra kết nối, tạo ticket + đính kèm |
| `src/renderer/src/components/JiraBox.tsx` | khung Jira trong hộp thoại Báo lỗi |
| `src/renderer/src/lib/help.ts` | nội dung hướng dẫn và các bước tour |
| `src/main/otp.ts` | đọc mã OTP mới từ thông báo |
| `src/main/appdata.ts` | SharedPreferences / SQLite / MMKV của app debug |
| `src/main/gps.ts` | vị trí GPS giả lập (Android 12+) |
| `src/main/multirun.ts` | chạy bộ test trên nhiều máy + bảng tổng hợp |
| `src/main/compare.ts` | so sánh 2 lần chạy (so-sanh.html) |
| `src/main/explore.ts` | tự khám phá app (kham-pha.html) |
| `src/main/trends.ts` | xu hướng kết quả, test chập chờn (xu-huong.html) |
| `src/main/applinks.ts` | deep link và màn hình từ manifest |
| `src/renderer/src/components/ExplorePanel.tsx`, `MapPicker.tsx` | tab Tự khám phá, bản đồ chọn vị trí |
| `src/renderer/src/components/DataPanel.tsx`, `MultiRunBox.tsx` | tab Dữ liệu, khung chạy nhiều máy |
| `src/renderer/src/components/HelpPanel.tsx`, `Tour.tsx` | tab Hướng dẫn và lớp phủ "Chỉ cho tôi" |
| `src/main/reqdoc.ts` | đọc tài liệu BA (.docx), lưu trữ, quét màn hình / điền giá trị thử, xuất KBKT |
| `src/shared/reqdoc.ts` | mô hình tài liệu, quy tắc trường, giá trị biên, sinh testcase, so màn hình với tài liệu |
| `src/shared/reqapi.ts` | đối chiếu API thật với tài liệu, kịch bản giả lập nhánh lỗi |
| `src/renderer/src/components/ReqPanel.tsx`, `ReqApiLive.tsx` | tab Tài liệu YC, phần API trên máy |
| `src/main/appstate.ts`, `src/main/tar.ts`, `src/shared/appstate.ts` | lưu / khôi phục dữ liệu app debug bằng `run-as tar` (bỏ cache, kiểm tra toàn vẹn, xuất/nhập); đọc và ghi tar không cần thư viện ngoài |
| `src/main/perflive.ts`, `src/shared/perflive.ts` | một lần đo RAM/CPU/FPS/pin cho tab Hiệu năng, nhận xét, xuất CSV |
| `src/main/push.ts`, `src/shared/push.ts` | đăng thông báo thử và mô phỏng chạm vào thông báo |
| `src/main/stress.ts`, `src/shared/stress.ts` | danh mục và cách áp dụng / khôi phục các tình huống "độ bền", lưu giá trị gốc ra file |
| `src/main/manual.ts`, `src/shared/manual.ts` | lưu bằng chứng cho kết quả test tay (ảnh, log, video, trang tóm tắt) |
| `src/renderer/src/components/StressPanel.tsx`, `ManualTestPanel.tsx`, `AppStatePanel.tsx` | giao diện ba tính năng trên |
| `src/main/freshapp.ts` | đưa app bất kỳ về trạng thái xác định trước khi test: tắt hẳn / xóa dữ liệu, rồi giữ / cấp hết / thu hồi hết quyền (dùng bởi Runner, bộ test, CLI và các nút trong tab Quyền) |
| `src/renderer/src/components/FreshOptions.tsx`, `PaneHandle.tsx` | ô chọn "Trước khi chạy / Quyền"; thanh kéo kèm nút ẩn/hiện giữa hai khung |
| `src/renderer/src/components/PanelFrame.tsx` | thanh tiêu đề chung của mọi panel (tên, mô tả, Cách dùng, đóng) |
| `src/renderer/src/lib/dialog.tsx`, `lib/a11y.ts` | hộp thoại xác nhận trong app (`ask` / `tell`); tự đặt `aria-label` cho nút chỉ có biểu tượng |
| `src/preload/index.ts` | API `window.api` cho renderer |
| `src/renderer/src/lib/control.ts` | đóng gói nhị phân các lệnh điều khiển của scrcpy |
| `src/renderer/src/lib/player.ts` | giải mã H.264 và vẽ lên canvas |
| `src/renderer/src/components/` | TopBar, ScreenView, Logcat, Files, Shell, Install |
| `resources/scrcpy-server` | server của scrcpy (Apache-2.0); phiên bản phải khớp `SCRCPY_VERSION` |

## Ghi chú

Một số máy (ví dụ Galaxy S9 / Android 10) chỉ gửi khung hình khi nội dung màn hình thay đổi.
Vì vậy app hiển thị ảnh `screencap` tạm thời cho đến khi khung video đầu tiên tới.
