import { useCallback, useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Download,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
  Upload
} from 'lucide-react'
import type { FileEntry } from '@shared/types'

interface DirState {
  loading: boolean
  entries: FileEntry[]
  error?: string
}

const ROOTS = [
  { label: 'Bộ nhớ trong', path: '/sdcard' },
  { label: 'Tải xuống', path: '/sdcard/Download' },
  { label: 'Gốc (/)', path: '/' }
]

const join = (dir: string, name: string): string => (dir.endsWith('/') ? dir + name : `${dir}/${name}`)
const parent = (p: string): string => p.replace(/\/[^/]+\/?$/, '') || '/'

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function FilesPanel({ serial }: { serial: string }) {
  const [root, setRoot] = useState(ROOTS[0].path)
  const [dirs, setDirs] = useState<Record<string, DirState>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<{ path: string; entry?: FileEntry } | null>(null)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [newFolder, setNewFolder] = useState<string | null>(null)
  const [over, setOver] = useState(false)

  const load = useCallback(
    async (path: string) => {
      setDirs((d) => ({ ...d, [path]: { loading: true, entries: d[path]?.entries ?? [] } }))
      const r = await window.api.files.list(serial, path)
      setDirs((d) => ({ ...d, [path]: { loading: false, entries: r.entries, error: r.error } }))
    },
    [serial]
  )

  useEffect(() => {
    setDirs({})
    setOpen(new Set([root]))
    setSel({ path: root })
    void load(root)
  }, [root, load])

  const toggle = (path: string): void => {
    const next = new Set(open)
    if (next.has(path)) next.delete(path)
    else {
      next.add(path)
      if (!dirs[path]) void load(path)
    }
    setOpen(next)
  }

  const isDirLike = (e?: FileEntry): boolean => !e || e.type === 'dir' || e.type === 'link'
  // Target folder for uploads / new folders: the selected folder, or the selected file's folder.
  const targetDir = sel ? (isDirLike(sel.entry) ? sel.path : parent(sel.path)) : root

  const run = async (label: string, fn: () => Promise<{ ok: boolean; output: string } | null>, refresh?: string): Promise<void> => {
    setBusy(true)
    setMsg({ text: `${label}…` })
    try {
      const r = await fn()
      if (r) setMsg({ text: r.ok ? `${label}: xong` : `${label} thất bại: ${r.output}`, error: !r.ok })
      else setMsg(null)
      if (refresh) await load(refresh)
    } finally {
      setBusy(false)
    }
  }

  const upload = (): Promise<void> => run('Tải lên', () => window.api.files.pickAndPush(serial, targetDir), targetDir)
  const download = (): Promise<void> | undefined =>
    sel?.entry ? run('Tải về', () => window.api.files.pull(serial, sel.path, sel.entry!.type === 'dir')) : undefined
  const remove = (): void => {
    if (!sel?.entry) return
    if (!confirm(`Xóa "${sel.path}" trên thiết bị? Không thể hoàn tác.`)) return
    const dir = parent(sel.path)
    void run('Xóa', () => window.api.files.remove(serial, sel.path), dir).then(() => setSel({ path: dir }))
  }
  const createFolder = (): void => {
    const name = newFolder?.trim()
    setNewFolder(null)
    if (!name) return
    void run('Tạo thư mục', () => window.api.files.mkdir(serial, join(targetDir, name)), targetDir)
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setOver(false)
    const paths = Array.from(e.dataTransfer.files).map((f) => window.api.pathForFile(f)).filter(Boolean)
    if (paths.length) void run(`Tải ${paths.length} mục lên ${targetDir}`, () => window.api.files.push(serial, paths, targetDir), targetDir)
  }

  const renderDir = (path: string, depth: number): React.ReactNode[] => {
    const st = dirs[path]
    if (!st) return []
    const out: React.ReactNode[] = []
    if (st.error)
      out.push(
        <div key={path + ':err'} className="trow err" style={{ paddingLeft: 10 + depth * 16 + 20 }}>
          <span className="nm">{st.error}</span>
        </div>
      )
    if (st.loading && !st.entries.length)
      out.push(
        <div key={path + ':loading'} className="trow" style={{ paddingLeft: 10 + depth * 16 + 20 }}>
          <Loader2 size={12} className="spin" />
        </div>
      )
    for (const e of st.entries) {
      const p = join(path, e.name)
      const dirLike = isDirLike(e)
      const expanded = open.has(p)
      out.push(
        <div
          key={p}
          className={`trow ${sel?.path === p ? 'sel' : ''}`}
          style={{ paddingLeft: 10 + depth * 16 }}
          onClick={() => setSel({ path: p, entry: e })}
          onDoubleClick={() => (dirLike ? toggle(p) : void download())}
        >
          <span
            className="chev"
            onClick={(ev) => {
              ev.stopPropagation()
              if (dirLike) toggle(p)
            }}
          >
            {dirLike && (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
          </span>
          <span className={`ic ${e.type}`}>
            {e.type === 'link' ? <Link2 size={13} /> : e.type === 'dir' ? (expanded ? <FolderOpen size={13} /> : <Folder size={13} />) : <File size={13} />}
          </span>
          <span className="nm">
            {e.name}
            {e.linkTarget && <span className="lt"> → {e.linkTarget}</span>}
          </span>
          <span className="sz">{e.type === 'file' ? fmtSize(e.size) : ''}</span>
          <span className="dt">{e.date}</span>
          <span className="pm">{e.perms}</span>
        </div>
      )
      if (dirLike && expanded) out.push(...renderDir(p, depth + 1))
    }
    return out
  }

  return (
    <div
      className={`panel wide ${over ? 'dropzone-active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setOver(false)
      }}
      onDrop={onDrop}
    >
      <div className="panel-head">
        <span className="panel-title">Tệp trên thiết bị</span>
        <span style={{ flex: 1 }} />
        <button className="iconbtn" disabled={busy} onClick={upload} title={`Tải lên vào ${targetDir}`}><Upload size={13} /> Tải lên</button>
        <button className="iconbtn" disabled={busy || !sel?.entry} onClick={download}><Download size={13} /> Tải về</button>
        <button className="iconbtn" disabled={busy} onClick={() => setNewFolder('')} title={`Thư mục mới trong ${targetDir}`}><FolderPlus size={13} /></button>
        <button className="iconbtn danger" disabled={busy || !sel?.entry} onClick={remove} title="Xóa"><Trash2 size={13} /></button>
        <button className="iconbtn" disabled={busy} onClick={() => void load(targetDir)} title="Tải lại"><RefreshCw size={13} /></button>
      </div>
      <div className="roots">
        {ROOTS.map((r) => (
          <button key={r.path} className={`iconbtn ${root === r.path ? 'on' : ''}`} onClick={() => setRoot(r.path)}>
            {r.label}
          </button>
        ))}
        {newFolder !== null && (
          <input
            autoFocus
            className="input"
            placeholder={`Thư mục mới trong ${targetDir}`}
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createFolder()
              if (e.key === 'Escape') setNewFolder(null)
            }}
            onBlur={() => setNewFolder(null)}
            style={{ flex: 1 }}
          />
        )}
      </div>
      <div className="panel-body tree">
        <div
          className={`trow ${sel?.path === root ? 'sel' : ''}`}
          style={{ paddingLeft: 10 }}
          onClick={() => setSel({ path: root })}
        >
          <span className="chev"><ChevronDown size={13} /></span>
          <span className="ic dir"><FolderOpen size={13} /></span>
          <span className="nm">{root}</span>
        </div>
        {renderDir(root, 1)}
      </div>
      <div className={`files-foot ${msg?.error ? 'bad' : ''}`} title={msg?.text}>
        {msg?.text ?? `${sel?.path ?? root} — nhấp đúp vào tệp để tải về, kéo tệp vào đây để tải lên thư mục đang chọn`}
      </div>
    </div>
  )
}
