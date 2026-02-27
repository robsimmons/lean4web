import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

export const OUTPUT_ROOT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'verso-output-'))
console.log(`Using the temporary directory ${OUTPUT_ROOT_DIR} for session storage`)

const sessions = new Map()

export function getSession(id) {
  return sessions.get(id)
}

export function sendToSession(id, str) {
  const session = sessions.get(id)
  if (!session) return
  session.response.write('data: ' + str + '\n\n')
}

/**
 * Clean up all information associated with a session. Does nothing if the
 * session is not valid or has already been deleted.
 */
async function closeSession(id) {
  const session = sessions.get(id)
  if (!session) {
    console.log(`Cannot clean up session ${id}, session does not exist`)
    return
  }
  delete sessions.delete(id)
  clearInterval(session.keepAlive)
  try {
    await Promise.all([
      fs.rm(session.mainDir, { recursive: true, force: true }),
      fs.rm(session.workDir, { recursive: true, force: true }),
    ])
  } catch (err) {
    console.log(`SESSION ${id}: error cleaning up directories: ${err}`)
  }
}

/**
 * Set up a "workbench" session for a specific connection
 */
export async function createSession(request, response) {
  // Set up headers for server-sent events
  response.setHeader('Cache-Control', 'no-cache')
  response.setHeader('Content-Type', 'text/event-stream')
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Connection', 'keep-alive')
  response.setHeader('X-Accel-Buffering', 'no')
  response.flushHeaders()

  // A session is associated with a set of directories
  const id = crypto.randomUUID()
  const mainDir = path.join(OUTPUT_ROOT_DIR, id)
  const workDir = path.join(OUTPUT_ROOT_DIR, id + '.work')
  await Promise.all([fs.mkdir(mainDir), fs.mkdir(workDir)])
  sessions.set(id, { response, mainDir, workDir, keepAlive: setInterval(() => response.write(`:\n\n`), 10 * 1000) })

  // Clients expect an immediate `connect` event
  console.log(`SESSION ${id} initialized`)
  response.write('event: connect\n')
  response.write(`data: ${id}\n\n`)

  // Clean up when the connection closes
  request.on('close', () => {
    console.log(`SESSION ${id} closing with a 'close' event`)
    void closeSession(id)
  })
  request.on('end', () => {
    console.log(`SESSION ${id} closing with a 'end' event`)
    void closeSession(id)
  })
}

const y = {
  id: 24,
  jsonrpc: '2.0',
  result: [
    {
      fullRange: { end: { character: 7, line: 28 }, start: { character: 0, line: 5 } },
      message: { tag: [{ expr: { text: 'Running finalizers' } }, { text: '' }] },
      range: { end: { character: 0, line: 6 }, start: { character: 0, line: 5 } },
      severity: 3,
      source: 'Lean 4',
    },
    {
      fullRange: { end: { character: 7, line: 28 }, start: { character: 0, line: 5 } },
      message: { tag: [{ expr: { text: 'Entering shortcutHTML finalizer' } }, { text: '' }] },
      range: { end: { character: 0, line: 6 }, start: { character: 0, line: 5 } },
      severity: 3,
      source: 'Lean 4',
    },
    {
      fullRange: { end: { character: 7, line: 28 }, start: { character: 0, line: 5 } },
      message: {
        append: [
          { tag: [{ expr: { text: 'Finalizer for ' } }, { text: '' }] },
          {
            tag: [
              {
                expr: {
                  text: '/var/folders/z2/drg_1r_n0f51j42f0ynk390c0000gn/T/verso-output-TZNZZU/28abbe51-8f5a-4c57-8242-175bd0382bd7',
                },
              },
              { text: '' },
            ],
          },
          { tag: [{ expr: { text: ' chosen' } }, { text: '' }] },
        ],
      },
      range: { end: { character: 0, line: 6 }, start: { character: 0, line: 5 } },
      severity: 3,
      source: 'Lean 4',
    },
    {
      fullRange: { end: { character: 7, line: 28 }, start: { character: 0, line: 5 } },
      message: {
        tag: [
          {
            expr: {
              text: '__WORKBENCH__ {"elapsed":575,"errors":[]}\nLean.Syntax.atom (Lean.SourceInfo.synthetic { byteIdx := 94 } { byteIdx := 547 } false) "#eval"\n',
            },
          },
          { text: '' },
        ],
      },
      range: { end: { character: 0, line: 6 }, start: { character: 0, line: 5 } },
      severity: 3,
      source: 'Lean 4',
    },
  ],
}

const x = {
  id: 28,
  jsonrpc: '2.0',
  result: [
    {
      fullRange: { end: { character: 3, line: 23 }, start: { character: 0, line: 18 } },
      message: { tag: [{ expr: { text: 'Running finalizers' } }, { text: '' }] },
      range: { end: { character: 0, line: 19 }, start: { character: 0, line: 18 } },
      severity: 3,
      source: 'Lean 4',
    },
    {
      fullRange: { end: { character: 3, line: 23 }, start: { character: 0, line: 18 } },
      message: { tag: [{ expr: { text: 'Entering shortcutHTML finalizer' } }, { text: '' }] },
      range: { end: { character: 0, line: 19 }, start: { character: 0, line: 18 } },
      severity: 3,
      source: 'Lean 4',
    },
    {
      fullRange: { end: { character: 3, line: 23 }, start: { character: 0, line: 18 } },
      message: {
        append: [
          { tag: [{ expr: { text: 'Finalizer for ' } }, { text: '' }] },
          {
            tag: [
              {
                expr: {
                  text: '/var/folders/z2/drg_1r_n0f51j42f0ynk390c0000gn/T/verso-output-GU2C16/1506e818-34e5-486f-b893-cad01843c5da',
                },
              },
              { text: '' },
            ],
          },
          { tag: [{ expr: { text: ' chosen' } }, { text: '' }] },
        ],
      },
      range: { end: { character: 0, line: 19 }, start: { character: 0, line: 18 } },
      severity: 3,
      source: 'Lean 4',
    },
    {
      fullRange: { end: { character: 3, line: 23 }, start: { character: 0, line: 18 } },
      message: {
        append: [
          { tag: [{ expr: { text: '__WORKBENCH__ ' } }, { text: '' }] },
          { tag: [{ expr: { text: '{"elapsed":588,"errors":[]}' } }, { text: '' }] },
        ],
      },
      range: { end: { character: 0, line: 19 }, start: { character: 0, line: 18 } },
      severity: 3,
      source: 'Lean 4',
    },
  ],
}
