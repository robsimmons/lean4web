import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const IS_DEV = process.env.NODE_ENV === 'development'
const PROJ_ROOT = resolve(process.env.PROJ_ROOT || './Projects');
export const OUTPUT_ROOT_DIR = await mkdtemp(join(tmpdir(), 'verso-output-'))

/**
 * Spawn a process that, upon success, will put Verso output in the provided
 * directory.
 *
 * @param projectId - the project key (e.g. `"verso-server"`)
 * @param theLeanFileContents - text contents of a single-file Lean document
 * @returns [outDir, process] - a process and where it's writing its files
 */
export async function compileVerso(
  projectId: string,
  theLeanFileContents: string,
): Promise<[string, ChildProcessWithoutNullStreams]> {
  const outputDirName = randomUUID()
  const outputDir = join(OUTPUT_ROOT_DIR, outputDirName)
  await mkdir(outputDir)
  const projDir = join(PROJ_ROOT, projectId)
  const theLeanFileLoc = join(outputDir, 'TheLeanFile.lean')
  await writeFile(theLeanFileLoc, theLeanFileContents)

  if (IS_DEV) {
    console.log('DEVELOPMENT WARNING: running lake without bubblewrap!' + PROJ_ROOT+ '//' +projDir)
    return [
      join(outputDirName, '_out'),
      spawn(join(import.meta.dirname, 'no-bubblewrap.sh'), [projDir, theLeanFileLoc, outputDir], {
        cwd: projDir,
      }),
    ]
  } else {
    const workDirName = `${outputDirName}.workdir`
    const workDir = join(OUTPUT_ROOT_DIR, workDirName)
    await mkdir(workDir)
    return [
      join(outputDirName, '_out'),
      spawn(join(import.meta.dirname, 'bubblewrap.sh'), [projDir, workDir, outputDir], {
        cwd: projDir,
      }),
    ]
  }
}
