import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import JSZip from 'jszip'
import { adb, adbBinary, q, shell } from './adb'
import { listTar } from './tar'
import { STATE_DIRS, STATE_EXCLUDES, type AppStateMeta, type AppStateResult } from '../shared/appstate'

/**
 * Save and restore the private data of a debuggable app (login, settings, local databases) so a
 * tester can jump between "logged in as A", "logged in as B" and "fresh install" in seconds.
 * Works through `run-as`, so only apps built as debuggable; release apps are refused with a clear
 * message. Copies live on this PC only (in ADB Kit's data folder) and are never uploaded.
 */

const MAX_BYTES = 200 * 1024 * 1024 // size of the saved archive (caches are left out)
/** Refuse before pulling anything when the whole data folder (caches included) is absurdly large. */
const MAX_RAW_KB = 1024 * 1024
const DIRS = STATE_DIRS.join(' ')
const EXCL_TAR = STATE_EXCLUDES.map((p) => `--exclude=${q(p)}`).join(' ')
const EXCL_FIND = STATE_EXCLUDES.map((p) => `! -path ${q(p)}`).join(' ')

/** Script run as the app: delete its state files (caches stay), remove emptied folders, unpack the archive. */
export const restoreScript = (tmp: string, dirs = DIRS): string =>
  `for d in ${dirs}; do [ -e "$d" ] && find "$d" -type f ${EXCL_FIND} -delete >/dev/null 2>&1; done; ` +
  `for d in ${dirs}; do [ -d "$d" ] && find "$d" -depth -type d -empty -delete >/dev/null 2>&1; done; ` +
  `tar -xf ${q(tmp)} && echo __RESTORED__`
/** Script run as the app: stream its state (without caches) as a tar on stdout. */
export const saveScript = (dirs = DIRS): string => `tar -cf - ${EXCL_TAR} $(ls -d ${dirs} 2>/dev/null)`

const runAs = (serial: string, pkg: string, script: string, timeout?: number): ReturnType<typeof shell> =>
  shell(serial, `run-as ${q(pkg)} sh -c ${q(script)}`, timeout)

const notDebuggable = (out: string): boolean => /not debuggable|is unknown|run-as: /i.test(out)

/** Throws with a helpful message unless `pkg` is installed and debuggable. */
async function assertDebuggable(serial: string, pkg: string): Promise<void> {
  if (!pkg) throw new Error('Chưa chọn app')
  const r = await runAs(serial, pkg, 'id')
  const out = r.stdout + r.stderr
  if (!/uid=/.test(out) || notDebuggable(out)) {
    throw new Error(/unknown/i.test(out) ? `Không tìm thấy app ${pkg} trên máy` : 'App không phải bản debug nên Android không cho đọc dữ liệu riêng (run-as bị chặn). Cần bản build debuggable.')
  }
}

async function versionOf(serial: string, pkg: string): Promise<string> {
  const v = await shell(serial, `dumpsys package ${q(pkg)} | grep -m1 versionName`)
  return /versionName=(\S+)/.exec(v.stdout)?.[1] ?? ''
}

const launch = (serial: string, pkg: string): Promise<unknown> => shell(serial, `monkey -p ${q(pkg)} -c android.intent.category.LAUNCHER 1`)

/** Where saved states live; set once at startup (the window and the command line share the folder). */
let stateRoot = ''
let shared: AppStateStore | null = null
export function setStateRoot(dir: string): void {
  stateRoot = dir
  shared = null
}
export function stateStore(): AppStateStore {
  if (!stateRoot) throw new Error('Chưa đặt thư mục lưu trạng thái app')
  return (shared ??= new AppStateStore(stateRoot))
}

export class AppStateStore {
  constructor(private readonly root: string) {}

  private dir(id: string): string {
    return join(this.root, id)
  }

