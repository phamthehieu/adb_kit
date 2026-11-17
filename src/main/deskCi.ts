// Latest GitHub Actions run of the repository the user typed in "Bảng theo dõi".
// Uses the GitHub CLI when it is installed (so private repositories work with the user's own
// sign-in) and the public API otherwise. The only thing sent is the repository name.
import { execFile } from 'node:child_process'
import { parseCiRuns, type CiRun } from '../shared/desk'

const EVERY_MS = 120_000

function viaGh(repo: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile('gh', ['api', `repos/${repo}/actions/runs?per_page=1`], { timeout: 20_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err)
      try {
        resolve(JSON.parse(stdout))
      } catch (e) {
        reject(e)
      }
    })
  })
}

async function viaApi(repo: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=1`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'adb-kit' },
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export class CiWatcher {
  private repo = ''
  private timer: NodeJS.Timeout | null = null
  private run: CiRun | null = null

  /** Watch `repo` ('' = stop). Asking for the repository already watched does nothing. */
  watch(repo: string): void {
    if (repo === this.repo) return
    this.stop()
    this.repo = repo
    if (!repo) return
    const tick = async (): Promise<void> => {
      let json: unknown
      try {
        json = await viaGh(repo)
      } catch {
        try {
          json = await viaApi(repo)
        } catch {
          return // offline, private without gh, rate limited: keep what we had
        }
      }
      if (this.repo === repo) this.run = parseCiRuns(json, repo)
    }
    void tick()
    this.timer = setInterval(() => void tick(), EVERY_MS)
  }

  latest(): CiRun | undefined {
    return this.run ?? undefined
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.repo = ''
    this.run = null
  }
}
