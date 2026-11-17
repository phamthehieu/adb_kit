// The page the phone shows for "Bảng theo dõi" (in ADB Kit's viewer app or in the browser). One
// self-contained document: no external files, so it works with nothing but the `adb reverse`
// link back to this PC. Laid out for a phone lying on its side; upright it scrolls.
import { fmtRate, fmtTokens } from '../shared/desk'

const CSS = String.raw`
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#000;color:#eef2f8;font-family:Roboto,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
[hidden]{display:none!important}
#root{min-height:100%;display:flex;flex-direction:column;gap:2.4vmin;padding:3vmin;transition:transform 2s ease,filter .4s}
#left,#main{display:flex;flex-direction:column;gap:2.4vmin;min-width:0;min-height:0}
#clock{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2vmin 0}
#time{font-size:30vw;font-weight:300;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums;white-space:nowrap}
#time i{font-style:normal;color:#5bf0a0;animation:blink 2s steps(1) infinite}
@keyframes blink{50%{opacity:.25}}
#sec{width:38%;height:.5vmin;min-height:2px;border-radius:1vmin;background:#121a2b;margin:2vmin 0 1.6vmin;overflow:hidden}
#sec b{display:block;height:100%;width:0;background:linear-gradient(90deg,#22c3a6,#5bf0a0);border-radius:1vmin;transition:width 1s linear}
#date{font-size:4vmin;color:#93a0b8;white-space:nowrap}
#host{font-size:2.7vmin;color:#56637c;margin-top:1vmin;display:flex;align-items:center;gap:1.4vmin}
#dot{width:1.5vmin;height:1.5vmin;border-radius:50%;background:#5bf0a0;box-shadow:0 0 1.6vmin #5bf0a0}
#dot.off{background:#ff7a7a;box-shadow:0 0 1.6vmin #ff7a7a}
.tile{position:relative;min-width:0;min-height:0;background:linear-gradient(155deg,#0f182a,#080d17);border:1px solid #18233a;border-radius:4.5vmin;padding:2.6vmin 3.2vmin;display:flex;flex-direction:column;overflow:hidden}
.lab{font-size:2.6vmin;letter-spacing:.16em;text-transform:uppercase;color:#6f7e99;font-weight:600;position:relative;z-index:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.one{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#gauges{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:2.4vmin}
#gauges>.wide{grid-column:1/-1}
.stat{justify-content:space-between;min-height:24vmin;padding:2.4vmin 3.2vmin}
.sh{display:flex;justify-content:space-between;align-items:baseline;gap:2vmin;position:relative;z-index:1}
.sh .lab{flex:none}
.sub{font-size:2.7vmin;color:#93a0b8;min-width:0;font-variant-numeric:tabular-nums}
.val{position:relative;z-index:1;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;text-shadow:0 0 2vmin #080d17,0 0 1vmin #080d17}
.val b{font-size:11vmin;font-weight:600;letter-spacing:-.02em;transition:color .4s}
.val small{font-size:4vmin;color:#93a0b8;margin-left:.8vmin;font-weight:500}
.val i{font-style:normal;font-size:5vmin;font-weight:700;color:#5bf0a0;margin-right:1.2vmin}
#net .val b{font-size:8vmin}
.sp{position:absolute;left:0;right:0;bottom:0;width:100%;height:64%}
.bar{height:1.2vmin;border-radius:1vmin;background:#131b2d;overflow:hidden;margin-top:1.2vmin}
.bar i{display:block;height:100%;width:0;border-radius:1vmin;background:linear-gradient(90deg,#22c3a6,#5bf0a0);transition:width 1s linear}
.bar.low i{background:#ff6b6b}
#music{flex-direction:row;align-items:center;gap:3vmin}
#eq{flex:none;display:flex;align-items:flex-end;gap:.9vmin;height:7vmin}
#eq i{width:1.3vmin;border-radius:1vmin;background:#5bf0a0;height:30%}
#eq.on i{animation:eq 1s ease-in-out infinite}
#eq.on i:nth-child(2){animation-delay:-.6s}#eq.on i:nth-child(3){animation-delay:-.3s}#eq.on i:nth-child(4){animation-delay:-.8s}
@keyframes eq{0%,100%{height:25%}50%{height:100%}}
#mbody{flex:1;min-width:0}
#mtitle{font-size:4vmin;font-weight:600}
#martist{font-size:3vmin;color:#93a0b8;margin-top:.3vmin}
#mtime{font-size:2.5vmin;color:#6f7e99;margin-top:.8vmin;display:flex;justify-content:space-between;font-variant-numeric:tabular-nums}
#ci{flex-direction:row;align-items:center;gap:3vmin}
#cidot{flex:none;width:3vmin;height:3vmin;border-radius:50%;background:#6f7e99}
#cidot.success{background:#5bf0a0;box-shadow:0 0 2vmin rgba(91,240,160,.6)}
#cidot.failure{background:#ff6b6b;box-shadow:0 0 2vmin rgba(255,107,107,.6)}
#cidot.running,#cidot.queued{background:#ffb454;animation:blink 1.2s steps(1) infinite}
#cibody{flex:1;min-width:0}
#cititle{font-size:3.4vmin;font-weight:600;margin-top:.4vmin}
#cisub{font-size:2.7vmin;color:#93a0b8;margin-top:.2vmin}
.aih{display:flex;justify-content:space-between;align-items:center;gap:2vmin}
.pill{flex:none;font-size:2.5vmin;padding:.6vmin 2vmin;border-radius:9vmin;background:rgba(91,240,160,.13);color:#5bf0a0;white-space:nowrap;display:flex;align-items:center;gap:1.2vmin}
.pill:before{content:"";width:1.3vmin;height:1.3vmin;border-radius:50%;background:currentColor;animation:blink 1.6s steps(1) infinite}
.pill.idle{background:#121a2b;color:#6f7e99}
.pill.idle:before{animation:none;opacity:.5}
.airow+.airow{margin-top:1.8vmin;padding-top:1.8vmin;border-top:1px solid #18233a}
.aib{display:flex;align-items:center;gap:4vmin;margin-top:.8vmin}
.aiv{flex:none;font-size:12vmin;font-weight:600;line-height:1.1;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap;background:linear-gradient(90deg,#5bf0a0,#39c8f0);-webkit-background-clip:text;background-clip:text;color:transparent}
.airow:nth-child(2) .aiv{background-image:linear-gradient(90deg,#6ea8ff,#b08cff)}
.airow:nth-child(3) .aiv{background-image:linear-gradient(90deg,#ffb454,#ff7a9c)}
.stats{flex:1;min-width:0;display:grid;grid-template-columns:repeat(2,1fr);gap:1.2vmin 2vmin}
.stats span{display:block;font-size:2.4vmin;color:#6f7e99;white-space:nowrap}
.stats b{display:block;font-size:3.8vmin;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.n2 .aiv,.n3 .aiv{font-size:8vmin}
.n2 .stats,.n3 .stats{grid-template-columns:repeat(4,1fr)}
.n2 .stats b,.n3 .stats b{font-size:3.3vmin}
.n3 .aiv{font-size:6.6vmin}
.n3 .airow+.airow{margin-top:1.1vmin;padding-top:1.1vmin}
#hint{position:fixed;left:0;right:0;bottom:1vmin;text-align:center;font-size:2.4vmin;color:#3f4b62;pointer-events:none}
#lost{position:fixed;inset:0;display:none;align-items:center;justify-content:center;text-align:center;background:rgba(0,0,0,.86);font-size:4.4vmin;line-height:1.5;padding:8vmin;color:#cfd8e6}
#lost.on{display:flex}
@media (orientation:landscape){
  html,body{overflow:hidden}
  #root{height:100%;flex-direction:row}
  #left{flex:1 1 0}
  #main{flex:1.75 1 0}
  #clock{flex:1;padding:0}
  #time{font-size:min(14.5vw,38vh)}
  #left.busy #time{font-size:min(12vw,27vh)}
  #left.busy #host{display:none}
  #left.busy #sec{margin:1.4vmin 0 1vmin}
  #gauges{flex:1;min-height:0}
  .stat{min-height:0}
  #music,#ci,#ai{flex:none}
  .n1 .aiv{font-size:11vmin}
}
`

