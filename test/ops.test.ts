import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import * as ops from '../src/git/ops'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ge-'))
const r = { fs, dir }
const w = (f: string, t: string) => fs.writeFileSync(path.join(dir, f), t)

await ops.init(r)
w('a.txt', 'line1\nline2\nline3\n')
let s = await ops.status(r)
assert.deepEqual(s.unstaged, [{ path: 'a.txt', kind: 'untracked' }])
await ops.stage(r, s.unstaged[0])
s = await ops.status(r)
assert.equal(s.staged[0].kind, 'added')
await ops.commit(r, 'init', 'T', 't@t')
w('a.txt', 'line1\nmain-change\nline3\n')
s = await ops.status(r)
assert.deepEqual(s.unstaged, [{ path: 'a.txt', kind: 'modified' }])
console.log(await ops.fileDiff(r, 'a.txt', false))
await ops.stage(r, s.unstaged[0])
await ops.commit(r, 'main edit', 'T', 't@t')

await ops.createBranch(r, 'feature')
// feature: branch from main, so go back: create from earlier commit instead
await ops.checkout(r, 'main')
const log = await ops.log(r)
assert.equal(log.length, 2)
// make feature diverge from first commit
const git = (await import('isomorphic-git')).default
await git.branch({ fs, dir, ref: 'feat2', object: log[1].oid, checkout: true })
w('a.txt', 'line1\nfeat-change\nline3\n')
await ops.stage(r, { path: 'a.txt', kind: 'modified' })
await ops.commit(r, 'feat edit', 'T', 't@t')
await ops.checkout(r, 'main')

const res = await ops.merge(r, 'feat2')
console.log(res)
assert.equal(res.kind, 'conflict')
s = await ops.status(r)
assert.deepEqual(s.conflicts, ['a.txt'])
const info = await ops.conflictInfo(r, 'a.txt')
console.log(info.text, info.segments)
assert.equal(info.segments.filter(x => x.type === 'conflict').length, 1)
assert.equal(info.segments.map(x => x.type === 'text' ? x.text : x.ours).join(''), 'line1\nmain-change\nline3\n')
await assert.rejects(ops.commit(r, 'm', 'T', 't@t'))
await ops.resolveFile(r, 'a.txt', 'line1\nboth\nline3\n')
s = await ops.status(r)
assert.deepEqual(s.conflicts, [])
const oid = await ops.commit(r, 'merge', 'T', 't@t')
const l2 = await ops.log(r)
assert.equal(l2[0].parents.length, 2)
assert.equal((await ops.status(r)).staged.length, 0)

// abort flow
await ops.checkout(r, 'feat2')
await git.branch({ fs, dir, ref: 'x', checkout: true })
console.log('ALL OK', oid)