  list(pkg?: string): AppStateMeta[] {
    if (!existsSync(this.root)) return []
    const out: AppStateMeta[] = []
    for (const id of readdirSync(this.root)) {
      try {
        const m = JSON.parse(readFileSync(join(this.root, id, 'meta.json'), 'utf8')) as AppStateMeta
        if (!pkg || m.pkg === pkg) out.push(m)
      } catch {
        /* not a saved state */
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Newest state of `pkg` with this exact name (case-insensitive). */
  find(pkg: string, name: string): AppStateMeta | undefined {
    const n = name.trim().toLowerCase()
    return this.list(pkg).find((m) => m.name.trim().toLowerCase() === n)
  }

  /** Copy the app's data from the phone. */
  async save(serial: string, pkg: string, name: string, note = '', deviceName = serial): Promise<AppStateResult> {
    name = name.trim()
    if (!name) throw new Error('Hãy đặt tên cho trạng thái, ví dụ "Tài khoản A – đã đăng nhập"')
    if (name.length > 80) throw new Error('Tên quá dài (tối đa 80 ký tự)')
    await assertDebuggable(serial, pkg)

    // Size first: refuse before pulling hundreds of MB over adb.
    const du = await runAs(serial, pkg, `du -sk $(ls -d ${DIRS} 2>/dev/null) 2>/dev/null | cut -f1`)
    const kb = du.stdout.split(/\s+/).reduce((s, x) => s + (Number(x) || 0), 0)
    if (kb > MAX_RAW_KB) throw new Error(`Thư mục dữ liệu của app lớn ${(kb / 1024).toFixed(0)} MB, quá lớn để lưu`)

    // Stop the app first so databases and preferences are flushed to disk.
    await shell(serial, `am force-stop ${q(pkg)}`)
    let tar: Buffer
    try {
      tar = await adbBinary(['-s', serial, 'exec-out', `run-as ${q(pkg)} sh -c ${q(saveScript())}`], 5 * 60_000)
    } catch (e) {
      throw new Error(`Không chép được dữ liệu: ${(e as Error).message}`)
    }
    if (!tar.length) throw new Error('App chưa có dữ liệu nào để lưu (hoặc máy không có lệnh tar)')
    if (tar.length > MAX_BYTES) throw new Error(`Trạng thái lớn ${(tar.length / 1048576).toFixed(0)} MB (đã bỏ cache), vượt giới hạn ${MAX_BYTES / 1048576} MB`)
    let files: number
    try {
      files = listTar(tar).filter((x) => !x.dir).length
    } catch (e) {
      throw new Error(`Bản chép bị lỗi nên không lưu: ${(e as Error).message}`)
    }

    const id = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
    const meta: AppStateMeta = {
      id,
      pkg,
      name,
      note: note.trim(),
      createdAt: Date.now(),
      size: tar.length,
      files,
      appVersion: await versionOf(serial, pkg),
      device: deviceName
    }
    mkdirSync(this.dir(id), { recursive: true })
    writeFileSync(join(this.dir(id), 'state.tar'), tar)
    writeFileSync(join(this.dir(id), 'meta.json'), JSON.stringify(meta, null, 2))
    return { ok: true, message: `Đã lưu "${name}": ${files} tệp, ${(tar.length / 1024).toFixed(0)} KB`, meta }
  }

  /** Put a saved state back on the phone (replaces the app's current data). */
  async restore(serial: string, id: string, opts: { launch?: boolean } = {}): Promise<AppStateResult> {
    const meta = this.list().find((m) => m.id === id)
    if (!meta) throw new Error('Không tìm thấy trạng thái đã lưu')
    const file = join(this.dir(id), 'state.tar')
    if (!existsSync(file)) throw new Error('File dữ liệu của trạng thái này đã bị xóa')
    try {
      listTar(readFileSync(file))
    } catch (e) {
      throw new Error(`File lưu bị hỏng, không khôi phục: ${(e as Error).message}`)
    }
    const { pkg } = meta
    await assertDebuggable(serial, pkg)

    await shell(serial, `am force-stop ${q(pkg)}`)
    const tmp = `/data/local/tmp/adbkit-state-${randomBytes(4).toString('hex')}.tar`
    const push = await adb(['-s', serial, 'push', file, tmp], 5 * 60_000)
    if (push.code !== 0) throw new Error(`Không đẩy được file lên máy: ${(push.stderr || push.stdout).trim()}`)
    try {
      await shell(serial, `chmod 644 ${q(tmp)}`)
      const r = await runAs(serial, pkg, restoreScript(tmp), 5 * 60_000)
      if (!r.stdout.includes('__RESTORED__')) throw new Error(`Máy báo lỗi khi giải nén: ${(r.stdout + r.stderr).trim().slice(0, 200) || 'không có phản hồi'}`)
    } finally {
      await shell(serial, `rm -f ${q(tmp)}`)
    }
    if (opts.launch !== false) await launch(serial, pkg)

    const now = await versionOf(serial, pkg)
    const versionWarning =
      meta.appVersion && now && meta.appVersion !== now ? `Trạng thái này lưu từ bản ${meta.appVersion}, máy đang cài bản ${now}. Nếu app lỗi lạ, hãy lưu lại trạng thái bằng bản hiện tại.` : undefined
    return { ok: true, message: `Đã khôi phục "${meta.name}"${opts.launch === false ? '' : ' và mở lại app'}`, meta, versionWarning }
  }

  rename(id: string, name: string, note?: string): AppStateMeta {
    const meta = this.list().find((m) => m.id === id)
    if (!meta) throw new Error('Không tìm thấy trạng thái')
    if (!name.trim()) throw new Error('Tên không được để trống')
    const next = { ...meta, name: name.trim().slice(0, 80), note: note === undefined ? meta.note : note.trim() }
    writeFileSync(join(this.dir(id), 'meta.json'), JSON.stringify(next, null, 2))
    return next
  }

  remove(id: string): void {
    if (!/^[\w-]+$/.test(id)) throw new Error('id không hợp lệ')
    rmSync(this.dir(id), { recursive: true, force: true })
  }

  /** Pack a state into one file to share with a colleague (same app, same kind of build). */
  async exportTo(id: string, dest: string): Promise<void> {
    const meta = this.list().find((m) => m.id === id)
    if (!meta) throw new Error('Không tìm thấy trạng thái')
    const zip = new JSZip()
    zip.file('meta.json', JSON.stringify(meta, null, 2))
    zip.file('state.tar', readFileSync(join(this.dir(id), 'state.tar')))
    writeFileSync(dest, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  }

  async importFrom(file: string): Promise<AppStateMeta> {
    const zip = await JSZip.loadAsync(readFileSync(file))
    const metaFile = zip.file('meta.json')
    const tarFile = zip.file('state.tar')
    if (!metaFile || !tarFile) throw new Error('Không phải file trạng thái của ADB Kit')
    const meta = JSON.parse(await metaFile.async('string')) as AppStateMeta
    const tar = await tarFile.async('nodebuffer')
    const files = listTar(tar).filter((x) => !x.dir).length // also proves the archive is intact
    const id = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
    const next: AppStateMeta = { ...meta, id, files, size: tar.length, createdAt: Date.now() }
    mkdirSync(this.dir(id), { recursive: true })
    writeFileSync(join(this.dir(id), 'state.tar'), tar)
    writeFileSync(join(this.dir(id), 'meta.json'), JSON.stringify(next, null, 2))
    return next
  }

  /** Total disk used by saved states. */
  usage(): number {
    return this.list().reduce((s, m) => {
      try {
        return s + statSync(join(this.dir(m.id), 'state.tar')).size
      } catch {
        return s
      }
    }, 0)
  }
}

