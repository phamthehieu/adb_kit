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
#clock{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3vmin 2.4vmin;background:radial-gradient(120% 90% at 50% 0%,rgba(91,240,160,.08),transparent 65%),linear-gradient(155deg,#0f182a,#080d17)}
#time{font-size:28vw;font-weight:300;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums;white-space:nowrap}
#time i{font-style:normal;color:#5bf0a0;animation:blink 2s ease-in-out infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.22}}
#sec{width:38%;height:.5vmin;min-height:2px;border-radius:1vmin;background:#121a2b;margin:2vmin 0 1.6vmin;overflow:hidden}
#sec b{display:block;height:100%;width:0;background:linear-gradient(90deg,#22c3a6,#5bf0a0);border-radius:1vmin;will-change:width}
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
#music{flex-direction:column;gap:2.2vmin;padding:2.8vmin 3.4vmin}
#mtop{display:flex;align-items:center;gap:2.8vmin}
#eq{flex:none;display:flex;align-items:flex-end;gap:.9vmin;height:7.5vmin}
#eq i{width:1.4vmin;border-radius:1vmin;background:#5bf0a0;height:30%;transition:height .25s ease}
#eq.on i{animation:eq 1s ease-in-out infinite}
#eq.on i:nth-child(2){animation-delay:-.6s}#eq.on i:nth-child(3){animation-delay:-.3s}#eq.on i:nth-child(4){animation-delay:-.8s}
@keyframes eq{0%,100%{height:25%}50%{height:100%}}
#mbody{flex:1;min-width:0}
#mtitle{font-size:4.5vmin;font-weight:600;line-height:1.25}
#martist{font-size:3.2vmin;color:#93a0b8;margin-top:.5vmin}
#mprog{display:flex;flex-direction:column;gap:.6vmin}
#mprog .bar{margin-top:0;height:1.3vmin}
#mtime{font-size:2.6vmin;color:#6f7e99;display:flex;justify-content:space-between;font-variant-numeric:tabular-nums}
#mctrls{display:flex;align-items:center;justify-content:center;gap:4.5vmin;padding-top:.4vmin}
.mbtn{border:1px solid #24324d;background:#121b2e;color:#dbe4f3;border-radius:50%;width:9.5vmin;height:9.5vmin;display:grid;place-items:center;cursor:pointer;transition:transform .12s ease,background-color .18s ease,border-color .18s ease}
.mbtn:active{transform:scale(.9)}
.mbtn:disabled{opacity:.3;cursor:default;transform:none}
.mbtn svg{width:4.2vmin;height:4.2vmin;fill:currentColor}
.mbtn.play{width:11.5vmin;height:11.5vmin;background:linear-gradient(145deg,#3fe0a8,#24b48a);border-color:transparent;color:#051a12;box-shadow:0 0 2.6vmin rgba(91,240,160,.28)}
.mbtn.play svg{width:5vmin;height:5vmin}
#ci{flex-direction:row;align-items:center;gap:3vmin}
#cidot{flex:none;width:3vmin;height:3vmin;border-radius:50%;background:#6f7e99}
#cidot.success{background:#5bf0a0;box-shadow:0 0 2vmin rgba(91,240,160,.6)}
#cidot.failure{background:#ff6b6b;box-shadow:0 0 2vmin rgba(255,107,107,.6)}
#cidot.running,#cidot.queued{background:#ffb454;animation:blink 1.4s ease-in-out infinite}
#cibody{flex:1;min-width:0}
#cititle{font-size:3.4vmin;font-weight:600;margin-top:.4vmin}
#cisub{font-size:2.7vmin;color:#93a0b8;margin-top:.2vmin}
.aih{display:flex;justify-content:space-between;align-items:center;gap:2vmin}
.pill{flex:none;font-size:2.5vmin;padding:.6vmin 2vmin;border-radius:9vmin;background:rgba(91,240,160,.13);color:#5bf0a0;white-space:nowrap;display:flex;align-items:center;gap:1.2vmin;transition:background .35s ease,color .35s ease}
.pill:before{content:"";width:1.3vmin;height:1.3vmin;border-radius:50%;background:currentColor;animation:blink 1.6s ease-in-out infinite}
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
  #clock{flex:1;padding:2.4vmin}
  #time{font-size:min(13vw,34vh)}
  #left.busy #time{font-size:min(10.5vw,21vh)}
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
    <section class="tile" id="music" hidden>
      <div id="mtop">
        <div id="eq"><i></i><i></i><i></i><i></i></div>
        <div id="mbody"><div class="one" id="mtitle"></div><div class="one" id="martist"></div></div>
      </div>
      <div id="mprog">
        <div class="bar"><i id="mbar"></i></div>
        <div id="mtime"><span id="mpos"></span><span id="mdur"></span></div>
      </div>
      <div id="mctrls">
        <button class="mbtn" id="mprev" type="button" aria-label="Bài trước"><svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
        <button class="mbtn play" id="mplay" type="button" aria-label="Phát / Tạm dừng"><svg id="mplayico" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
        <button class="mbtn" id="mnext" type="button" aria-label="Bài tiếp"><svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>
      </div>
    </section>
    <section class="tile" id="clock">
      <div id="time">--<i>:</i>--</div>
      <div id="sec"><b id="secb"></b></div>
      <div id="date"></div>
      <div id="host"><i id="dot"></i><span id="hostn"></span></div>
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
var lastClockSec = -1
function tickClock() {
  var d = new Date(), s = d.getSeconds(), ms = d.getMilliseconds()
  $('secb').style.width = ((s + ms / 1000) / 60) * 100 + '%'
  if (s === lastClockSec) return
  lastClockSec = s
  $('time').firstChild.nodeValue = two(d.getHours())
  $('time').lastChild.nodeValue = two(d.getMinutes())
  $('date').textContent = DAYS[d.getDay()] + ', ' + two(d.getDate()) + ' tháng ' + (d.getMonth() + 1) + battery
}

// Smooth 60fps numeric interpolation & sparkline animation state.
var nums = {}
function animNum(key, target, render) {
  var n = nums[key]
  if (!n) {
    nums[key] = { cur: target, target: target, render: render }
    render(target)
    return
  }
  n.target = target
  n.render = render
}

var sparkTop = { cpu: 40, ram: 100, gpu: 40, net: 51200 }
var sparkSlide = { cpu: 1, ram: 1, gpu: 1, net: 1 }
var sampleSec = 1.0
var lastSampleAt = 0

// The newest value sits at the right edge and the chart glides left continuously at 60fps.
function spark(id, floor, ease) {
  var c = $(id + 's'), a = hist[id], w = c.clientWidth, h = c.clientHeight, r = window.devicePixelRatio || 1
  if (!w || !h) return
  var pw = Math.round(w * r), ph = Math.round(h * r)
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph }
  var g = c.getContext('2d')
  g.setTransform(r, 0, 0, r, 0, 0)
  g.clearRect(0, 0, w, h)
  if (a.length < 2) return
  var targetTop = Math.max(floor, Math.max.apply(null, a) * 1.15)
  var k = typeof ease === 'number' && Number.isFinite(ease) ? ease : 0.16
  if (!Number.isFinite(sparkTop[id])) sparkTop[id] = targetTop
  sparkTop[id] += (targetTop - sparkTop[id]) * k
  var top = sparkTop[id]
  var slide = sparkSlide[id]
  var stepX = w / 59
  var x0 = 59 - (a.length - 1)
  var pts = []
  for (var i = 0; i < a.length; i++) {
    var isLast = i === a.length - 1
    var val = isLast ? a[i - 1] + (a[i] - a[i - 1]) * slide : a[i]
    var px = isLast ? w : ((x0 + i) / 59) * w + (1 - slide) * stepX
    if (i === 0 && a.length >= 60) px = Math.min(px, 0)
    var py = h - 3 - (val / top) * (h - 7)
    pts.push({ x: Math.min(w, px), y: Math.max(2, Math.min(h - 2, py)) })
  }
  g.beginPath()
  g.moveTo(pts[0].x, pts[0].y)
  for (var j = 1; j < pts.length - 1; j++) {
    var mx = (pts[j].x + pts[j + 1].x) / 2, my = (pts[j].y + pts[j + 1].y) / 2
    g.quadraticCurveTo(pts[j].x, pts[j].y, mx, my)
  }
  var last = pts[pts.length - 1]
  g.lineTo(last.x, last.y)
  g.strokeStyle = 'rgba(' + RGB[id] + ',.78)'; g.lineWidth = 1.75; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke()
  g.lineTo(last.x, h); g.lineTo(pts[0].x, h); g.closePath()
  var f = g.createLinearGradient(0, 0, 0, h)
  f.addColorStop(0, 'rgba(' + RGB[id] + ',.28)'); f.addColorStop(1, 'rgba(' + RGB[id] + ',0)')
  g.fillStyle = f; g.fill()
  // Soft glowing tip at the newest sample
  g.beginPath(); g.arc(last.x - 1, last.y, 2.5, 0, Math.PI * 2)
  g.fillStyle = 'rgba(' + RGB[id] + ',.95)'; g.fill()
}
function sparks(ease) { spark('cpu', 40, ease); spark('ram', 100, ease); spark('gpu', 40, ease); spark('net', 51200, ease) }
function track(id, v) { hist[id].push(v); if (hist[id].length > 60) hist[id].shift(); sparkSlide[id] = 0 }

var lastRaf = performance.now()
function frameLoop(now) {
  var dt = Math.min(0.1, Math.max(0.001, (now - lastRaf) / 1000))
  lastRaf = now
  tickClock()
  var ease = 1 - Math.exp(-dt * 9)
  for (var k in nums) {
    var n = nums[k]
    if (n.cur === n.target) continue
    var diff = n.target - n.cur
    if (Math.abs(diff) < 0.05) n.cur = n.target
    else n.cur += diff * ease
    n.render(n.cur)
  }
  var needSpark = false
  var step = dt / Math.max(0.4, sampleSec)
  for (var id in sparkSlide) {
    if (sparkSlide[id] < 1) {
      sparkSlide[id] = Math.min(1, sparkSlide[id] + step)
      needSpark = true
    }
  }
  if (needSpark) sparks(1 - Math.exp(-dt * 7))
  requestAnimationFrame(frameLoop)
}
requestAnimationFrame(frameLoop)

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
  animNum('g:' + id, p, function (v) {
    $(id + 'v').textContent = Math.round(v)
    $(id + 'v').style.color = v >= 90 ? '#ff6b6b' : v >= 75 ? '#ffb454' : ''
  })
  track(id, p)
}
var CI = { success: 'thành công', failure: 'thất bại', running: 'đang chạy', queued: 'đang chờ', cancelled: 'đã hủy', other: 'đã xong' }
function show(m) {
  var nowMs = performance.now()
  if (lastSampleAt) {
    var gap = (nowMs - lastSampleAt) / 1000
    if (gap >= 0.4 && gap <= 3) sampleSec = sampleSec * 0.6 + gap * 0.4
  }
  lastSampleAt = nowMs
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
  animNum('ramUsed', s.memUsed, function (v) { $('ramf').textContent = gb(v) + ' / ' + gb(s.memTotal) + ' GB' })
  if (gpu) {
    gauge('gpu', s.gpu.load)
    $('gpuf').textContent = s.gpu.name.replace(/\((R|TM|C)\)/gi, '').replace(/^(Intel|NVIDIA|AMD)\s+/i, '').replace(/\s+/g, ' ').trim() || 'GPU'
  }
  if (net) {
    animNum('netDown', s.net.down, function (v) { $('netv').textContent = fmtRate(Math.round(v)) })
    animNum('netUp', s.net.up, function (v) { $('netf').textContent = '↑ ' + fmtRate(Math.round(v)) })
    track('net', s.net.down)
  }
  sparks()
  if (media) {
    $('mtitle').textContent = s.media.title
    // Just after a tap the PC may still report the old state: keep what the tap asked for until it agrees.
    var playing = s.media.playing
    if (mediaHold && performance.now() < mediaHold.until && mediaHold.playing !== playing) playing = mediaHold.playing
    else mediaHold = null
    $('martist').textContent = s.media.artist || (playing ? 'Đang phát' : 'Tạm dừng')
    playIcon(playing)
    // A single video or a live stream has no previous / next: show those buttons as unavailable.
    $('mprev').disabled = s.media.canPrev === false
    $('mnext').disabled = s.media.canNext === false
    var has = s.media.duration > 0
    $('mprog').hidden = !has
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
    var row = box.children[i], t = x.usage.today, r = x.usage.recent, b = row.querySelectorAll('.stats b'), pill = row.querySelector('.pill'), aiv = row.querySelector('.aiv')
    row.querySelector('.lab').textContent = x.name + ' · token hôm nay'
    animNum('ai:' + x.id + ':tot', t.input + t.output + t.cacheRead + t.cacheWrite, function (v) { aiv.textContent = fmtTokens(Math.round(v)) })
    animNum('ai:' + x.id + ':out', t.output, function (v) { b[0].textContent = fmtTokens(Math.round(v)) })
    animNum('ai:' + x.id + ':in', t.input + t.cacheWrite, function (v) { b[1].textContent = fmtTokens(Math.round(v)) })
    animNum('ai:' + x.id + ':cr', t.cacheRead, function (v) { b[2].textContent = fmtTokens(Math.round(v)) })
    animNum('ai:' + x.id + ':rec', r.input + r.output + r.cacheRead + r.cacheWrite, function (v) { b[3].textContent = fmtTokens(Math.round(v)) })
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
var mediaHold = null
function playIcon(on) {
  $('eq').className = on ? 'on' : ''
  $('mplayico').innerHTML = on
    ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
    : '<path d="M8 5v14l11-7z"/>'
}
function sendMedia(act) {
  var q = new URLSearchParams(location.search)
  fetch('/media?action=' + act + '&k=' + encodeURIComponent(q.get('k') || '')).catch(function () {})
  if (act === 'toggle') {
    var on = $('eq').className !== 'on'
    mediaHold = { playing: on, until: performance.now() + 4000 }
    playIcon(on)
  }
}
$('mprev').addEventListener('click', function (e) { e.stopPropagation(); sendMedia('prev') })
$('mplay').addEventListener('click', function (e) { e.stopPropagation(); sendMedia('toggle') })
$('mnext').addEventListener('click', function (e) { e.stopPropagation(); sendMedia('next') })
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
window.addEventListener('resize', function () { sparks() })
`

export function deskPageHtml(): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#000000"><title>ADB Kit · Bảng theo dõi</title><style>${CSS}</style></head><body>${BODY}<script>var fmtTokens = ${fmtTokens.toString()};var fmtRate = ${fmtRate.toString()};${JS}</script></body></html>`
}
