import { useCallback, useEffect, useState } from 'react'
import { addRepoName, listRepos, openRepoFs, removeRepo } from '../git/browserfs'
import * as ops from '../git/ops'
import * as remote from '../git/remote'
import { suggestCommitMessage, type AiConfig } from '../ai'
import { ConflictView } from './ConflictView'

type Sel =
  | { kind: 'diff'; path: string; staged: boolean }
  | { kind: 'conflict'; path: string }
  | { kind: 'edit'; path: string }
  | null

const loadAi = (): AiConfig => ({
  apiKey: localStorage.getItem('ge.apiKey') ?? '',
  model: localStorage.getItem('ge.model') ?? 'claude-sonnet-5-5',
})

export function App() {
  const [repo, setRepo] = useState<ops.Repo | null>(null)
  const [folder, setFolder] = useState('')
  const [names, setNames] = useState<string[]>(listRepos)
  const [files, setFiles] = useState<string[]>([])
  const [net, setNet] = useState({
    token: localStorage.getItem('ge.token') ?? '',
    corsProxy: localStorage.getItem('ge.proxy') ?? 'https://cors.isomorphic-git.org',
  })
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<ops.Status | null>(null)
  const [branch, setBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [log, setLog] = useState<ops.LogEntry[]>([])
  const [merging, setMerging] = useState(false)
  const [sel, setSel] = useState<Sel>(null)
  const [diff, setDiff] = useState('')
  const [msg, setMsg] = useState('')
  const [ai, setAi] = useState<AiConfig>(loadAi)
  const [showSettings, setShowSettings] = useState(false)
  const [err, setErr] = useState('')
  const [author, setAuthor] = useState({
    name: localStorage.getItem('ge.name') ?? '',
    email: localStorage.getItem('ge.email') ?? '',
  })

  const onError = (e: unknown) => setErr(e instanceof Error ? e.message : String(e))

  const refresh = useCallback(async (r: ops.Repo | null = repo) => {
    if (!r) return
    try {
      setStatus(await ops.status(r))
      setBranch(await ops.currentBranch(r))
      setBranches(await ops.branches(r))
      setLog(await ops.log(r))
      setMerging(await ops.mergeInProgress(r))
      setFiles(await remote.listFiles(r))
    } catch (e) {
      onError(e)
    }
  }, [repo])

  const attach = async (name: string) => {
    const r = { fs: openRepoFs(name), dir: '/' }
    setRepo(r)
    setFolder(name)
    setSel(null)
    await refresh(r)
  }

  const registerName = (name: string) => {
    addRepoName(name)
    setNames(listRepos())
  }

  const newRepo = async () => {
    const name = prompt('新しいリポジトリ名')?.trim()
    if (!name) return
    try {
      const r = { fs: openRepoFs(name), dir: '/' }
      if (!(await ops.isRepo(r))) await ops.init(r)
      registerName(name)
      await attach(name)
    } catch (e) {
      onError(e)
    }
  }

  const cloneRepo = async () => {
    const url = prompt('clone するURL (https://github.com/user/repo)')?.trim()
    if (!url) return
    const name = url.replace(/\.git$/, '').split('/').pop() || 'repo'
    setBusy(true)
    try {
      setErr('')
      removeRepo(name)
      const r = { fs: openRepoFs(name), dir: '/' }
      await remote.clone(r, url, net)
      registerName(name)
      await attach(name)
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  const deleteRepo = () => {
    if (!repo || !confirm(`「${folder}」を端末から削除しますか?(未pushの変更は失われます)`)) return
    removeRepo(folder)
    setNames(listRepos())
    setRepo(null)
    setStatus(null)
  }

  const openRepo = (name: string) => name && attach(name).catch(onError)

  useEffect(() => {
    if (sel?.kind !== 'diff' || !repo) return setDiff('')
    ops.fileDiff(repo, sel.path, sel.staged).then(setDiff, onError)
  }, [sel, status])

  const act = (fn: () => Promise<unknown>) => async () => {
    try {
      setErr('')
      await fn()
    } catch (e) {
      onError(e)
    }
    await refresh()
  }

  const doCommit = act(async () => {
    if (!author.name || !author.email) throw new Error('設定でユーザー名とメールを入力してください')
    await ops.commit(repo!, msg, author.name, author.email)
    setMsg('')
    setSel(null)
  })

  const doMerge = (b: string) =>
    act(async () => {
      const res = await ops.merge(repo!, b)
      if (res.kind === 'conflict') setSel({ kind: 'conflict', path: res.files[0] })
    })()

  const genMsg = act(async () => {
    setMsg(await suggestCommitMessage(ai, await ops.stagedDiffText(repo!)))
  })

  const doPush = act(async () => {
    setBusy(true)
    try { await remote.push(repo!, net) } finally { setBusy(false) }
  })
  const doPull = act(async () => {
    setBusy(true)
    try { await remote.pull(repo!, net, author.name, author.email) } finally { setBusy(false) }
  })

  return (
    <div className="app">
      <header>
        <select value={repo ? folder : ''} onChange={e => openRepo(e.target.value)}>
          <option value="">📂 リポジトリ…</option>
          {names.map(n => <option key={n}>{n}</option>)}
        </select>
        <button onClick={newRepo}>＋新規</button>
        <button onClick={cloneRepo} disabled={busy}>⬇ clone</button>
        {repo && (
          <>
            <button onClick={doPull} disabled={busy}>pull</button>
            <button onClick={doPush} disabled={busy}>push</button>
            <button onClick={deleteRepo}>🗑</button>
            <select value={branch} onChange={e => act(() => ops.checkout(repo, e.target.value))()}>
              {branches.map(b => <option key={b}>{b}</option>)}
            </select>
            <button onClick={() => { const n = prompt('新しいブランチ名'); if (n) act(() => ops.createBranch(repo, n))() }}>＋ブランチ</button>
            <select value="" onChange={e => e.target.value && doMerge(e.target.value)}>
              <option value="">マージ…</option>
              {branches.filter(b => b !== branch).map(b => <option key={b} value={b}>{b} を {branch} へ</option>)}
            </select>
            <button onClick={() => refresh()}>⟳</button>
          </>
        )}
        <span className="spacer" />
        <button onClick={() => setShowSettings(s => !s)}>⚙ 設定</button>
      </header>

      {err && <div className="error" onClick={() => setErr('')}>{err}</div>}
      {showSettings && (
        <div className="settings">
          <label>Anthropic APIキー(この端末のlocalStorageにのみ保存)
            <input type="password" value={ai.apiKey}
              onChange={e => { setAi({ ...ai, apiKey: e.target.value }); localStorage.setItem('ge.apiKey', e.target.value) }} />
          </label>
          <label>モデル
            <input value={ai.model}
              onChange={e => { setAi({ ...ai, model: e.target.value }); localStorage.setItem('ge.model', e.target.value) }} />
          </label>
          <label>GitHub トークン(clone/push/pull 用、この端末のlocalStorageにのみ保存)
            <input type="password" value={net.token}
              onChange={e => { setNet({ ...net, token: e.target.value }); localStorage.setItem('ge.token', e.target.value) }} />
          </label>
          <label>CORSプロキシ(トークンはこのプロキシ経由で送信されます。自前推奨)
            <input value={net.corsProxy}
              onChange={e => { setNet({ ...net, corsProxy: e.target.value }); localStorage.setItem('ge.proxy', e.target.value) }} />
          </label>
          <label>コミッター名
            <input value={author.name}
              onChange={e => { setAuthor({ ...author, name: e.target.value }); localStorage.setItem('ge.name', e.target.value) }} />
          </label>
          <label>メール
            <input value={author.email}
              onChange={e => { setAuthor({ ...author, email: e.target.value }); localStorage.setItem('ge.email', e.target.value) }} />
          </label>
        </div>
      )}

      {busy && <div className="merge-banner">通信中…</div>}

      {!repo && <div className="center">リポジトリを選ぶか、「＋新規」「⬇ clone」で作成してください。</div>}

      {repo && status && (
        <div className="main">
          <aside>
            {merging && (
              <div className="merge-banner">
                マージ中
                <button onClick={act(async () => { await ops.abortMerge(repo); setSel(null) })}>中止</button>
              </div>
            )}
            {status.conflicts.length > 0 && (
              <Section title={`コンフリクト (${status.conflicts.length})`}>
                {status.conflicts.map(p => (
                  <Row key={p} label={`⚠ ${p}`} active={sel?.kind === 'conflict' && sel.path === p}
                    onClick={() => setSel({ kind: 'conflict', path: p })} />
                ))}
              </Section>
            )}
            <Section title={`ファイル (${files.length})`}
              extra={<button onClick={() => { const p = prompt('新規ファイルのパス(例: docs/a.md)')?.trim(); if (p) act(() => remote.writeText(repo, p, ''))().then(() => setSel({ kind: 'edit', path: p })) }}>＋</button>}>
              {files.map(p => (
                <Row key={p} label={p} active={sel?.kind === 'edit' && sel.path === p}
                  onClick={() => setSel({ kind: 'edit', path: p })} />
              ))}
            </Section>
            <Section title={`ステージ済み (${status.staged.length})`}>
              {status.staged.map(c => (
                <Row key={c.path} label={`${badge(c.kind)} ${c.path}`}
                  active={sel?.kind === 'diff' && sel.path === c.path && sel.staged}
                  onClick={() => setSel({ kind: 'diff', path: c.path, staged: true })}
                  action="−" onAction={act(() => ops.unstage(repo, c.path))} />
              ))}
            </Section>
            <Section title={`変更 (${status.unstaged.length})`}
              extra={status.unstaged.length > 0 && <button onClick={act(async () => { for (const c of status.unstaged) await ops.stage(repo, c) })}>全てステージ</button>}>
              {status.unstaged.map(c => (
                <Row key={c.path} label={`${badge(c.kind)} ${c.path}`}
                  active={sel?.kind === 'diff' && sel.path === c.path && !sel.staged}
                  onClick={() => setSel({ kind: 'diff', path: c.path, staged: false })}
                  action="＋" onAction={act(() => ops.stage(repo, c))}
                  action2="↩" onAction2={() => confirm(`${c.path} の変更を破棄しますか?`) && act(() => ops.discard(repo, c))()} />
              ))}
            </Section>
            <div className="commit">
              <textarea placeholder="コミットメッセージ" value={msg} onChange={e => setMsg(e.target.value)} rows={4} />
              <div className="row">
                <button onClick={genMsg} disabled={!status.staged.length}>🤖 生成</button>
                <button className="primary" onClick={doCommit}
                  disabled={!msg.trim() || status.conflicts.length > 0 || (!status.staged.length && !merging)}>
                  {merging ? 'マージをコミット' : 'コミット'}
                </button>
              </div>
            </div>
            <Section title="履歴">
              {log.map(l => (
                <div key={l.oid} className="log" title={l.oid}>
                  <span className="oid">{l.oid.slice(0, 7)}</span> {l.message.split('\n')[0]}
                  <small> — {l.author}</small>
                </div>
              ))}
            </Section>
          </aside>
          <section className="content">
            {sel?.kind === 'conflict' && (
              <ConflictView key={sel.path} repo={repo} path={sel.path} ai={ai} onError={onError}
                onResolved={async () => { setSel(null); await refresh() }} />
            )}
            {sel?.kind === 'diff' && <DiffView text={diff} />}
            {sel?.kind === 'edit' && (
              <Editor key={sel.path} repo={repo} path={sel.path} onError={onError} onSaved={() => refresh()} />
            )}
            {!sel && <div className="center">左の一覧からファイルを選択</div>}
          </section>
        </div>
      )}
    </div>
  )
}

const badge = (k: ops.ChangeKind) => ({ added: 'A', modified: 'M', deleted: 'D', untracked: 'U' })[k]

function Section({ title, extra, children }: { title: string; extra?: React.ReactNode; children?: React.ReactNode }) {
  return <div className="section"><div className="title">{title}{extra}</div>{children}</div>
}

function Row(p: { label: string; active: boolean; onClick: () => void; action?: string; onAction?: () => void; action2?: string; onAction2?: () => void }) {
  return (
    <div className={'item' + (p.active ? ' active' : '')} onClick={p.onClick}>
      <span className="name">{p.label}</span>
      {p.action2 && <button onClick={e => { e.stopPropagation(); p.onAction2!() }}>{p.action2}</button>}
      {p.action && <button onClick={e => { e.stopPropagation(); p.onAction!() }}>{p.action}</button>}
    </div>
  )
}

function Editor({ repo, path, onError, onSaved }: { repo: ops.Repo; path: string; onError: (e: unknown) => void; onSaved: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  useEffect(() => { remote.readText(repo, path).then(setText, onError) }, [repo, path])
  if (text === null) return <div className="center">読み込み中…</div>
  const save = () => remote.writeText(repo, path, text).then(() => { setDirty(false); onSaved() }, onError)
  return (
    <div className="editor">
      <div className="row"><b>{path}</b><button className="primary" onClick={save} disabled={!dirty}>保存</button></div>
      <textarea value={text} spellCheck={false} onChange={e => { setText(e.target.value); setDirty(true) }} />
    </div>
  )
}

function DiffView({ text }: { text: string }) {
  if (!text.trim()) return <div className="center">差分なし</div>
  return (
    <pre className="diff">
      {text.split('\n').map((l, i) => (
        <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk-h' : ''}>{l || ' '}</div>
      ))}
    </pre>
  )
}
