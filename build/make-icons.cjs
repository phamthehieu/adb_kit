// Renders the icon SVG to PNG sizes in a hidden window and writes icon.png, icon-mac.png, icon.ico.
// usage: electron main.cjs <icon.svg> <outDir> <userDataDir>
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const [svgPath, outDir, userData] = process.argv.slice(-3)
app.setPath('userData', userData)

// Small sizes get a bolder drawing so the phone and prompt stay readable.
const SMALL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22345C"/><stop offset="1" stop-color="#0A1020"/></linearGradient></defs>
<rect width="1024" height="1024" rx="228" fill="url(#bg)"/>
<rect x="252" y="92" width="520" height="840" rx="110" fill="#0A1020" stroke="#F4F7FB" stroke-width="84"/>
<polyline points="400,400 520,512 400,624" fill="none" stroke="#4EE39A" stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/>
<line x1="580" y1="624" x2="640" y2="624" stroke="#4EE39A" stroke-width="96" stroke-linecap="round"/>
</svg>`

function ico(images) {
  const head = Buffer.alloc(6 + images.length * 16)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let off = head.length
  images.forEach(({ size, png }, i) => {
    const o = 6 + i * 16
    head[o] = size >= 256 ? 0 : size
    head[o + 1] = size >= 256 ? 0 : size
    head.writeUInt16LE(1, o + 4)
    head.writeUInt16LE(32, o + 6)
    head.writeUInt32LE(png.length, o + 8)
    head.writeUInt32LE(off, o + 12)
    off += png.length
  })
  return Buffer.concat([head, ...images.map((i) => i.png)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 200, height: 200 })
  await win.loadURL('about:blank')
  const full = fs.readFileSync(svgPath, 'utf8')
  const render = async (svg, size, inset) => {
    const url = await win.webContents.executeJavaScript(`new Promise((res, rej) => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = c.height = ${size}
        const p = Math.round(${size} * ${inset})
        c.getContext('2d').drawImage(img, p, p, ${size} - 2 * p, ${size} - 2 * p)
        res(c.toDataURL('image/png'))
      }
      img.onerror = () => rej(new Error('svg failed to load'))
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))}
    })`)
    return Buffer.from(url.split(',')[1], 'base64')
  }
  fs.writeFileSync(path.join(outDir, 'icon.png'), await render(full, 1024, 0))
  // macOS icons sit inside a margin (824 of 1024).
  fs.writeFileSync(path.join(outDir, 'icon-mac.png'), await render(full, 1024, 100 / 1024))
  const images = []
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    images.push({ size, png: await render(size <= 32 ? SMALL : full, size, 0) })
  }
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico(images))
  console.log('done')
  app.quit()
}).catch((e) => { console.error(e); app.exit(1) })
