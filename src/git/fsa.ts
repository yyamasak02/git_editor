// File System Access API を isomorphic-git の fs.promises 互換にするアダプタ
class FsError extends Error {
  code: string
  constructor(code: string, path: string) {
    super(`${code}: ${path}`)
    this.code = code
  }
}

const norm = (p: string) => p.split('/').filter(Boolean)

export function createFsaFs(root: FileSystemDirectoryHandle) {
  const dirCache = new Map<string, FileSystemDirectoryHandle>([['', root]])

  async function getDir(parts: string[], path: string, create = false) {
    let cur = root
    let key = ''
    for (const part of parts) {
      key += '/' + part
      const cached = dirCache.get(key)
      if (cached) {
        cur = cached
        continue
      }
      try {
        cur = await cur.getDirectoryHandle(part, { create })
      } catch (e: any) {
        if (e.name === 'TypeMismatchError') throw new FsError('ENOTDIR', path)
        throw new FsError('ENOENT', path)
      }
      dirCache.set(key, cur)
    }
    return cur
  }

  const forgetDir = (path: string) => {
    const prefix = '/' + norm(path).join('/')
    for (const k of [...dirCache.keys()]) {
      if (k && (k === prefix || k.startsWith(prefix + '/'))) dirCache.delete(k)
    }
  }

  async function stat(path: string) {
    const parts = norm(path)
    if (parts.length === 0) return makeStat(true, 0, 0)
    const name = parts.pop()!
    const parent = await getDir(parts, path)
    try {
      const fh = await parent.getFileHandle(name)
      const f = await fh.getFile()
      return makeStat(false, f.size, f.lastModified)
    } catch (e: any) {
      if (e.name !== 'TypeMismatchError' && e.name !== 'NotFoundError') throw e
    }
    try {
      await parent.getDirectoryHandle(name)
      return makeStat(true, 0, 0)
    } catch {
      throw new FsError('ENOENT', path)
    }
  }

  function makeStat(isDir: boolean, size: number, mtimeMs: number) {
    return {
      type: isDir ? 'dir' : 'file',
      mode: isDir ? 0o40000 : 0o100644,
      size,
      ino: 0,
      mtimeMs,
      ctimeMs: mtimeMs,
      uid: 1,
      gid: 1,
      dev: 1,
      isFile: () => !isDir,
      isDirectory: () => isDir,
      isSymbolicLink: () => false,
    }
  }

  const promises = {
    async readFile(path: string, opts?: any) {
      const parts = norm(path)
      const name = parts.pop()
      if (!name) throw new FsError('EISDIR', path)
      const parent = await getDir(parts, path)
      let file: File
      try {
        file = await (await parent.getFileHandle(name)).getFile()
      } catch (e: any) {
        if (e.name === 'TypeMismatchError') throw new FsError('EISDIR', path)
        throw new FsError('ENOENT', path)
      }
      const enc = typeof opts === 'string' ? opts : opts?.encoding
      if (enc) return await file.text()
      return new Uint8Array(await file.arrayBuffer())
    },
    async writeFile(path: string, data: string | Uint8Array) {
      const parts = norm(path)
      const name = parts.pop()!
      const parent = await getDir(parts, path, true)
      const fh = await parent.getFileHandle(name, { create: true })
      const w = await fh.createWritable()
      await w.write(data as any)
      await w.close()
    },
    async unlink(path: string) {
      const parts = norm(path)
      const name = parts.pop()!
      const parent = await getDir(parts, path)
      try {
        await parent.removeEntry(name)
      } catch {
        throw new FsError('ENOENT', path)
      }
    },
    async readdir(path: string) {
      const dir = await getDir(norm(path), path)
      const names: string[] = []
      for await (const name of (dir as any).keys()) names.push(name)
      return names
    },
    async mkdir(path: string) {
      const parts = norm(path)
      if (parts.length === 0) return
      await getDir(parts.slice(0, -1), path)
      await getDir(parts, path, true)
    },
    async rmdir(path: string) {
      const parts = norm(path)
      const name = parts.pop()!
      const parent = await getDir(parts, path)
      forgetDir(path)
      try {
        await parent.removeEntry(name)
      } catch {
        throw new FsError('ENOENT', path)
      }
    },
    stat,
    lstat: stat,
    async readlink(path: string): Promise<string> {
      throw new FsError('ENOSYS', path)
    },
    async symlink(_t: string, path: string): Promise<void> {
      throw new FsError('ENOSYS', path)
    },
  }
  return { promises }
}