/** A wide tile: label and detail on top, a big value below, one minute of history as the background. */
const stat = (id: string, label: string): string =>
  `<section class="tile stat" id="${id}"><canvas class="sp" id="${id}s"></canvas><div class="sh"><span class="lab">${label}</span><span class="sub one" id="${id}f"></span></div>` +
  `<div class="val"><b id="${id}v">--</b><small>%</small></div></section>`

const BODY = `
<div id="root">
  <div id="left">
    <section id="clock">
      <div id="time">--<i>:</i>--</div>
      <div id="sec"><b id="secb"></b></div>
      <div id="date"></div>
      <div id="host"><i id="dot"></i><span id="hostn"></span></div>
    </section>
    <section class="tile" id="music" hidden>
      <div id="eq"><i></i><i></i><i></i><i></i></div>
      <div id="mbody"><div class="one" id="mtitle"></div><div class="one" id="martist"></div><div class="bar"><i id="mbar"></i></div><div id="mtime"><span id="mpos"></span><span id="mdur"></span></div></div>
    </section>
    <section class="tile" id="ci" hidden>
      <i id="cidot"></i>
      <div id="cibody"><div class="lab" id="cilab"></div><div class="one" id="cititle"></div><div class="one" id="cisub"></div></div>
    </section>
  </div>
  <div id="main">
    <div id="gauges">
      ${stat('cpu', 'CPU')}
      ${stat('ram', 'RAM')}
      ${stat('gpu', 'GPU')}
      <section class="tile stat" id="net" hidden><canvas class="sp" id="nets"></canvas><div class="sh"><span class="lab">Mạng</span><span class="sub one" id="netf"></span></div><div class="val"><i>↓</i><b id="netv">--</b></div></section>
    </div>
    <section class="tile n1" id="ai" hidden></section>
  </div>
</div>
<div id="hint">Chạm để xem toàn màn hình</div>
<div id="lost">Mất kết nối với ADB Kit.<br>Trang sẽ tự hiện lại khi bật Bảng theo dõi và điện thoại còn cắm dây.</div>
`

