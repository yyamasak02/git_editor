import git from 'isomorphic-git'
import { createTwoFilesPatch, structuredPatch } from 'diff'

export interface Repo {
  fs: any
  dir: string
}

export type ChangeKind = 'added' | 'modified' | 'deleted' | 'untracked'
export interface Change {
  path: string
  kind: ChangeKind
}
export interface Status {
  staged: Change[]
  unstaged: Change[]
  conflicts: string[]
}

const gd = (r: Repo) => `${r.dir.replace(/\/$/, '')}/.git`
const MERGE_HEAD = 'MERGE_HEAD'
const MERGE_CONFLICTS = 'GITEDITOR_CONFLICTS'

const readGitFile = async (r: Repo, name: string) => {
  try {
    return (await r.fs.promises.readFile(`${gd(r)}/${name}`, 'utf8')) as string
  } catch {
    return null
  }
}
const writeGitFile = (r: Repo, name: string, text: string) =>
  r.fs.promises.writeFile(`${gd(r)}/${name}`, text)
const removeGitFile = async (r: Repo, name: string) => {
  try {
    await r.fs.promises.unlink(`${gd(r)}/${name}`)
  } catch {
    /* ignore */
  }
}

export async function isRepo(r: Repo) {
  try {
    await r.fs.promises.stat(gd(r))
    return true
  } catch {
    return false
  }
}

export const init = (r: Repo) => git.init({ ...r, defaultBranch: 'main' })

export async function getConflicts(r: Repo): Promise<string[]> {
  const t = await readGitFile(r, MERGE_CONFLICTS)
  return t ? JSON.parse(t) : []
}

export async function mergeInProgress(r: Repo) {
  return (await readGitFile(r, MERGE_HEAD)) !== null
}

export async function status(r: Repo): Promise<Status> {
  const conflicts = await getConflicts(r)
  const rows = await git.statusMatrix({ ...r })
  const staged: Change[] = []
  const unstaged: Change[] = []
  for (const [path, head, workdir, stage] of rows) {
    if (conflicts.includes(path)) continue
    if (head === 1 && workdir === 1 && stage === 1) continue
    if (head === 0 && stage !== 0) staged.push({ path, kind: 'added' })
    else if (head === 1 && stage === 0) staged.push({ path, kind: 'deleted' })
    else if (head === 1 && (stage === 2 || stage === 3)) staged.push({ path, kind: 'modified' })

    if (workdir === 0 && stage !== 0) unstaged.push({ path, kind: 'deleted' })
    else if (head === 0 && stage === 0 && workdir !== 0) unstaged.push({ path, kind: 'untracked' })
    else if (workdir !== 0 && (stage === 1 || stage === 3))
      unstaged.push({ path, kind: 'modified' })
  }
  return { staged, unstaged, conflicts }
}

export async function stage(r: Repo, c: Change) {
  if (c.kind === 'deleted') await git.remove({ ...r, filepath: c.path })
  else await git.add({ ...r, filepath: c.path })
}
export const unstage = (r: Repo, path: string) => git.resetIndex({ ...r, filepath: path })

export async function discard(r: Repo, c: Change) {
  if (c.kind === 'untracked') await r.fs.promises.unlink(`${r.dir.replace(/\/$/, '')}/${c.path}`)
  else await git.checkout({ ...r, filepaths: [c.path], force: true })
}

const dec = new TextDecoder()

async function readAt(r: Repo, ref: string, path: string): Promise<string> {
  try {
    const oid = await git.resolveRef({ ...r, ref })
    const { blob } = await git.readBlob({ ...r, oid, filepath: path })
    return dec.decode(blob)
  } catch {
    return ''
  }
}
async function readWork(r: Repo, path: string): Promise<string> {
  try {
    return (await r.fs.promises.readFile(`${r.dir.replace(/\/$/, '')}/${path}`, 'utf8')) as string
  } catch {
    return ''
  }
}
async function readIndex(r: Repo, path: string): Promise<string> {
  // ステージ済み内容: index の oid を直接読む
  const files = await git.listFiles({ ...r })
  if (!files.includes(path)) return ''
  const oid = (await git.walk({
    ...r,
    trees: [git.STAGE()],
    map: async (p, [e]) => (p === path ? e?.oid() : undefined),
  })) as any
  const found = Array.isArray(oid) ? oid.find(Boolean) : oid
  if (!found) return ''
  const { blob } = await git.readBlob({ ...r, oid: found })
  return dec.decode(blob)
}

export async function fileDiff(r: Repo, path: string, staged: boolean): Promise<string> {
  let a: string, b: string
  if (staged) {
    a = await readAt(r, 'HEAD', path)
    b = await readIndex(r, path)
  } else {
    a = await readIndex(r, path)
    b = await readWork(r, path)
    if (!a && !(await git.listFiles({ ...r })).includes(path)) a = ''
  }
  return createTwoFilesPatch(`a/${path}`, `b/${path}`, a, b, '', '', { context: 3 })
}

export async function stagedDiffText(r: Repo, maxChars = 20000): Promise<string> {
  const s = await status(r)
  let out = ''
  for (const c of s.staged) {
    out += await fileDiff(r, c.path, true)
    if (out.length > maxChars) return out.slice(0, maxChars) + '\n...(truncated)'
  }
  return out
}

