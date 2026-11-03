import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export function ShellPanel({ serial }: { serial: string }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'Cascadia Mono', Consolas, monospace",
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: '#07090b', foreground: '#d7dce3', cursor: '#3ddc84', selectionBackground: '#2a4a3a' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current!)
    fit.fit()

    let exited = false
    const start = (): void => {
      exited = false
      void window.api.shell.start(serial, term.cols, term.rows)
    }
    const offData = window.api.shell.onData((d) => term.write(d))
    const offExit = window.api.shell.onExit((code) => {
      exited = true
      term.write(`\r\n\x1b[90m[shell đã thoát${code != null ? ` (mã ${code})` : ''} — nhấn Enter để mở lại]\x1b[0m\r\n`)
    })
    const input = term.onData((d) => {
      if (exited) {
        if (d === '\r') start()
        return
      }
      window.api.shell.write(d)
    })
    // Copy on selection, paste with Ctrl+Shift+V / right click (xterm handles Ctrl+V natively).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        void navigator.clipboard.writeText(term.getSelection())
        return false
      }
      return true
    })
    const ro = new ResizeObserver(() => fit.fit())
    ro.observe(host.current!)
    start()
    term.focus()

    return () => {
      ro.disconnect()
      input.dispose()
      offData()
      offExit()
      void window.api.shell.stop()
      term.dispose()
    }
  }, [serial])

  return (
    <div className="panel wide">
      <div className="panel-head">
        <span className="panel-title">adb shell — {serial}</span>
      </div>
      <div className="term" ref={host} />
    </div>
  )
}