const JS = String.raw`
var $ = function (id) { return document.getElementById(id) }
// One minute of history per tile; RGB is the tile's colour.
var hist = { cpu: [], ram: [], gpu: [], net: [] }
var RGB = { cpu: '91,240,160', ram: '110,168,255', gpu: '255,180,84', net: '57,200,240' }
var battery = ''
var DAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']
function two(n) { return (n < 10 ? '0' : '') + n }
function tick() {
  var d = new Date()
  $('time').firstChild.nodeValue = two(d.getHours())
  $('time').lastChild.nodeValue = two(d.getMinutes())
  $('secb').style.width = (d.getSeconds() / 59) * 100 + '%'
  $('date').textContent = DAYS[d.getDay()] + ', ' + two(d.getDate()) + ' tháng ' + (d.getMonth() + 1) + battery
}
tick(); setInterval(tick, 1000)

// The newest value sits at the right edge and the chart scrolls left, like Task Manager.
function spark(id, floor) {
  var c = $(id + 's'), a = hist[id], w = c.clientWidth, h = c.clientHeight, r = window.devicePixelRatio || 1
  if (!w || !h) return
  c.width = w * r; c.height = h * r
  var g = c.getContext('2d')
  g.scale(r, r); g.clearRect(0, 0, w, h)
  if (a.length < 2) return
  var top = Math.max(floor, Math.max.apply(null, a) * 1.15), x0 = 59 - (a.length - 1)
  g.beginPath()
  for (var i = 0; i < a.length; i++) {
    var x = ((x0 + i) / 59) * w, y = h - (a[i] / top) * (h - 3)
    if (i) g.lineTo(x, y); else g.moveTo(x, y)
  }
  g.strokeStyle = 'rgba(' + RGB[id] + ',.7)'; g.lineWidth = 1.5; g.lineJoin = 'round'; g.stroke()
  g.lineTo(w, h); g.lineTo((x0 / 59) * w, h); g.closePath()
  var f = g.createLinearGradient(0, 0, 0, h)
  f.addColorStop(0, 'rgba(' + RGB[id] + ',.30)'); f.addColorStop(1, 'rgba(' + RGB[id] + ',0)')
  g.fillStyle = f; g.fill()
}
function sparks() { spark('cpu', 40); spark('ram', 100); spark('gpu', 40); spark('net', 51200) }
function track(id, v) { hist[id].push(v); if (hist[id].length > 60) hist[id].shift() }
function gb(b) { return (b / 1073741824).toFixed(1).replace('.', ',') }
function mmss(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + two(s % 60) }
function ago(ms) {
  var m = Math.round(ms / 60000)
  if (m < 1) return 'vừa xong'
  if (m < 60) return m + ' phút trước'
  var h = Math.round(m / 60)
  return h < 24 ? h + ' giờ trước' : Math.round(h / 24) + ' ngày trước'
}
function gauge(id, pct) {
  var p = Math.max(0, Math.min(100, pct))
  $(id + 'v').textContent = Math.round(p)
  $(id + 'v').style.color = p >= 90 ? '#ff6b6b' : p >= 75 ? '#ffb454' : ''
  track(id, p)
}
var CI = { success: 'thành công', failure: 'thất bại', running: 'đang chạy', queued: 'đang chờ', cancelled: 'đã hủy', other: 'đã xong' }
function show(m) {
  var s = m.s, w = m.c.widgets
  var gpu = w.gpu && s.gpu, net = w.net && s.net, bat = w.battery && s.battery, media = w.media && s.media, ci = w.ci && s.ci
  var ai = w.ai && s.ai && s.ai.length
  $('clock').hidden = !w.clock; $('cpu').hidden = !w.cpu; $('ram').hidden = !w.ram; $('gpu').hidden = !gpu
  $('net').hidden = !net
  $('gauges').hidden = !w.cpu && !w.ram && !gpu && !net
  // An odd number of tiles: the last one takes the whole row.
  var shown = ['cpu', 'ram', 'gpu', 'net'].filter(function (id) { return !$(id).hidden })
  shown.forEach(function (id, i) { $(id).className = 'tile stat' + (shown.length % 2 && i === shown.length - 1 ? ' wide' : '') })
  battery = bat ? ' · Pin ' + Math.round(s.battery.level) + '%' + (s.battery.charging ? ' ⚡' : '') : ''
  $('music').hidden = !media; $('ci').hidden = !ci; $('ai').hidden = !ai
  $('left').hidden = !w.clock && !media && !ci
  $('left').className = media || ci ? 'busy' : ''
  $('main').hidden = $('gauges').hidden && !ai
  $('ai').style.flex = $('gauges').hidden ? '1' : ''
  $('root').style.filter = m.c.dim < 100 ? 'brightness(' + m.c.dim / 100 + ')' : ''
  $('hostn').textContent = s.host
  if (typeof s.cpu === 'number') gauge('cpu', s.cpu)
  $('cpuf').textContent = s.cores + ' luồng'
  gauge('ram', s.memTotal ? (s.memUsed / s.memTotal) * 100 : 0)
  $('ramf').textContent = gb(s.memUsed) + ' / ' + gb(s.memTotal) + ' GB'
  if (gpu) {
    gauge('gpu', s.gpu.load)
    $('gpuf').textContent = s.gpu.name.replace(/\((R|TM|C)\)/gi, '').replace(/^(Intel|NVIDIA|AMD)\s+/i, '').replace(/\s+/g, ' ').trim() || 'GPU'
  }
  if (net) {
    $('netv').textContent = fmtRate(s.net.down)
    $('netf').textContent = '↑ ' + fmtRate(s.net.up)
    track('net', s.net.down)
  }
  sparks()
  if (media) {
    $('mtitle').textContent = s.media.title
    $('martist').textContent = s.media.artist || (s.media.playing ? 'Đang phát' : 'Tạm dừng')
    $('eq').className = s.media.playing ? 'on' : ''
    var has = s.media.duration > 0
    $('mbar').parentNode.hidden = !has; $('mtime').hidden = !has
    if (has) {
      $('mbar').style.width = Math.min(100, (s.media.position / s.media.duration) * 100) + '%'
      $('mpos').textContent = mmss(s.media.position); $('mdur').textContent = mmss(s.media.duration)
    }
  }
  if (ci) {
    $('cidot').className = s.ci.state
    $('cilab').textContent = 'CI · ' + s.ci.repo
    $('cititle').textContent = s.ci.title || s.ci.name
    $('cisub').textContent = CI[s.ci.state] + (s.ci.branch ? ' · ' + s.ci.branch : '') + (s.ci.at ? ' · ' + ago(s.t - s.ci.at) : '')
  }
  if (ai) aiShow(s.ai)
}
// One row per AI tool found on the PC; rows are rebuilt only when the list of tools changes.
var aiKey = null
var STATS = ['Trả lời', 'Gửi lên', 'Bộ nhớ đệm', '5 giờ qua']
function aiShow(list) {
  var box = $('ai')
  var key = list.map(function (x) { return x.id }).join(',')
  if (key !== aiKey) {
    aiKey = key
    box.innerHTML = ''
    box.className = 'tile n' + Math.max(1, Math.min(list.length, 3))
    list.forEach(function () {
      var row = document.createElement('div')
      row.className = 'airow'
      row.innerHTML = '<div class="aih"><div class="lab"></div><div class="pill idle"></div></div><div class="aib"><span class="aiv">--</span><div class="stats">' +
        STATS.map(function (l) { return '<div><span>' + l + '</span><b>--</b></div>' }).join('') + '</div></div>'
      box.appendChild(row)
    })
  }
  list.forEach(function (x, i) {
    var row = box.children[i], t = x.usage.today, r = x.usage.recent, b = row.querySelectorAll('.stats b'), pill = row.querySelector('.pill')
    row.querySelector('.lab').textContent = x.name + ' · token hôm nay'
    row.querySelector('.aiv').textContent = fmtTokens(t.input + t.output + t.cacheRead + t.cacheWrite)
    b[0].textContent = fmtTokens(t.output)
    b[1].textContent = fmtTokens(t.input + t.cacheWrite)
    b[2].textContent = fmtTokens(t.cacheRead)
    b[3].textContent = fmtTokens(r.input + r.output + r.cacheRead + r.cacheWrite)
    pill.textContent = x.usage.active ? x.usage.active + ' phiên đang chạy' : 'đang nghỉ'
    pill.className = x.usage.active ? 'pill' : 'pill idle'
  })
}
var inApp = /ADBKitDesk/.test(navigator.userAgent)
var lostTimer = 0
function online(on) {
  $('dot').className = on ? '' : 'off'
  clearTimeout(lostTimer)
  if (on) $('lost').className = ''
  else lostTimer = setTimeout(function () {
    $('lost').className = 'on'
    // Inside ADB Kit's viewer app a reload hands over to the app, which waits and then closes itself.
    if (inApp) location.reload()
  }, 4000)
}
function connect() {
  var es = new EventSource('/events' + location.search)
  es.onmessage = function (e) { online(true); try { show(JSON.parse(e.data)) } catch (err) {} }
  es.onerror = function () { online(false) }
}
connect()

// Keep the screen on while the page is visible (works on 127.0.0.1, a secure context).
function wake() {
  if (!navigator.wakeLock || document.visibilityState !== 'visible') return
  navigator.wakeLock.request('screen').catch(function () {})
}
wake(); document.addEventListener('visibilitychange', wake)
document.addEventListener('click', function () {
  wake()
  var el = document.documentElement
  if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(function () {})
})
// ADB Kit's viewer app is already full screen and keeps the screen on by itself.
if (inApp) $('hint').hidden = true
document.addEventListener('fullscreenchange', function () {
  $('hint').hidden = !!document.fullscreenElement
  // A browser lets a page turn the screen only while it is full screen.
  if (document.fullscreenElement && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {})
  sparks()
})
// Nudge the layout a few pixels every minute so nothing stays burnt into an old screen.
setInterval(function () {
  var x = Math.round(Math.random() * 8 - 4), y = Math.round(Math.random() * 8 - 4)
  $('root').style.transform = 'translate(' + x + 'px,' + y + 'px)'
}, 60000)
window.addEventListener('resize', sparks)
`

export function deskPageHtml(): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#000000"><title>ADB Kit · Bảng theo dõi</title><style>${CSS}</style></head><body>${BODY}<script>var fmtTokens = ${fmtTokens.toString()};var fmtRate = ${fmtRate.toString()};${JS}</script></body></html>`
}
