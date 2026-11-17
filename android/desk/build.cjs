// Builds resources/adbkit-desk.apk from this folder with the Android SDK command-line tools
// (no Gradle): node android/desk/build.cjs
// Needs ANDROID_HOME (build-tools + one platform) and a JDK on PATH.
// The signing key is created on first use in ~/.adbkit/ and never enters the repository. An APK
// signed on another PC has another signature; ADB Kit then reinstalls the app instead of updating.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const here = __dirname
const out = path.join(here, 'build')
const win = process.platform === 'win32'
const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')].find((p) => p && fs.existsSync(p))
if (!sdk) throw new Error('Android SDK not found: set ANDROID_HOME')

const newest = (dir) => {
  const key = (n) => n.replace(/^android-/, '').split('.').map((x) => Number(x) || 0)
  const cmp = (a, b) => { const x = key(a), y = key(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0 }
  return path.join(dir, fs.readdirSync(dir).sort(cmp).pop())
}
const tools = newest(path.join(sdk, 'build-tools'))
const androidJar = path.join(newest(path.join(sdk, 'platforms')), 'android.jar')
const tool = (name, bat) => path.join(tools, win ? name + (bat ? '.bat' : '.exe') : name)
const quote = (a) => (/[\s"]/.test(a) ? `"${a}"` : a)

function run(cmd, args, cwd = here) {
  const r = win ? spawnSync([cmd, ...args].map(quote).join(' '), { cwd, shell: true, encoding: 'utf8' }) : spawnSync(cmd, args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} failed\n${r.stdout}${r.stderr}`)
  return r.stdout
}

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'classes'), { recursive: true })

run(tool('aapt2'), ['compile', '--dir', 'res', '-o', path.join(out, 'res.zip')])
run(tool('aapt2'), ['link', '-o', path.join(out, 'unsigned.apk'), '-I', androidJar, '--manifest', 'AndroidManifest.xml', path.join(out, 'res.zip')])
run('javac', ['-source', '8', '-target', '8', '-Xlint:-options', '-classpath', androidJar, '-d', path.join(out, 'classes'), path.join('src', 'dev', 'adbkit', 'desk', 'MainActivity.java')])
const classes = fs.readdirSync(path.join(out, 'classes', 'dev', 'adbkit', 'desk')).map((f) => path.join(out, 'classes', 'dev', 'adbkit', 'desk', f))
run(tool('d8', true), ['--release', '--min-api', '21', '--lib', androidJar, '--output', out, ...classes])
run(tool('aapt'), ['add', 'unsigned.apk', 'classes.dex'], out)
run(tool('zipalign'), ['-f', '4', path.join(out, 'unsigned.apk'), path.join(out, 'aligned.apk')])

const keyDir = path.join(os.homedir(), '.adbkit')
const keystore = path.join(keyDir, 'desk.keystore')
const pass = 'adbkit-desk' // protects nothing by itself: the keystore file is what stays private
if (!fs.existsSync(keystore)) {
  fs.mkdirSync(keyDir, { recursive: true })
  // keytool is often missing from PATH even when java is there: ask java where its home is.
  const props = spawnSync('java', ['-XshowSettings:properties', '-version'], { encoding: 'utf8' })
  const home = process.env.JAVA_HOME || (/java\.home = (.+)/.exec(props.stderr + props.stdout) || [])[1]
  const keytool = home && fs.existsSync(path.join(home.trim(), 'bin', win ? 'keytool.exe' : 'keytool')) ? path.join(home.trim(), 'bin', win ? 'keytool.exe' : 'keytool') : 'keytool'
  run(keytool, ['-genkeypair', '-keystore', keystore, '-storepass', pass, '-keypass', pass, '-alias', 'adbkit', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=ADB Kit Desk'])
  console.log('created signing key', keystore)
}
const apk = path.join(here, '..', '..', 'resources', 'adbkit-desk.apk')
run(tool('apksigner', true), ['sign', '--ks', keystore, '--ks-pass', `pass:${pass}`, '--key-pass', `pass:${pass}`, '--ks-key-alias', 'adbkit', '--out', apk, path.join(out, 'aligned.apk')])
fs.rmSync(apk + '.idsig', { force: true })
run(tool('apksigner', true), ['verify', apk])
console.log(run(tool('aapt2'), ['dump', 'badging', apk]).split('\n').slice(0, 4).join('\n'))
console.log('built', apk, fs.statSync(apk).size, 'bytes')
