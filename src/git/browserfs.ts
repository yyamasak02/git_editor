// iPhone(WebKit)対応: File System Access API の代わりに IndexedDB ベースの lightning-fs を使う。
// リポジトリごとに別DB(ge-repo-<name>)を持つ。
import LightningFS from '@isomorphic-git/lightning-fs'

const KEY = 'ge.repos'

export const listRepos = (): string[] => JSON.parse(localStorage.getItem(KEY) ?? '[]')
const saveRepos = (l: string[]) => localStorage.setItem(KEY, JSON.stringify(l))

export const addRepoName = (name: string) => {
  const l = listRepos()
  if (!l.includes(name)) saveRepos([...l, name])
}

export function removeRepo(name: string) {
  saveRepos(listRepos().filter(n => n !== name))
  indexedDB.deleteDatabase(`ge-repo-${name}`)
}

export const openRepoFs = (name: string) => new LightningFS(`ge-repo-${name}`)
