export interface DevicePreset {
  id: string
  name: string
  category: 'foldable' | 'tablet' | 'phone' | 'cutout'
  desc: string
  width?: number
  height?: number
  density?: number
  cutout?: string
  minSdk?: number
}

export const DEVICE_PRESETS: DevicePreset[] = [
  // Máy gập (Foldables)
  {
    id: 'zfold_unfolded',
    name: 'Galaxy Z Fold (Mở trong)',
    category: 'foldable',
    desc: '7.6" gần vuông (~4:3.5) · 1812×2176 · Kích hoạt giao diện 2 cột / Tablet',
    width: 1812,
    height: 2176,
    density: 374
  },
  {
    id: 'zfold_folded',
    name: 'Galaxy Z Fold (Gập ngoài)',
    category: 'foldable',
    desc: '6.2" siêu hẹp & dài (23.1:9) · 904×2316 · Bắt lỗi text tràn mép, vỡ layout',
    width: 904,
    height: 2316,
    density: 374
  },
  {
    id: 'zflip',
    name: 'Galaxy Z Flip (Gập dọc)',
    category: 'foldable',
    desc: '6.7" siêu dài (22:9) · 1080×2640 · Kiểm tra nút bấm đáy màn hình',
    width: 1080,
    height: 2640,
    density: 420
  },
  // Máy tính bảng (Tablets)
  {
    id: 'tab_11',
    name: 'Tablet 11-inch (Tab S9 / iPad)',
    category: 'tablet',
    desc: '11" tỷ lệ 16:10 · 1600×2560 · sw600dp/sw720dp layout lớn',
    width: 1600,
    height: 2560,
    density: 275
  },
  {
    id: 'tab_8',
    name: 'Tablet mini 8.4-inch',
    category: 'tablet',
    desc: '8.4" tỷ lệ 16:10 · 1200×1920 · Kiểm tra responsive tầm trung',
    width: 1200,
    height: 1920,
    density: 280
  },
  // Điện thoại đặc thù
  {
    id: 'phone_xperia',
    name: 'Cinema 21:9 (Sony Xperia)',
    category: 'phone',
    desc: 'Tỷ lệ rạp chiếu phim 21:9 · 1080×2520 · Thân máy dài',
    width: 1080,
    height: 2520,
    density: 420
  },
  {
    id: 'phone_budget',
    name: 'Phone nhỏ / Giá rẻ (HD+)',
    category: 'phone',
    desc: '6.5" HD+ tỷ lệ 20:9 · 720×1600 · Mật độ điểm ảnh thấp',
    width: 720,
    height: 1600,
    density: 270
  },
  // Màn hình khuyết đỉnh / Tai thỏ
  {
    id: 'cutout_tall',
    name: 'Tai thỏ sâu (Tall Notch)',
    category: 'cutout',
    desc: 'Tai thỏ ăn sâu xuống thanh trạng thái',
    cutout: 'com.android.internal.display.cutout.emulation.tall',
    minSdk: 28
  },
  {
    id: 'cutout_double',
    name: 'Tai thỏ kép (Double Cutout)',
    category: 'cutout',
    desc: 'Khuyết đỉnh cả 2 đầu trên và dưới màn hình',
    cutout: 'com.android.internal.display.cutout.emulation.double',
    minSdk: 28
  },
  {
    id: 'cutout_corner',
    name: 'Camera góc (Corner Cutout)',
    category: 'cutout',
    desc: 'Khuyết góc trên bên phải màn hình',
    cutout: 'com.android.internal.display.cutout.emulation.corner',
    minSdk: 28
  },
  {
    id: 'cutout_hole',
    name: 'Camera nốt ruồi (Punch Hole)',
    category: 'cutout',
    desc: 'Camera đục lỗ tròn chính giữa (Cần Android 11+)',
    cutout: 'com.android.internal.display.cutout.emulation.hole',
    minSdk: 30
  },
  {
    id: 'cutout_waterfall',
    name: 'Viền cong thác nước (Waterfall)',
    category: 'cutout',
    desc: 'Mép màn hình cong tràn 2 bên (Cần Android 11+)',
    cutout: 'com.android.internal.display.cutout.emulation.waterfall',
    minSdk: 30
  }
]

export interface MatrixItem {
  id: string
  name: string
  desc: string
  width: number
  height: number
  dpWidth: number
  dpHeight: number
  dataUrl: string
}

export interface FormFactorState {
  currentPresetId: string | null
  isCustom: boolean
  originalSize: string | null
  originalDensity: number | null
}

