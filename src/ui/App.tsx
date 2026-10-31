import { useCallback, useEffect, useState } from 'react'
import { createFsaFs } from '../git/fsa'
import * as ops from '../git/ops'
import { suggestCommitMessage, type AiConfig } from '../ai'
import { ConflictView } from './ConflictView'

type Sel = { kind: 'diff'; path: string; staged: boolean } | { kind: 'conflict'; path: string } | null

const loadAi = (): AiConfig => ({
  apiKey: localStorage.getItem('ge.apiKey') ?? '',
  model: localStorage.getItem('ge.model') ?? 'claude-sonnet-5-5',
})

export function App() {
  const [repo, setRepo] = useState<ops.Repo | null>(null)
  const [folder, setFolder] = useState('')
  const [needInit, setNeedInit] = useState<FileSystemDirectoryHandle | null>(null)
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
    } catch (e) {
      onError(e)
    }
  }, [repo])

  const attach = async (h: FileSystemDirectoryHandle) => {
    const r = { fs: createFsaFs(h), dir: '/' }
    setRepo(r)
    setFolder(h.name)
    setSel(null)
    setNeedInit(null)
    await refresh(r)
  }

  const openFolder = async () => {
    try {
      const h = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
      const r = { fs: createFsaFs(h), dir: '/' }
      if (await ops.isRepo(r)) await attach(h)
      else setNeedInit(h)
    } catch (e: any) {
      if (e?.name !== 'AbortError') onError(e)
    }
  }

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

  if (!('showDirectoryPicker' in window))
    return <div className="center">このブラウザは File System Access API 非対応です。Chrome / Edge を使ってください。</div>

  return (
    <div className="app">
      <header>
        <button className="primary" onClick={openFolder}>📂 フォルダを開く</button>
        {repo && (
          <>
            <b>{folder}</b>
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

      {needInit && (
        <div className="center">
          <p>「{needInit.name}」はgitリポジトリではありません。</p>
          <button className="primary" onClick={async () => {
            const r = { fs: createFsaFs(needInit), dir: '/' }
            await ops.init(r).catch(onError)
            await attach(needInit)
          }}>git init する</button>
        </div>
      )}

      {!repo && !needInit && <div className="center">「フォルダを開く」でgitリポジトリを選択してください。</div>}

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
