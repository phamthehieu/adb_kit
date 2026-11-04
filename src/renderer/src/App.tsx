import { useEffect, useRef, useState } from 'react'
import { AppWindow, Bot, Bug, Hammer, Database, FileText, HelpCircle, ScanEye, TriangleAlert, X, FolderTree, Network, Ruler, ScrollText, ShieldCheck, SquareTerminal, Smartphone, Unplug, Wifi } from 'lucide-react'
import type { DeviceDetails, DeviceInfo, InstallFlags, MirrorOptions } from '@shared/types'
import { TopBar } from './components/TopBar'
import { ScreenView } from './components/ScreenView'
import { LogcatPanel } from './components/LogcatPanel'
import { FilesPanel } from './components/FilesPanel'
import { ShellPanel } from './components/ShellPanel'
import { AutomationPanel } from './components/AutomationPanel'
import { NetworkPanel } from './components/NetworkPanel'
import { FigmaPanel } from './components/FigmaPanel'
import { MiniAppPanel } from './components/MiniAppPanel'
import { BugDialog, type BugPreset } from './components/BugDialog'
import { autoStore, recentTrail } from './lib/automation'
import { grabRolling } from './lib/rollingVideo'
import { describeStep } from '@shared/automation'
import type { CrashEvent } from '../../preload'
import { CheckPanel } from './components/CheckPanel'
import { DataPanel } from './components/DataPanel'
import { ReqPanel } from './components/ReqPanel'
import { HelpPanel } from './components/HelpPanel'
import { Tour } from './components/Tour'
import { TOPICS, type TourStep } from './lib/help'
import { PermissionsPanel } from './components/PermissionsPanel'
import { InstallPanel, type InstallRecord } from './components/InstallPanel'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Splitter } from './components/Splitter'
import { PanelFrame } from './components/PanelFrame'
import { StressPanel } from './components/StressPanel'
import { Launchpad } from './components/Launchpad'
import { DialogHost, tell } from './lib/dialog'
import { withTransition } from './lib/motion'

type Panel = 'none' | 'files' | 'logcat' | 'shell' | 'install' | 'auto' | 'net' | 'perm' | 'figma' | 'mini' | 'check' | 'help' | 'data' | 'req' | 'stress'
const LEFT_PANELS: Panel[] = ['files', 'perm']
const RIGHT_PANELS: Panel[] = ['logcat', 'shell', 'auto', 'net', 'figma', 'mini', 'check', 'help', 'data', 'req', 'stress']
type Status = { text: string; error?: boolean; path?: string } | null

/** Title bar of each tool panel: name, what it is for, and the guide topic behind "Cách dùng". */
const FRAMES: Partial<Record<Panel, { icon: React.ReactNode; title: string; desc: string; help: string }>> = {
  files: { icon: <FolderTree size={16} />, title: 'Tệp trên điện thoại', desc: 'Duyệt, tải lên, tải về, tạo thư mục, xóa', help: 'files' },
  logcat: { icon: <ScrollText size={16} />, title: 'Logcat', desc: 'Log thời gian thực, lọc theo app, mức log, từ khóa', help: 'logcat' },
  shell: { icon: <SquareTerminal size={16} />, title: 'Shell', desc: 'Chạy lệnh adb shell ngay trong app', help: 'shell' },
  net: { icon: <Network size={16} />, title: 'Mạng / API', desc: 'Xem request của app; giả lập lỗi, 500, mạng chậm', help: 'net' },
  data: { icon: <Database size={16} />, title: 'Dữ liệu', desc: 'OTP và tài khoản test, dữ liệu app, trạng thái đăng nhập đã lưu, deep link', help: 'appdata' },
  stress: { icon: <Hammer size={16} />, title: 'Độ bền', desc: 'Giết tiến trình, thiếu RAM, Doze, đổi ngôn ngữ / giờ, đầy bộ nhớ — bắt lỗi chỉ có ở máy người dùng', help: 'stress' },
  perm: { icon: <ShieldCheck size={16} />, title: 'Quyền của app', desc: 'Bật/tắt quyền, cấp hết, đưa app về như mới cài', help: 'perm' },
  mini: { icon: <AppWindow size={16} />, title: 'Miniapp', desc: 'Soi WebView, mở DevTools, miniapp đã tải, mở link nhanh', help: 'mini' },
  auto: { icon: <Bot size={16} />, title: 'Tự động test', desc: 'Ghi thao tác thành kịch bản, chạy lại, xuất báo cáo và KBKT', help: 'auto' },
  req: { icon: <FileText size={16} />, title: 'Tài liệu yêu cầu', desc: 'Đọc tài liệu BA, sinh testcase, soát màn hình theo tài liệu', help: 'req' },
  check: { icon: <ScanEye size={16} />, title: 'Soát UI', desc: 'Tự tìm lỗi giao diện; đổi chế độ tối, cỡ chữ, kích thước hiển thị', help: 'check' },
  figma: { icon: <Ruler size={16} />, title: 'So với Figma', desc: 'Đo kích thước, khoảng cách của màn hình thật so với thiết kế', help: 'figma' }
}

