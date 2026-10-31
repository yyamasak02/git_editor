import { useEffect, useState } from 'react'
import * as ops from '../git/ops'
import { suggestResolutions, type AiConfig } from '../ai'

type Choice = 'ours' | 'theirs' | 'both' | 'custom'
interface Props {
  repo: ops.Repo
  path: string
  ai: AiConfig
  onResolved: () => void
  onError: (e: unknown) => void
}

export function ConflictView({ repo, path, ai, onResolved, onError }: Props) {
  const [segments, setSegments] = useState<ops.Segment[]>([])
  const [choices, setChoices] = useState<Choice[]>([])
  const [custom, setCustom] = useState<string[]>([])
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ops.conflictInfo(repo, path).then(info => {
      const n = info.segments.filter(s => s.type === 'conflict').length
      setSegments(info.segments)
      setCustom(
        info.segments.filter(s => s.type === 'conflict').map(s => (s as any).ours as string),
      )
      setChoices(Array(n).fill('ours'))
    }, onError)
  }, [repo, path])

  const conflicts = segments.filter(s => s.type === 'conflict') as Extract<ops.Segment, { type: 'conflict' }>[]

  const textFor = (c: (typeof conflicts)[number], i: number) =>
    choices[i] === 'ours' ? c.ours
    : choices[i] === 'theirs' ? c.theirs
    : choices[i] === 'both' ? c.ours + c.theirs
    : custom[i]

  const result = () => {
    let i = 0
    return segments.map(s => (s.type === 'text' ? s.text : textFor(s, i++))).join('')
  }

  const setChoice = (i: number, c: Choice) =>
    setChoices(prev => prev.map((x, j) => (j === i ? c : x)))

  const runAi = async () => {
    setBusy(true)
    try {
      const out = await suggestResolutions(ai, path, segments, instruction)
      setCustom(out)
      setChoices(out.map(() => 'custom'))
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    try {
      await ops.resolveFile(repo, path, result())
      onResolved()
    } catch (e) {
      onError(e)
    }
  }

  return (
    <div className="conflict">
      <h3>{path} <small>({conflicts.length} 箇所のコンフリクト)</small></h3>
      <div className="row">
        <input
          placeholder="AIへの追加指示(任意)"
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
        />
        <button disabled={busy} onClick={runAi}>{busy ? 'AI解析中…' : '🤖 AIで解消案を作る'}</button>
        <button className="primary" onClick={apply}>解消済みにしてステージ</button>
      </div>
      {segments.map((s, idx) => {
        if (s.type === 'text') return <pre key={idx} className="ctx">{s.text}</pre>
        const i = conflicts.indexOf(s)
        return (
          <div key={idx} className="hunk">
            <div className="cols">
              <div><div className="lbl ours">ours: {s.oursLabel}</div><pre>{s.ours}</pre></div>
              <div><div className="lbl theirs">theirs: {s.theirsLabel}</div><pre>{s.theirs}</pre></div>
            </div>
            <div className="row">
              {(['ours', 'theirs', 'both', 'custom'] as Choice[]).map(c => (
                <button key={c} className={choices[i] === c ? 'on' : ''} onClick={() => setChoice(i, c)}>
                  {{ ours: 'ours採用', theirs: 'theirs採用', both: '両方', custom: '編集/AI案' }[c]}
                </button>
              ))}
            </div>
            {choices[i] === 'custom' ? (
              <textarea
                value={custom[i]}
                rows={Math.max(3, custom[i].split('\n').length)}
                onChange={e => setCustom(prev => prev.map((x, j) => (j === i ? e.target.value : x)))}
              />
            ) : (
              <pre className="result">{textFor(s, i)}</pre>
            )}
          </div>
        )
      })}
    </div>
  )
}