export async function commit(r: Repo, message: string, name: string, email: string) {
  const author = { name, email }
  const mergeHead = (await readGitFile(r, MERGE_HEAD))?.trim()
  if (mergeHead) {
    if ((await getConflicts(r)).length) throw new Error('未解決のコンフリクトがあります')
    const head = await git.resolveRef({ ...r, ref: 'HEAD' })
    const oid = await git.commit({ ...r, message, author, parent: [head, mergeHead] })
    await removeGitFile(r, MERGE_HEAD)
    await removeGitFile(r, MERGE_CONFLICTS)
    return oid
  }
  return git.commit({ ...r, message, author })
}

export async function currentBranch(r: Repo) {
  return (await git.currentBranch({ ...r })) ?? '(detached)'
}
export const branches = (r: Repo) => git.listBranches({ ...r })
export const createBranch = (r: Repo, ref: string) => git.branch({ ...r, ref, checkout: true })
export const checkout = (r: Repo, ref: string) => git.checkout({ ...r, ref })

export interface LogEntry {
  oid: string
  message: string
  author: string
  time: number
  parents: string[]
}
export async function log(r: Repo, depth = 50): Promise<LogEntry[]> {
  try {
    const entries = await git.log({ ...r, depth })
    return entries.map(e => ({
      oid: e.oid,
      message: e.commit.message,
      author: e.commit.author.name,
      time: e.commit.author.timestamp,
      parents: e.commit.parent,
    }))
  } catch {
    return []
  }
}

// ---- merge ----
export type MergeResult = { kind: 'ok' | 'up-to-date' } | { kind: 'conflict'; files: string[] }

export async function merge(r: Repo, theirs: string): Promise<MergeResult> {
  const s = await status(r)
  if (s.staged.length || s.unstaged.some(c => c.kind !== 'untracked'))
    throw new Error('作業ツリーに未コミットの変更があります。先にコミットしてください')
  const theirOid = await git.resolveRef({ ...r, ref: theirs })
  try {
    const res = await git.merge({
      ...r,
      theirs,
      abortOnConflict: false,
      author: { name: 'git-editor', email: 'git-editor@localhost' },
    })
    return res.alreadyMerged ? { kind: 'up-to-date' } : { kind: 'ok' }
  } catch (e: any) {
    if (e?.code !== 'MergeConflictError') throw e
    const files: string[] = e.data.filepaths
    await writeGitFile(r, MERGE_HEAD, theirOid + '\n')
    await writeGitFile(r, MERGE_CONFLICTS, JSON.stringify(files))
    return { kind: 'conflict', files }
  }
}

export async function abortMerge(r: Repo) {
  await git.checkout({ ...r, ref: await currentBranch(r), force: true })
  await removeGitFile(r, MERGE_HEAD)
  await removeGitFile(r, MERGE_CONFLICTS)
}

// ---- conflict resolution ----
export type Segment =
  | { type: 'text'; text: string }
  | { type: 'conflict'; ours: string; theirs: string; oursLabel: string; theirsLabel: string }

export function parseConflicts(text: string): Segment[] {
  const lines = text.split('\n')
  const hasNL = text.endsWith('\n')
  if (hasNL) lines.pop()
  const segs: Segment[] = []
  let buf: string[] = []
  let i = 0
  const flush = () => {
    if (buf.length) segs.push({ type: 'text', text: buf.join('\n') + '\n' })
    buf = []
  }
  while (i < lines.length) {
    const m = /^<{7}(?: (.*))?$/.exec(lines[i])
    if (!m) {
      buf.push(lines[i++])
      continue
    }
    flush()
    const ours: string[] = []
    const theirs: string[] = []
    let theirsLabel = ''
    i++
    while (i < lines.length && !/^={7}$/.test(lines[i])) ours.push(lines[i++])
    i++
    while (i < lines.length) {
      const e = /^>{7}(?: (.*))?$/.exec(lines[i])
      if (e) {
        theirsLabel = e[1] ?? ''
        break
      }
      theirs.push(lines[i++])
    }
    i++
    segs.push({
      type: 'conflict',
      ours: ours.length ? ours.join('\n') + '\n' : '',
      theirs: theirs.length ? theirs.join('\n') + '\n' : '',
      oursLabel: m[1] ?? 'ours',
      theirsLabel,
    })
  }
  flush()
  const last = segs[segs.length - 1]
  if (!hasNL && last?.type === 'text') last.text = last.text.slice(0, -1)
  return segs
}

export async function conflictInfo(r: Repo, path: string) {
  const text = await readWork(r, path)
  const mergeHead = (await readGitFile(r, MERGE_HEAD))?.trim() ?? 'HEAD'
  const ours = await readAt(r, 'HEAD', path)
  const theirs = await readAt(r, mergeHead, path)
  return { text, segments: parseConflicts(text), ours, theirs }
}

export async function resolveFile(r: Repo, path: string, content: string) {
  await r.fs.promises.writeFile(`${r.dir.replace(/\/$/, '')}/${path}`, content)
  await git.add({ ...r, filepath: path })
  const rest = (await getConflicts(r)).filter(p => p !== path)
  await writeGitFile(r, MERGE_CONFLICTS, JSON.stringify(rest))
}

export { structuredPatch }
