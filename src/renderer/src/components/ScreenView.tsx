import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bell,
  Camera,
  ChevronLeft,
  Circle,
  Loader2,
  MonitorOff,
  PackagePlus,
  Power,
  RefreshCw,
  RotateCw,
  Square,
  Video,
  Volume1,
  Volume2
} from 'lucide-react'
import type { MirrorOptions, MirrorStatus } from '@shared/types'
import { H264Player } from '../lib/player'
import { Action, Key, Msg, displayPower, scroll, sendKey as rawSendKey, setClipboard, simple, text, touch } from '../lib/control'
import { autoStore, emitAction, inspectAt, record, useAutoState } from '../lib/automation'
import { MaskLayer } from './MaskLayer'
import { attachRolling, detachRolling } from '../lib/rollingVideo'

const KEY_NAMES: Record<number, string> = {
  [Key.HOME]: 'Home',
  [Key.BACK]: 'Back',
  [Key.APP_SWITCH]: 'Recent apps',
  [Key.POWER]: 'Power',
  [Key.VOLUME_UP]: 'Volume up',
  [Key.VOLUME_DOWN]: 'Volume down',
  [Key.ENTER]: 'Enter',
  [Key.DEL]: 'Backspace',
  [Key.FORWARD_DEL]: 'Delete',
  [Key.TAB]: 'Tab',
  [Key.DPAD_UP]: 'Up',
  [Key.DPAD_DOWN]: 'Down',
  [Key.DPAD_LEFT]: 'Left',
  [Key.DPAD_RIGHT]: 'Right',
  [Key.MOVE_HOME]: 'Move home',
  [Key.MOVE_END]: 'Move end',
  [Key.PAGE_UP]: 'Page up',
  [Key.PAGE_DOWN]: 'Page down'
}

