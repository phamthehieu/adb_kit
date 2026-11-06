import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { adbBinary, shell } from './adb'
import { DEVICE_PRESETS, type DevicePreset, type MatrixItem } from '../shared/formfactors'

const ALL_CUTOUTS = [
  'com.android.internal.display.cutout.emulation.tall',
  'com.android.internal.display.cutout.emulation.hole',
  'com.android.internal.display.cutout.emulation.corner',
  'com.android.internal.display.cutout.emulation.double',
  'com.android.internal.display.cutout.emulation.waterfall'
]

const storePath = (): string => join(app.getPath('userData'), 'formfactors-original.json')

interface OriginalDeviceState {
  size: string
  density: number
}

function loadOriginals(): Record<string, OriginalDeviceState> {
  try {
    return existsSync(storePath()) ? JSON.parse(readFileSync(storePath(), 'utf8')) : {}
  } catch {
    return {}
  }
}

function saveOriginals(data: Record<string, OriginalDeviceState>): void {
  try {
    writeFileSync(storePath(), JSON.stringify(data, null, 2))
  } catch {
    /* ignore */
  }
}

async function recordOriginalIfNeeded(serial: string): Promise<OriginalDeviceState> {
  const all = loadOriginals()
  if (all[serial]) return all[serial]

  const sizeOut = (await shell(serial, 'wm size')).stdout
  const densOut = (await shell(serial, 'wm density')).stdout

  const mSize = /Physical size:\s*(\d+x\d+)/.exec(sizeOut) ?? /Override size:\s*(\d+x\d+)/.exec(sizeOut)
  const mDens = /Physical density:\s*(\d+)/.exec(densOut) ?? /Override density:\s*(\d+)/.exec(densOut)

  const state: OriginalDeviceState = {
    size: mSize ? mSize[1] : '1080x2400',
    density: mDens ? Number(mDens[1]) : 420
  }

  all[serial] = state
  saveOriginals(all)
  return state
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function clearCutouts(serial: string): Promise<void> {
  const cmds = ALL_CUTOUTS.map((c) => `cmd overlay disable ${c}`).join('; ')
  await shell(serial, cmds).catch(() => {})
}

export async function getAvailableCutouts(serial: string): Promise<string[]> {
  const r = await shell(serial, 'cmd overlay list')
  const available: string[] = []
  for (const l of r.stdout.split('\n')) {
    const m = /com\.android\.internal\.display\.cutout\.emulation\.\w+/.exec(l)
    if (m && !available.includes(m[0])) available.push(m[0])
  }
  return available
}

export async function applyFormFactor(serial: string, presetId: string): Promise<{ ok: boolean; message: string }> {
  await recordOriginalIfNeeded(serial)
  const preset = DEVICE_PRESETS.find((p) => p.id === presetId)
  if (!preset) throw new Error(`Không tìm thấy cấu hình màn hình ${presetId}`)

  if (preset.cutout) {
    const available = await getAvailableCutouts(serial)
    if (!available.includes(preset.cutout)) {
      return {
        ok: false,
        message: `Thiết bị này chưa hỗ trợ "${preset.name}" (kiểu này cần Android 11+, máy đang chạy Android cũ hơn). Hãy thử "Tai thỏ sâu" hoặc "Tai thỏ kép"!`
      }
    }
    await clearCutouts(serial)
    const r = await shell(serial, `cmd overlay enable ${preset.cutout}`)
    if (r.code !== 0) {
      return { ok: false, message: `Lỗi khi bật khuyết đỉnh: ${r.stderr || r.stdout}` }
    }
    return { ok: true, message: `Đã bật ${preset.name} — quan sát app né phần khuyết đỉnh này trên màn hình!` }
  }

  if (preset.width && preset.height) {
    await clearCutouts(serial)
    await shell(serial, `wm size ${preset.width}x${preset.height}`)
    if (preset.density) {
      await shell(serial, `wm density ${preset.density}`)
    }
    return { ok: true, message: `Đã áp dụng ${preset.name} (${preset.width}×${preset.height})` }
  }

  return { ok: false, message: 'Cấu hình không hợp lệ' }
}

export async function resetFormFactor(serial: string): Promise<{ ok: boolean; message: string }> {
  const all = loadOriginals()
  const orig = all[serial]

  await clearCutouts(serial)
  await shell(serial, 'wm size reset')

  if (orig?.density) {
    await shell(serial, `wm density ${orig.density}`)
  } else {
    await shell(serial, 'wm density reset')
  }

  return { ok: true, message: 'Đã khôi phục kích thước màn hình gốc' }
}

export async function scanMatrix(
  serial: string,
  onProgress?: (step: number, total: number, name: string) => void
): Promise<MatrixItem[]> {
  const orig = await recordOriginalIfNeeded(serial)

  // 4 representative presets for quick matrix scanning:
  const presetsToScan: DevicePreset[] = [
    DEVICE_PRESETS.find((p) => p.id === 'zfold_unfolded')!,
    DEVICE_PRESETS.find((p) => p.id === 'zfold_folded')!,
    DEVICE_PRESETS.find((p) => p.id === 'tab_11')!,
    DEVICE_PRESETS.find((p) => p.id === 'cutout_tall')!
  ].filter(Boolean)

  const results: MatrixItem[] = []

  try {
    for (let i = 0; i < presetsToScan.length; i++) {
      const p = presetsToScan[i]
      onProgress?.(i + 1, presetsToScan.length, p.name)

      if (p.cutout) {
        await clearCutouts(serial)
        await shell(serial, 'wm size reset')
        if (orig.density) await shell(serial, `wm density ${orig.density}`)
        await shell(serial, `cmd overlay enable ${p.cutout}`)
      } else if (p.width && p.height) {
        await clearCutouts(serial)
        await shell(serial, `wm size ${p.width}x${p.height}`)
        if (p.density) await shell(serial, `wm density ${p.density}`)
      }

      // Allow WindowManager and app layout to settle
      await sleep(500)

      // Screencap
      const buf = await adbBinary(['-s', serial, 'exec-out', 'screencap', '-p'], 15_000)
      const base64 = buf.toString('base64')

      const w = p.width ?? 1080
      const h = p.height ?? 2400
      const dens = p.density ?? orig.density ?? 420
      const dpW = Math.round((w * 160) / dens)
      const dpH = Math.round((h * 160) / dens)

      results.push({
        id: p.id,
        name: p.name,
        desc: p.desc,
        width: w,
        height: h,
        dpWidth: dpW,
        dpHeight: dpH,
        dataUrl: `data:image/png;base64,${base64}`
      })
    }
  } finally {
    // ALWAYS restore physical display settings
    await resetFormFactor(serial)
  }

  return results
}

