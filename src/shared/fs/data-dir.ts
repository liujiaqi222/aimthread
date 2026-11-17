/**
 * Data directory resolution (#52 / #64).
 *
 * Precedence:
 *   1. AIMTHREAD_DATA_DIR environment variable (overrides both modes)
 *   2. packaged app: Electron's userData path
 *   3. dev: a platform-default "AimThread-dev" directory, kept separate from
 *      any real installation's data so the two never share a database.
 */

export interface ResolveDataDirOptions {
  env: Record<string, string | undefined>
  isPackaged: boolean
  /** Electron app.getPath('userData'); required when isPackaged is true. */
  electronUserData?: string
  homedir: string
  platform: string
}

function platformDefaultDevDir(homedir: string, platform: string): string {
  if (platform === 'darwin') {
    return `${homedir}/Library/Application Support/AimThread-dev`
  }
  if (platform === 'win32') {
    return `${homedir}/AppData/Roaming/AimThread-dev`
  }
  // Linux / others: XDG convention.
  return `${homedir}/.local/share/AimThread-dev`
}

export function resolveDataDir(opts: ResolveDataDirOptions): string {
  const fromEnv = opts.env['AIMTHREAD_DATA_DIR']
  if (fromEnv && fromEnv.trim() !== '') return fromEnv

  if (opts.isPackaged) {
    if (!opts.electronUserData) {
      throw new Error('electronUserData is required for packaged apps')
    }
    return opts.electronUserData
  }
  return platformDefaultDevDir(opts.homedir, opts.platform)
}