const DEFAULT_OPTS: MirrorOptions = { maxSize: 1280, bitRate: 8_000_000, maxFps: 60 }
const loadOpts = (): MirrorOptions => {
  try {
    return { ...DEFAULT_OPTS, ...JSON.parse(localStorage.getItem('mirror') ?? '{}') }
  } catch {
    return DEFAULT_OPTS
  }
}
const DEFAULT_FLAGS: InstallFlags = { replace: true, downgrade: false, grant: false, test: true }

export function App() {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [details, setDetails] = useState<DeviceDetails | null>(null)
  const [panel, setPanel] = useState<Panel>('none')
  const [options, setOptions] = useState<MirrorOptions>(loadOpts)
  const [status, setStatus] = useState<Status>(null)
  const [apk, setApk] = useState<string | null>(null)
  const [history, setHistory] = useState<InstallRecord[]>([])
  const [adbInfo, setAdbInfo] = useState<{ path: string; version: string } | null>(null)
  const [busyWifi, setBusyWifi] = useState(false)
  const [adbBusy, setAdbBusy] = useState(false)
  const [screenOff, setScreenOff] = useState(() => localStorage.getItem('screenOff') === '1')

  const toggleScreenOff = (): void => {
    const next = !screenOff
    localStorage.setItem('screenOff', next ? '1' : '0')
    setScreenOff(next)
    setStatus({
      text: next
        ? 'Đã tắt màn hình điện thoại — vẫn điều khiển được từ đây. Màn hình sẽ sáng lại khi dừng mirror.'
        : 'Đã bật lại màn hình điện thoại'
    })
  }

  useEffect(() => {
    void window.api.adbInfo().then(setAdbInfo)
    void window.api.listDevices().then(setDevices)
    return window.api.onDevices(setDevices)
  }, [])

  // Keep a valid selection: prefer the current one, else the first ready device.
  useEffect(() => {
    if (active && devices.some((d) => d.serial === active)) return
    setActive(devices.find((d) => d.state === 'device')?.serial ?? devices[0]?.serial ?? null)
  }, [devices, active])

  const device = devices.find((d) => d.serial === active)
  const ready = device?.state === 'device'

  useEffect(() => {
    setDetails(null)
    setStatus(null)
    if (active && ready) void window.api.details(active).then(setDetails)
  }, [active, ready])

  const changeOptions = (o: MirrorOptions): void => {
    localStorage.setItem('mirror', JSON.stringify(o))
    setOptions(o)
  }

  const install = async (path: string, flags: InstallFlags): Promise<void> => {
    if (!active) return
    const name = path.split(/[\\/]/).pop() ?? path
    const at = new Date().toLocaleTimeString()
    setHistory((h) => [{ name, ok: null, output: '', at }, ...h].slice(0, 20))
    setStatus({ text: `Đang cài ${name}…` })
    const r = await window.api.apk.install(active, path, flags)
    setHistory((h) => [{ name, ok: r.ok, output: r.output, at }, ...h.slice(1)])
    setStatus(r.ok ? { text: `Đã cài APK: ${name}` } : { text: `Cài thất bại: ${name} — ${r.output.split('\n').pop()}`, error: true })
  }

  // Files dropped on the phone: APKs get installed, anything else goes to /sdcard/Download.
  const onDropFiles = async (paths: string[]): Promise<void> => {
    if (!active) return
    const apks = paths.filter((p) => p.toLowerCase().endsWith('.apk'))
    const others = paths.filter((p) => !p.toLowerCase().endsWith('.apk'))
    for (const a of apks) await install(a, DEFAULT_FLAGS)
    if (others.length) {
      setStatus({ text: `Đang chép ${others.length} tệp vào /sdcard/Download…` })
      const r = await window.api.files.push(active, others, '/sdcard/Download')
      setStatus(r.ok ? { text: `Đã chép ${others.length} tệp vào /sdcard/Download` } : { text: r.output, error: true })
    }
  }

  const switchWifi = async (): Promise<void> => {
    if (!active) return
    setBusyWifi(true)
    setStatus({ text: 'Đang chuyển sang kết nối Wi-Fi (adb tcpip 5555)…' })
    const r = await window.api.enableWifi(active)
    setBusyWifi(false)
    setStatus({ text: r.output, error: !r.ok })
  }

  // Width of the phone column while a side panel is open (drag the splitter; null = automatic).
  const [stageW, setStageW] = useState<number | null>(() => Number(localStorage.getItem('stageW')) || null)
  const stageW0 = useRef(0)
  const startStageDrag = (): void => {
    stageW0.current = document.querySelector<HTMLElement>('.workspace > .stage')?.offsetWidth ?? 480
  }
  const dragStage = (dx: number): void => setStageW(Math.round(Math.max(300, Math.min(window.innerWidth - 380, stageW0.current + dx))))
  const saveStageW = (): void => setStageW((w) => (localStorage.setItem('stageW', String(w ?? '')), w))
  const resetStageW = (): void => {
    localStorage.removeItem('stageW')
    setStageW(null)
  }

  const [bugOpen, setBugOpen] = useState(false)
  const [bugPreset, setBugPreset] = useState<BugPreset | undefined>()

  // Background crash / ANR watch for the phone on screen: freeze the evidence the moment it
  // happens (the app restarts and the screen changes fast), then offer a prefilled bug report.
  const [crash, setCrash] = useState<{ e: CrashEvent; preset: BugPreset | null } | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    void window.api.crash.watch(ready && active ? active : null)
  }, [active, ready])
  useEffect(
    () =>
      window.api.crash.onEvent(async (e) => {
        // During a test run the runner records crashes in its own report.
        if (autoStore.get().running || e.serial !== activeRef.current) return
        const [snap, clips] = await Promise.all([window.api.bug.snap(e.serial).catch(() => null), grabRolling().catch(() => [])])
        const kind = e.type === 'anr' ? 'ANR (treo)' : e.type === 'native' ? 'Crash native' : 'Crash'
        const preset: BugPreset | null = snap
          ? {
              snap,
              clips,
              trail: recentTrail().map((t) => ({ at: t.at, text: describeStep(t.step) })),
              title: `[${kind}] ${e.pkg}: ${e.summary}`.slice(0, 160),
              actual: `App ${e.pkg} bị ${kind.toLowerCase()} lúc ${new Date(e.at).toLocaleTimeString('vi-VN')}.\n${e.summary}\n\n${e.lines.slice(0, 15).join('\n')}`
            }
          : null
        setCrash((prev) => {
          if (prev?.preset) void window.api.bug.discard(prev.preset.snap.id)
          return { e, preset }
        })
      }),
    []
  )
  // "Tạo báo lỗi" on a failed manual test case: open the bug dialog with the evidence captured now.
  useEffect(() => {
    const h = async (ev: Event): Promise<void> => {
      const d = (ev as CustomEvent<{ title: string; actual: string }>).detail
      const serial = activeRef.current
      if (!serial) return
      const [snap, clips] = await Promise.all([window.api.bug.snap(serial).catch(() => null), grabRolling().catch(() => [])])
      if (!snap) return
      setBugPreset({ snap, clips, trail: recentTrail().map((t) => ({ at: t.at, text: describeStep(t.step) })), title: d.title, actual: d.actual })
      setBugOpen(true)
    }
    window.addEventListener('adbkit:report-bug', h)
    return () => window.removeEventListener('adbkit:report-bug', h)
  }, [])
  const dismissCrash = (): void => {
    if (crash?.preset) void window.api.bug.discard(crash.preset.snap.id)
    setCrash(null)
  }
  const reportCrash = (): void => {
    if (!crash?.preset) return
    setBugPreset(crash.preset)
    setCrash(null)
    setBugOpen(true)
  }
  const [tour, setTour] = useState<TourStep[] | null>(null)
  // First launch with a phone ready: a short tour of the main screen, once.
  useEffect(() => {
    if (!ready || localStorage.getItem('tourSeen')) return
    localStorage.setItem('tourSeen', '1')
    const t = setTimeout(() => setTour(TOPICS[0].tour ?? null), 1500)
    return () => clearTimeout(t)
  }, [ready])
  // F8 anywhere = report a bug (testers keep one hand on the mouse).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F8' && ready) {
        e.preventDefault()
        setBugOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready])

  /** Panel changes shift the whole layout: animate them (morph) instead of jumping. */
  const go = (next: Panel | ((cur: Panel) => Panel)): void => withTransition(() => setPanel(next))
  const toggle = (p: Panel) => () => go((cur) => (cur === p ? 'none' : p))
  const tool = (p: Panel, icon: React.ReactNode, label: string) => (
    <button className={`iconbtn ${panel === p ? 'on' : ''}`} onClick={toggle(p)} disabled={!ready} data-tour={`tool-${p}`} title={FRAMES[p]?.desc ? `${label} — ${FRAMES[p]!.desc}` : label} aria-pressed={panel === p}>
      {icon} <span className="tl">{label}</span>
    </button>
  )
  /** Panel with its title bar (what it is, one-line purpose, "Cách dùng", close). */
  const frame = (p: Panel, node: React.ReactNode): React.ReactNode => {
    const f = FRAMES[p]!
    return (
      <PanelFrame
        key={p}
        icon={f.icon}
        title={f.title}
        desc={f.desc}
        onHelp={() => {
          localStorage.setItem('helpTopic', f.help)
          go('help')
        }}
        onClose={() => go('none')}
      >
        {node}
      </PanelFrame>
    )
  }

  return (
    <div className="app">
      <TopBar
        devices={devices}
        active={active}
        onSelect={setActive}
        options={options}
        onOptions={changeOptions}
        extra={
          <>
            {details && (
              <span
                className="devchip"
                title={`${details.manufacturer} ${details.model} · Android ${details.android} (API ${details.sdk}) · ${details.abi} · ${details.screen} · Pin ${details.battery}`}
              >
                Android {details.android} · Pin {details.battery}
              </span>
            )}
            {device?.transport === 'usb' && ready && (
              <button className="iconbtn" disabled={busyWifi} onClick={switchWifi} title="Chuyển sang kết nối Wi-Fi (adb tcpip 5555 — mở cổng 5555 trên mạng nội bộ), để rút cáp mà vẫn điều khiển được">
                <Wifi size={14} /> <span className="tl">Chuyển sang Wi-Fi</span>
              </button>
            )}
            {device?.transport === 'wifi' && (
              <button className="iconbtn" onClick={() => void window.api.disconnect(device.serial)} title="Ngắt kết nối Wi-Fi với điện thoại">
                <Unplug size={14} /> <span className="tl">Ngắt kết nối</span>
              </button>
            )}
          </>
        }
      />

      <div className="toolbar" role="toolbar" aria-label="Công cụ">
        <div className="tgroup" role="group" aria-label="Điện thoại">
          <span className="tg-cap">Điện thoại</span>
          {tool('files', <FolderTree size={14} />, 'Tệp')}
          {tool('logcat', <ScrollText size={14} />, 'Logcat')}
          {tool('shell', <SquareTerminal size={14} />, 'Shell')}
        </div>
        <div className="tgroup" role="group" aria-label="Gỡ lỗi">
          <span className="tg-cap">Gỡ lỗi</span>
          {tool('net', <Network size={14} />, 'Mạng / API')}
          {tool('data', <Database size={14} />, 'Dữ liệu')}
          {tool('perm', <ShieldCheck size={14} />, 'Quyền')}
          {tool('mini', <AppWindow size={14} />, 'Miniapp')}
        </div>
        <div className="tgroup" role="group" aria-label="Kiểm thử">
          <span className="tg-cap">Kiểm thử</span>
          {tool('auto', <Bot size={14} />, 'Tự động test')}
          {tool('req', <FileText size={14} />, 'Tài liệu YC')}
          {tool('stress', <Hammer size={14} />, 'Độ bền')}
          {tool('check', <ScanEye size={14} />, 'Soát UI')}
          {tool('figma', <Ruler size={14} />, 'So với Figma')}
        </div>
        <span className="spacer" />
        <button
          className={`iconbtn ${panel === 'help' ? 'on' : ''}`}
          data-tour="tool-help"
          onClick={toggle('help')}
          title="Hướng dẫn sử dụng từng tính năng, có chế độ chỉ trực tiếp vào các nút"
          aria-pressed={panel === 'help'}
        >
          <HelpCircle size={14} /> <span className="tl">Hướng dẫn</span>
        </button>
        <button className="iconbtn bug-btn" data-tour="bug" disabled={!ready} onClick={() => setBugOpen(true)} title="Báo lỗi ngay: lưu ảnh, video vừa rồi, log, API và các thao tác (F8)">
          <Bug size={14} /> Báo lỗi <kbd>F8</kbd>
        </button>
      </div>

      <div className="workspace">
        {panel === 'help' && !ready ? (
          // The guide is readable even before a phone is connected.
          <ErrorBoundary key="help-full" name="Hướng dẫn" className="panel wide">
            <HelpPanel onTour={(t) => setTour(t.tour ?? null)} />
          </ErrorBoundary>
        ) : adbInfo?.version === 'not found' ? (
          <div className="empty">
            <Smartphone size={44} className="big" />
            <h2>Máy này chưa có adb</h2>
            <p>
              ADB Kit cần công cụ <b>adb</b> (Android Platform Tools) để nói chuyện với điện thoại.
              <br />
              Có thể tải bản chính thức từ Google (~7 MB) về thư mục riêng của ADB Kit; không cần cài Android SDK.
            </p>
            <button
              className="iconbtn primary"
              disabled={adbBusy}
              onClick={async () => {
                setAdbBusy(true)
                try {
                  setAdbInfo(await window.api.installAdb())
                } catch (e) {
                  setStatus({ text: `Không tải được adb: ${(e as Error).message}`, error: true })
                  void tell(`Không tải được adb.\n\n${(e as Error).message}`, { title: 'Tải adb' })
                } finally {
                  setAdbBusy(false)
                }
              }}
            >
              {adbBusy ? 'Đang tải…' : 'Tải adb từ Google'}
            </button>
          </div>
        ) : !device ? (
          <div className="empty">
            <Smartphone size={44} className="big" />
            <h2>Chưa có thiết bị nào được kết nối</h2>
            <ol>
              <li>Trên điện thoại: Cài đặt → Thông tin điện thoại → bấm <b>Số hiệu bản tạo</b> 7 lần</li>
              <li>Tùy chọn nhà phát triển → bật <b>Gỡ lỗi USB</b></li>
              <li>Cắm cáp và bấm <b>Cho phép</b> ở hộp thoại “Cho phép gỡ lỗi USB?”</li>
              <li>Hoặc bấm <b>+</b> ở trên để kết nối qua Wi-Fi</li>
            </ol>
            <div className="empty-actions">
              <button
                className="iconbtn primary"
                onClick={() => {
                  localStorage.setItem('helpTopic', 'start')
                  go('help')
                }}
              >
                <HelpCircle size={14} /> Xem hướng dẫn kết nối chi tiết
              </button>
            </div>
          </div>
        ) : !ready ? (
          <div className="empty">
            <Smartphone size={44} className="big" />
            <h2>{device.model} đang ở trạng thái “{device.state}”</h2>
            <p>
              {device.state === 'unauthorized'
                ? 'Mở khóa điện thoại và bấm Cho phép ở hộp thoại “Cho phép gỡ lỗi USB?”.'
                : 'Đang chờ thiết bị sẵn sàng…'}
            </p>
          </div>
        ) : (
          <>
            {/* Files / Quyền / Install open on the left of the phone; the others on the right. */}
            {panel === 'files' && frame('files', <ErrorBoundary key="files" name="Panel Tệp" className="panel wide"><FilesPanel serial={device.serial} /></ErrorBoundary>)}
            {panel === 'perm' && frame('perm', <ErrorBoundary key="perm" name="Panel Quyền" className="panel wide"><PermissionsPanel serial={device.serial} /></ErrorBoundary>)}
            {panel === 'install' && (
              <ErrorBoundary key="install" name="Panel Cài APK" className="panel narrow">
                <InstallPanel apk={apk} setApk={setApk} history={history} onInstall={install} />
              </ErrorBoundary>
            )}
            {LEFT_PANELS.includes(panel) && <Splitter onStart={startStageDrag} onDrag={(dx) => dragStage(-dx)} onEnd={saveStageW} onReset={resetStageW} />}
            <ErrorBoundary name="Màn hình điện thoại" className="stage">
              <ScreenView
                serial={device.serial}
                options={options}
                width={panel !== 'none' && panel !== 'install' ? (stageW ?? undefined) : undefined}
                compact={panel !== 'none' && panel !== 'install'}
                screenOff={screenOff}
                onToggleScreenOff={toggleScreenOff}
                status={status}
                onStatus={setStatus}
                onOpenInstall={toggle('install')}
                onDropFiles={onDropFiles}
              />
            </ErrorBoundary>
            {panel === 'none' && (
              <Launchpad
                onOpen={(p, prefs) => {
                  for (const [k, v] of Object.entries(prefs ?? {})) localStorage.setItem(k, v)
                  go(p as Panel)
                }}
              />
            )}
            {RIGHT_PANELS.includes(panel) && <Splitter onStart={startStageDrag} onDrag={dragStage} onEnd={saveStageW} onReset={resetStageW} />}
            {panel === 'logcat' && frame('logcat', <ErrorBoundary key="logcat" name="Panel Logcat" className="panel wide"><LogcatPanel serial={device.serial} /></ErrorBoundary>)}
            {panel === 'shell' && frame('shell', <ErrorBoundary key="shell" name="Panel Shell" className="panel wide"><ShellPanel serial={device.serial} /></ErrorBoundary>)}
            {panel === 'auto' && frame('auto', <ErrorBoundary key="auto" name="Panel Tự động test" className="panel wide"><AutomationPanel serial={device.serial} /></ErrorBoundary>)}
            {panel === 'net' && frame('net', <ErrorBoundary key="net" name="Panel Mạng / API" className="panel wide"><NetworkPanel serial={device.serial} /></ErrorBoundary>)}
            {panel === 'figma' && frame('figma', <ErrorBoundary key="figma" name="Panel So với Figma" className="panel wide"><FigmaPanel serial={device.serial} /></ErrorBoundary>)}
            {panel === 'help' && (
              <ErrorBoundary key="help" name="Hướng dẫn" className="panel wide">
                <HelpPanel onTour={(t) => setTour(t.tour ?? null)} />
              </ErrorBoundary>
            )}
            {panel === 'data' && frame('data', <ErrorBoundary key="data" name="Panel Dữ liệu" className="panel wide"><DataPanel serial={device.serial} /></ErrorBoundary>)}
            {panel === 'req' && frame('req', <ErrorBoundary key="req" name="Panel Tài liệu yêu cầu" className="panel wide"><ReqPanel serial={device.serial} /></ErrorBoundary>)}
            {panel === 'stress' && frame('stress', <ErrorBoundary key="stress" name="Panel Độ bền" className="panel wide"><StressPanel serial={device.serial} /></ErrorBoundary>)}
            {panel === 'check' && frame('check', <ErrorBoundary key="check" name="Panel Soát UI" className="panel wide"><CheckPanel serial={device.serial} /></ErrorBoundary>)}
            {panel === 'mini' &&
              frame(
                'mini',
                <ErrorBoundary key="mini" name="Panel Miniapp" className="panel wide">
                  <MiniAppPanel
                    serial={device.serial}
                    onWatchNetwork={(pkg) => {
                      localStorage.setItem('netPkg', pkg)
                      go('net')
                    }}
                  />
                </ErrorBoundary>
              )}
          </>
        )}
      </div>

      <DialogHost />

      {tour && (
        <Tour
          steps={tour}
          onPanel={(p) => go(p === 'none' ? 'none' : (p as Panel))}
          onClose={() => setTour(null)}
        />
      )}

      {bugOpen && device && ready && (
        <ErrorBoundary name="Báo lỗi" className="bug-backdrop">
          <BugDialog
            serial={device.serial}
            preset={bugPreset}
            onClose={() => {
              setBugOpen(false)
              setBugPreset(undefined)
            }}
          />
        </ErrorBoundary>
      )}

      {crash && (
        <div className="crash-toast" role="alert">
          <TriangleAlert size={18} />
          <div className="ct-body">
            <b>
              {crash.e.type === 'anr' ? 'App bị treo (ANR)' : 'App vừa bị crash'}: {crash.e.pkg}
            </b>
            <span title={crash.e.summary}>{crash.e.summary}</span>
            <span className="muted">
              {crash.preset ? 'Đã lưu ảnh, video vừa rồi, log và crash — tạo báo cáo ngay?' : 'Không chụp được bằng chứng (máy đang khóa?)'}
            </span>
          </div>
          {crash.preset && (
            <button className="iconbtn primary" onClick={reportCrash}>
              <Bug size={13} /> Tạo báo cáo lỗi
            </button>
          )}
          <button className="iconbtn ghost" onClick={dismissCrash} title="Bỏ qua">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="footer">
        <span>Chạy hoàn toàn trên máy này — dữ liệu thiết bị không gửi đi đâu.</span>
        <span className="spacer" />
        <span>Kéo APK vào màn hình để cài · chuột phải = Back · chuột giữa = Home · Ctrl+V để dán</span>
        <span>adb {adbInfo?.version ?? '…'} · scrcpy-server 5.0.1</span>
      </div>
    </div>
  )
}
