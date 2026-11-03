import { useState } from 'react'
import { FileUp, Loader2, PackagePlus } from 'lucide-react'
import type { InstallFlags } from '@shared/types'

export interface InstallRecord {
  name: string
  ok: boolean | null // null = in progress
  output: string
  at: string
}

interface Props {
  apk: string | null
  setApk: (p: string | null) => void
  history: InstallRecord[]
  onInstall: (path: string, flags: InstallFlags) => void
}

export function InstallPanel({ apk, setApk, history, onInstall }: Props) {
  const [flags, setFlags] = useState<InstallFlags>({ replace: true, downgrade: false, grant: false, test: true })
  const [over, setOver] = useState(false)
  const busy = history[0]?.ok === null
  const flag = (k: keyof InstallFlags, label: string) => (
    <label className="check">
      <input type="checkbox" checked={flags[k]} onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })} /> {label}
    </label>
  )

  return (
    <div className="panel narrow">
      <div className="panel-head">
        <span className="panel-title">Cài APK</span>
      </div>
      <div className="panel-body install">
        <div
          className={`drop ${over ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            const f = e.dataTransfer.files[0]
            if (f) setApk(window.api.pathForFile(f))
          }}
        >
          <FileUp size={20} />
          <span>Kéo file .apk vào đây</span>
          <button className="iconbtn" onClick={() => void window.api.apk.pick().then((p) => p && setApk(p))}>
            Chọn APK…
          </button>
        </div>
        {apk && <div className="apkname">{apk.split(/[\\/]/).pop()}</div>}
        {flag('replace', 'Ghi đè app đang có (-r)')}
        {flag('downgrade', 'Cho phép hạ phiên bản (-d)')}
        {flag('grant', 'Cấp sẵn mọi quyền runtime (-g)')}
        {flag('test', 'Cho phép APK chỉ để test (-t)')}
        <button className="iconbtn primary" disabled={!apk || busy} onClick={() => apk && onInstall(apk, flags)}>
          {busy ? <Loader2 size={13} className="spin" /> : <PackagePlus size={13} />} Cài đặt
        </button>

        {history.length > 0 && <div className="panel-title" style={{ marginTop: 6 }}>Gần đây</div>}
        <div className="history">
          {history.map((h, i) => (
            <div key={i} className="hist">
              <div className="h">
                <span>{h.name}</span>
                <span className={h.ok === null ? '' : h.ok ? 'ok' : 'bad'}>{h.ok === null ? 'đang cài…' : h.ok ? 'đã cài' : 'thất bại'}</span>
              </div>
              {h.output && <div className="o">{h.output}</div>}
              <div className="o">{h.at}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
