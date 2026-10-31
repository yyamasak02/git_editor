import type { Segment } from './git/ops'

export interface AiConfig {
  apiKey: string
  model: string
}

async function ask(cfg: AiConfig, system: string, user: string, maxTokens = 4096): Promise<string> {
  if (!cfg.apiKey) throw new Error('設定でAnthropic APIキーを入力してください')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return (json.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('')
}

export async function suggestResolutions(
  cfg: AiConfig,
  path: string,
  segments: Segment[],
  instruction: string,
): Promise<string[]> {
  const conflicts = segments.filter(s => s.type === 'conflict') as Extract<Segment, { type: 'conflict' }>[]
  const doc = segments
    .map((s, _i) => {
      if (s.type === 'text') return s.text
      const n = conflicts.indexOf(s)
      return `<<<<<<< CONFLICT ${n} (${s.oursLabel})\n${s.ours}=======\n${s.theirs}>>>>>>> (${s.theirsLabel})\n`
    })
    .join('')
  const system =
    'あなたはgitのマージコンフリクト解消の専門家です。双方の変更の意図を保持して各コンフリクトを解消してください。' +
    '出力は JSON 配列(文字列の配列)のみ。i番目の要素がCONFLICT iを置き換える最終テキスト(末尾改行含む)。説明文やコードフェンスは出力しないこと。'
  const user = `ファイル: ${path}\n追加指示: ${instruction || 'なし'}\n\n${doc}`
  const out = await ask(cfg, system, user, 8192)
  const m = /\[[\s\S]*\]/.exec(out)
  if (!m) throw new Error('AIの応答を解釈できませんでした: ' + out.slice(0, 200))
  const arr = JSON.parse(m[0])
  if (!Array.isArray(arr) || arr.length !== conflicts.length || arr.some(x => typeof x !== 'string'))
    throw new Error('AIの応答の件数が一致しません')
  return arr
}

export function suggestCommitMessage(cfg: AiConfig, diff: string) {
  return ask(
    cfg,
    'ステージされた差分から、簡潔なgitコミットメッセージ(1行目は72文字以内、必要なら空行の後に本文)を日本語または差分の言語に合わせて作成。メッセージ本文のみ出力。',
    diff,
    512,
  ).then(t => t.trim())
}