/** Send a key and, when recording, add it to the script. */
function sendKey(code: number): void {
  rawSendKey(code)
  emitAction()
  record({ type: 'key', code, name: KEY_NAMES[code] ?? `Key ${code}` })
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000

type Status = { text: string; error?: boolean; path?: string } | null

interface Props {
  serial: string
  options: MirrorOptions
  /** A side panel is open: keep the phone column narrow (unless landscape). */
  compact: boolean
  /** Column width chosen with the splitter (px), only while compact. */
  width?: number
  screenOff: boolean
  onToggleScreenOff: () => void
  status: Status
  onStatus: (s: Status) => void
  onOpenInstall: () => void
  onDropFiles: (paths: string[]) => void
}

// Keys forwarded as Android keycodes (everything printable goes through text injection).
const KEYMAP: Record<string, number> = {
  Enter: Key.ENTER,
  Backspace: Key.DEL,
  Delete: Key.FORWARD_DEL,
  Tab: Key.TAB,
  Escape: Key.BACK,
  ArrowUp: Key.DPAD_UP,
  ArrowDown: Key.DPAD_DOWN,
  ArrowLeft: Key.DPAD_LEFT,
  ArrowRight: Key.DPAD_RIGHT,
  Home: Key.MOVE_HOME,
  End: Key.MOVE_END,
  PageUp: Key.PAGE_UP,
  PageDown: Key.PAGE_DOWN
}

const BEZEL = 6 // .phone padding, px
const SIDES = 2 * (30 + 12) // two button columns + gaps beside the phone, px

export function ScreenView(props: Props) {
  const { serial, options, compact, width, screenOff, onToggleScreenOff, status, onStatus, onOpenInstall, onDropFiles } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<H264Player | null>(null)
  const pressed = useRef(false)
  const [mirror, setMirror] = useState<MirrorStatus>({ state: 'idle' })
  const [hasFrame, setHasFrame] = useState(false)
  const [fps, setFps] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [restartKey, setRestartKey] = useState(0)
  const [dims, setDims] = useState({ w: 1080, h: 2220 }) // device stream size
  const [box, setBox] = useState({ w: 0, h: 0 }) // space available for the phone
  const [rotating, setRotating] = useState(false)
  const auto = useAutoState()
  /** Manual input is locked while a test drives the device (unless the tester allowed it). */
  const locked = auto.running && !auto.unlocked

  // Latest values for callbacks that live inside the long-running effect.
  const screenOffRef = useRef(screenOff)
  screenOffRef.current = screenOff
  const dimsRef = useRef(dims)
  dimsRef.current = dims

  /** Re-apply "display off" — Android turns the panel back on after power key, rotation, etc. */
  const reapplyScreenOff = useCallback((delay = 400) => {
    if (!screenOffRef.current) return
    window.setTimeout(() => {
      if (screenOffRef.current) window.api.mirror.control(displayPower(false))
    }, delay)
  }, [])

  // Start mirroring whenever the device or the stream options change.
  useEffect(() => {
    const canvas = canvasRef.current!
    setHasFrame(false)
    const player = new H264Player(
      canvas,
      (w, h) => {
        setDims({ w, h })
        reapplyScreenOff() // a new session (rotation, encoder reset) may have lit the panel
      },
      () => setHasFrame(true)
    )
    playerRef.current = player
    attachRolling(canvas) // replay buffer for quick bug reports
    const offVideo = window.api.mirror.onVideo((p) => player.push(p))
    let alive = true
    let stillTimer = 0
    const offStatus = window.api.mirror.onStatus((s) => {
      setMirror(s)
      if (s.state !== 'running') return
      reapplyScreenOff(0)
      // Some encoders emit nothing until the screen changes; show a screencap meanwhile.
      stillTimer = window.setTimeout(async () => {
        if (!alive || player.hasVideo) return
        try {
          const png = await window.api.screencap(serial)
          const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
          if (alive && !player.hasVideo) {
            player.showStill(bmp)
            setHasFrame(true)
          }
          bmp.close()
        } catch {
          /* keep waiting for the stream */
        }
      }, 600)
    })
    void window.api.mirror.start(serial, options)
    const t = setInterval(() => setFps(player.fps), 1000)
    return () => {
      alive = false
      clearTimeout(stillTimer)
      clearInterval(t)
      offVideo()
      offStatus()
      detachRolling()
      player.dispose()
      playerRef.current = null
      void window.api.mirror.stop() // scrcpy-server turns the display back on when it exits
    }
  }, [serial, options.maxSize, options.bitRate, options.maxFps, restartKey, reapplyScreenOff])

  // Toggling the setting while mirroring.
  useEffect(() => {
    if (mirror.state === 'running') window.api.mirror.control(displayPower(!screenOff))
  }, [screenOff]) // eslint-disable-line react-hooks/exhaustive-deps

  // Track the space available so the phone always fits, portrait or landscape.
  useEffect(() => {
    const el = boxRef.current!
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scale = box.w && box.h ? Math.min((box.w - SIDES - 2 * BEZEL) / dims.w, (box.h - 2 * BEZEL) / dims.h) : 0
  const cssW = Math.max(0, Math.floor(dims.w * scale))
  const cssH = Math.max(0, Math.floor(dims.h * scale))
  const landscape = dims.w > dims.h

  // Report orientation changes (from the rotate button or the device itself).
  const prevLandscape = useRef(landscape)
  useEffect(() => {
    if (prevLandscape.current === landscape) return
    prevLandscape.current = landscape
    onStatus({ text: `Màn hình đang ${landscape ? 'nằm ngang' : 'dọc'}` })
  }, [landscape]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------------------ input */

  const toDevice = useCallback((e: { clientX: number; clientY: number }) => {
    const p = playerRef.current
    const c = canvasRef.current
    if (!p || !c || !p.width) return null
    const r = c.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * p.width
    const y = ((e.clientY - r.top) / r.height) * p.height
    return { x: Math.max(0, Math.min(p.width - 1, x)), y: Math.max(0, Math.min(p.height - 1, y)), w: p.width, h: p.height }
  }, [])

  const gesture = useRef<{ x: number; y: number; t: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    e.currentTarget.parentElement?.focus()
    if (e.button === 2) return sendKey(Key.BACK) // right click = back (like scrcpy)
    if (e.button === 1) return sendKey(Key.HOME) // middle click = home
    if (e.button !== 0) return
    const d = toDevice(e)
    if (!d) return
    // Inspector: pick, don't touch. Alt + click still reaches the phone (to navigate while inspecting).
    if (auto.inspecting && !e.altKey) return inspectAt(d.x / d.w, d.y / d.h)
    pressed.current = true
    gesture.current = { x: d.x / d.w, y: d.y / d.h, t: performance.now() }
    e.currentTarget.setPointerCapture(e.pointerId)
    window.api.mirror.control(touch(Action.Down, d.x, d.y, d.w, d.h))
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!pressed.current) return
    const d = toDevice(e)
    if (d) window.api.mirror.control(touch(Action.Move, d.x, d.y, d.w, d.h))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!pressed.current) return
    pressed.current = false
    const d = toDevice(e)
    if (!d) return
    window.api.mirror.control(touch(Action.Up, d.x, d.y, d.w, d.h))
    emitAction()
    // Turn the finished gesture into a script step.
    const g = gesture.current
    gesture.current = null
    if (!g) return
    const x = d.x / d.w
    const y = d.y / d.h
    const ms = Math.round(performance.now() - g.t)
    const moved = Math.hypot((x - g.x) * d.w, (y - g.y) * d.h) > Math.min(d.w, d.h) * 0.03
    if (moved) record({ type: 'swipe', x1: r3(g.x), y1: r3(g.y), x2: r3(x), y2: r3(y), ms: Math.min(3000, Math.max(60, ms)) })
    else if (ms >= 500) record({ type: 'longpress', x: r3(g.x), y: r3(g.y), ms: Math.min(5000, ms) })
    else record({ type: 'tap', x: r3(g.x), y: r3(g.y) })
  }
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>): void => {
    const d = toDevice(e)
    if (!d) return
    const unit = e.deltaMode === 1 ? 3 : 100 // lines vs pixels per notch
    window.api.mirror.control(scroll(d.x, d.y, d.w, d.h, -e.deltaX / unit, -e.deltaY / unit))
    emitAction()
    const dy = Math.round(-e.deltaY / unit)
    if (dy) record({ type: 'scroll', x: r3(d.x / d.w), y: r3(d.y / d.h), dy })
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (locked) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      e.preventDefault()
      void navigator.clipboard.readText().then((t) => {
        if (!t) return
        window.api.mirror.control(setClipboard(t, true))
        record({ type: 'text', text: t })
      })
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const code = KEYMAP[e.key]
    if (code !== undefined) {
      e.preventDefault()
      sendKey(code)
    } else if (e.key.length === 1) {
      e.preventDefault()
      window.api.mirror.control(text(e.key))
      emitAction()
      record({ type: 'text', text: e.key })
    }
  }

  /* ------------------------------------------------------------ actions */

  const screenshot = async (): Promise<void> => {
    onStatus({ text: 'Đang chụp màn hình…' })
    try {
      const path = await window.api.screenshot(serial)
      onStatus({ text: `Đã lưu ảnh: ${path}`, path })
    } catch (err) {
      onStatus({ text: `Chụp màn hình thất bại: ${(err as Error).message}`, error: true })
    }
  }

  // Manual recording with the phone's own screenrecord (full resolution MP4).
  const [recAt, setRecAt] = useState(0)
  const [recBusy, setRecBusy] = useState(false)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!recAt) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [recAt])
  const toggleRec = async (): Promise<void> => {
    setRecBusy(true)
    try {
      if (!recAt) {
        setRecAt(await window.api.rec.start(serial))
        onStatus({ text: 'Đang quay màn hình… bấm lại nút quay để dừng' })
      } else {
        setRecAt(0)
        onStatus({ text: 'Đang lưu video…' })
        const path = await window.api.rec.stop()
        if (path) onStatus({ text: `Đã lưu video: ${path}`, path })
      }
    } catch (err) {
      setRecAt(0)
      onStatus({ text: `Quay video lỗi: ${(err as Error).message}`, error: true })
    } finally {
      setRecBusy(false)
    }
  }
  const recSec = recAt ? Math.floor((Date.now() - recAt) / 1000) : 0

  const rotate = async (): Promise<void> => {
    if (rotating) return
    setRotating(true)
    const before = dimsRef.current
    const target = before.w > before.h ? 'dọc' : 'ngang'
    const wasAuto = await window.api.disableAutoRotate(serial)
    window.api.mirror.control(simple(Msg.RotateDevice))
    onStatus({ text: `Đang xoay sang ${target}…` })
    // The stream reports the new size via a session packet; check whether it actually changed.
    window.setTimeout(() => {
      setRotating(false)
      const now = dimsRef.current
      const changed = now.w > now.h !== before.w > before.h
      const auto = wasAuto ? ' (đã tắt tự động xoay)' : ''
      onStatus(
        changed
          ? { text: `Đã xoay sang ${target}${auto}` }
          : {
              text: `Đã yêu cầu xoay ${target}, nhưng màn hình/app hiện tại bị khóa chiều ${target === 'ngang' ? 'dọc' : 'ngang'} (vd. màn hình chính). Sẽ có tác dụng ở app cho phép xoay.${auto}`,
              error: true
            }
      )
    }, 1800)
  }

  const power = (): void => {
    sendKey(Key.POWER)
    reapplyScreenOff(700) // pressing power lights the panel; keep it dark if requested
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const paths = Array.from(e.dataTransfer.files).map((f) => window.api.pathForFile(f)).filter(Boolean)
    if (paths.length) onDropFiles(paths)
  }

  const running = mirror.state === 'running' || hasFrame
  const ctl = (type: Msg) => () => window.api.mirror.control(simple(type))

  return (
    <div
      className={`stage ${compact ? (landscape ? 'compact-land' : 'compact') : ''}`}
      style={compact && width ? { flex: '0 0 auto', width } : undefined}
    >
      {running && (
        <div className="fps">
          {screenOff && <span className="badge">màn hình máy đang tắt</span>}
          {fps > 0 ? `${fps} fps` : 'đứng yên'}
        </div>
      )}
      <div className="screen-box" ref={boxRef}>
        <div className="side">
          <button className="iconbtn" title="Cài APK" onClick={onOpenInstall}><PackagePlus size={15} /></button>
          <button className="iconbtn" title="Chụp màn hình" onClick={screenshot}><Camera size={15} /></button>
          <button
            className={`iconbtn ${recAt ? 'rec-on' : ''}`}
            title={recAt ? 'Dừng quay và lưu video' : 'Quay video màn hình (MP4, lưu vào Videos › ADB Kit)'}
            disabled={recBusy}
            onClick={() => void toggleRec()}
          >
            {recBusy ? <Loader2 size={15} className="spin" /> : <Video size={15} />}
          </button>
          <button className="iconbtn" title="Kéo thanh thông báo" disabled={locked} onClick={ctl(Msg.ExpandNotifications)}><Bell size={15} /></button>
        </div>

          <div
            className={`phone ${dragOver ? 'drop' : ''} ${auto.inspecting ? 'inspecting' : ''} ${auto.recording ? 'recording' : ''}`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <canvas
              ref={canvasRef}
              width={1080}
              height={2220}
              style={{ width: cssW, height: cssH }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
              onContextMenu={(e) => e.preventDefault()}
              onAuxClick={(e) => e.preventDefault()}
            />
            {auto.highlight && (
              <div
                className="hl"
                style={{
                  left: BEZEL + auto.highlight[0] * cssW,
                  top: BEZEL + auto.highlight[1] * cssH,
                  width: (auto.highlight[2] - auto.highlight[0]) * cssW,
                  height: (auto.highlight[3] - auto.highlight[1]) * cssH
                }}
              />
            )}
            {auto.recording && <div className="rec-badge">● REC</div>}
            {recAt > 0 && (
              <div className="rec-badge video">
                ● QUAY {Math.floor(recSec / 60)}:{String(recSec % 60).padStart(2, '0')}
              </div>
            )}
            {auto.maskEdit && (
              <MaskLayer key={auto.maskEdit.index} initial={auto.maskEdit.masks} left={BEZEL} top={BEZEL} width={cssW} height={cssH} />
            )}
            {auto.activeCutout && (
              <div className={`screen-cutout cutout-${auto.activeCutout.replace('cutout_', '')}`} />
            )}
            {locked && (
              // Blocks taps / scrolls on the mirror while a test drives the device.
              <div className="input-lock" onPointerDown={(e) => e.preventDefault()} onWheel={(e) => e.preventDefault()}>
                <b>Đang chạy test</b>
                <span>Thao tác tay trên màn hình đã bị khóa để không làm sai kết quả.</span>
                <button className="iconbtn" onClick={() => autoStore.set({ unlocked: true })}>
                  Vẫn cho phép thao tác tay
                </button>
              </div>
            )}
            {!hasFrame && (
              <div className="overlay">
                {mirror.state === 'error' ? (
                  <>
                    <b>Mirror đã dừng</b>
                    <pre>{mirror.message}</pre>
                    <button className="iconbtn" onClick={() => setRestartKey((k) => k + 1)}>
                      <RefreshCw size={13} /> Thử lại
                    </button>
                  </>
                ) : (
                  <>
                    <Loader2 size={22} className="spin" />
                    <span>Đang khởi động mirror…</span>
                  </>
                )}
              </div>
            )}
          </div>

        <div className="side">
          <button className="iconbtn" title="Nút nguồn" disabled={locked} onClick={power}><Power size={15} /></button>
          <button className="iconbtn" title="Tăng âm lượng" disabled={locked} onClick={() => sendKey(Key.VOLUME_UP)}><Volume2 size={15} /></button>
          <button className="iconbtn" title="Giảm âm lượng" disabled={locked} onClick={() => sendKey(Key.VOLUME_DOWN)}><Volume1 size={15} /></button>
          <button className="iconbtn" title="Xoay màn hình (dọc ⇄ ngang)" disabled={rotating || locked} onClick={rotate}>
            <RotateCw size={15} className={rotating ? 'spin' : ''} />
          </button>
          <button
            className={`iconbtn ${screenOff ? 'on' : ''}`}
            title={screenOff ? 'Màn hình điện thoại đang tắt — bấm để bật lại' : 'Tắt màn hình điện thoại, vẫn điều khiển từ đây'}
            onClick={onToggleScreenOff}
          >
            <MonitorOff size={15} />
          </button>
        </div>
      </div>

      <div className="navbar">
        <button className="iconbtn ghost" title="Quay lại (chuột phải)" disabled={locked} onClick={() => sendKey(Key.BACK)}><ChevronLeft size={16} /></button>
        <button className="iconbtn ghost" title="Màn hình chính (chuột giữa)" disabled={locked} onClick={() => sendKey(Key.HOME)}><Circle size={13} /></button>
        <button className="iconbtn ghost" title="Ứng dụng gần đây" disabled={locked} onClick={() => sendKey(Key.APP_SWITCH)}><Square size={12} /></button>
      </div>
      <div className={`status-line ${status?.error ? 'err' : ''}`} title={status?.text}>
        {status &&
          (status.path ? (
            <a onClick={() => window.api.reveal(status.path!)}>{status.text}</a>
          ) : (
            status.text
          ))}
      </div>
    </div>
  )
}
