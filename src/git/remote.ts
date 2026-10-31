// リモート操作 / ファイル編集(ブラウザ内リポジトリ用)
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/web'
import type { Repo } from './ops'

export interface Remote {
  token: string
  corsProxy: string
}

const auth = (t: Remote) => ({
  http,
  corsProxy: t.corsProxy || undefined,
  onAuth: () => ({ username: t.token, password: 'x-oauth-basic' }),
})

export const clone = (r: Repo, url: string, t: Remote) =>
  git.clone({ ...r, ...auth(t), url, singleBranch: true, depth: 50 })

export async function push(r: Repo, t: Remote) {
  const res = await git.push({ ...r, ...auth(t), remote: 'origin' })
  if (!res.ok) throw new Error(res.error ?? 'push に失敗しました')
}

export async function pull(r: Repo, t: Remote, name: string, email: string) {
  await git.pull({ ...r, ...auth(t), author: { name, email } })
}

export async function listFiles(r: Repo): Promise<string[]> {
  const set = new Set(await git.listFiles({ ...r }))
  const walk = async (d: string) => {
    for (const n of await r.fs.promises.readdir(d)) {
      if (n === '.git') continue
      const p = d === '/' ? '/' + n : d + '/' + n
      if ((await r.fs.promises.stat(p)).isDirectory()) await walk(p)
      else set.add(p.slice(1))
    }
  }
  await walk('/')
  return [...set].sort()
}

export const readText = (r: Repo, path: string): Promise<string> =>
  r.fs.promises.readFile('/' + path, 'utf8')

export async function writeText(r: Repo, path: string, text: string) {
  let cur = ''
  for (const p of path.split('/').slice(0, -1)) {
    cur += '/' + p
    await r.fs.promises.mkdir(cur).catch(() => {})
  }
  await r.fs.promises.writeFile('/' + path, text, 'utf8')
}
