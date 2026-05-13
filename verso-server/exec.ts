import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const IS_DEV = process.env.NODE_ENV === 'development'
const PROJ_ROOT = process.env.PROJ_ROOT || 'Projects'
export const OUTPUT_ROOT_DIR = await mkdtemp(join(tmpdir(), 'verso-output-'))

/**
 * Spawn a process that, upon success, will put Literate HTML output in the provided
 * directory.
 *
 * @param projectId - the project key (e.g. `"verso-server"`)
 * @param theLeanFileContents - text contents of a single-file Lean document
 * @returns [outDir, process] - a process and where it's writing its files
 */
export async function compileLiterateHtml(
  projectId: string,
  theLeanFileContents: string,
): Promise<[string, ChildProcessWithoutNullStreams]> {
  const outputDirName = randomUUID()
  const outputDir = join(OUTPUT_ROOT_DIR, outputDirName)
  await mkdir(outputDir)
  const projDir = join(PROJ_ROOT, projectId)
  const theLeanFileLoc = join(projDir, 'TheLeanFile.lean')
  const outputSubDir = join(outputDir, '.lake', 'build', 'literate-html')
  await mkdir(join(outputDir, '.lake'))
  await mkdir(join(outputDir, '.lake', 'build'))
  await mkdir(join(outputDir, '.lake', 'build', 'literate-html'))
  await writeFile(theLeanFileLoc, theLeanFileContents)

  if (IS_DEV) {
    console.log('DEVELOPMENT WARNING: running lake without bubblewrap!')
    try {
      await rm(join(PROJ_ROOT, projectId, '.lake', 'build', 'literate-html'), {
        recursive: true,
        force: true,
      })
    } catch (e) {
      /* ignore */
    }
    try {
      await unlink(join(PROJ_ROOT, projectId, '.lake', 'build', 'lib', 'lean', 'TheLeanFile.olean'))
      await unlink(
        join(PROJ_ROOT, projectId, '.lake', 'build', 'lib', 'lean', 'TheLeanFile.olean.hash'),
      )
      await unlink(join(PROJ_ROOT, projectId, '.lake', 'build', 'lib', 'lean', 'TheLeanFile.trace'))
    } catch (e) {
      /* ignore */
    }
    await symlink(outputSubDir, join(PROJ_ROOT, projectId, '.lake', 'build', 'literate-html'))
    return [
      join(outputDirName, '.lake', 'build', 'literate-html'),
      spawn('lake', ['build', ':literateHtml'], { cwd: projDir }),
    ]
  } else {
    const workDirName = `${outputDirName}.workdir`
    const workDir = join(OUTPUT_ROOT_DIR, workDirName)
    await mkdir(workDir)
    return [
      join(outputDirName, '.lake', 'build', 'literate-html'),
      spawn(join(import.meta.dirname, 'bubblewrap.sh'), [projDir, workDir, outputDir], {
        cwd: projDir,
      }),
    ]
  }
}
