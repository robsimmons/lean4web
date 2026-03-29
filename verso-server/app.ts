import express, { type Response } from 'express'
import { z } from 'zod'
import { mkdir, mkdtemp, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { compileLiterateHtml, OUTPUT_ROOT_DIR } from './exec.ts'

export const app = express()
app.use(express.json())

/**
 * POST requests don't work naturally with browsers and server-sent events:
 * the WebAPI-preferred way to handle SSE is with an `EventSource`, but
 * `EventSource` only initiates a GET request.
 *
 * The way we deal with this is a protocol: first, the client initiates a
 * stream, and the server immediately sends a `connect` event that contains a
 * UUID payload. Then, POST requests that have `?stream=<uuid>` in their query
 * will attempt to send information about incremental completion to the
 * SSE stream associated with that UUID.
 *
 * This also has the advantage of simplifying POST requests: the
 * request/response behavior of POST requests is unchanged by SSE, which exist
 * in a side channel.
 */
const trackingRequests: { [id: string]: Response } = {}

app.get('/literateHtml/api/stream', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const id = randomUUID()
  trackingRequests[id] = res
  console.log(`initializing server-sent event session for ${id}`)
  res.write('event: connect\n')
  res.write(`data: ${id}\n\n`)
  req.on('close', () => {
    console.log(`stream for ${id} ended with a 'close' event`)
    delete trackingRequests[id]
  })
  req.on('end', () => {
    console.log(`stream for ${id} ended with an 'end' event`)
    delete trackingRequests[id]
  })
})

const zBuildRequest = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.-]*$/),
  fileContents: z.string(),
})
app.post('/literateHtml/api/singlepage', async (req, res) => {
  const id: string | null = req.query.stream ? `${req.query.stream}` : null
  if (id) {
    if (id in trackingRequests) {
      console.log(`connected /literateHtml/api/singlepage to ${id}`)
    } else {
      console.log(`could not connect /literateHtml/api/singlepage to ${id}`)
    }
  }

  /** Report incremental progress to the SSE session */
  function sendProgress(obj: unknown) {
    if (id === null) return
    if (id in trackingRequests) {
      const txt = JSON.stringify(obj)
      trackingRequests[id].write('data: ' + txt + '\n\n')
    }
  }

  // Parse args
  const body = zBuildRequest.safeParse(req.body)
  if (!body.success) {
    res.status(400).send({ error: 'Poorly-formed request' })
    return
  } 

  // Run subcommand
  const [resultPath, subprocess] = await compileLiterateHtml(
    body.data.projectId,
    body.data.fileContents,
  )
  subprocess.stdout.on('data', (data) => {
    for (const line of `${data}`.trim().split('\n')) {
      sendProgress({ stream: 'stdout', contents: line })
    }
  })
  subprocess.stderr.on('data', (data) => {
    for (const line of `${data}`.trim().split('\n')) {
      sendProgress({ stream: 'stderr', contents: line })
    }
  })
  let finished = false
  subprocess.on('error', (data) => {
    finished = true
    res.send({ success: false, result: `${data}`.trim() })
  })
  subprocess.on('close', (data) => {
    if (finished) return
    if (data === 0) {
      sendProgress({ stream: 'stdout', contents: 'Finished successfully!' })
      res.send({ success: true, href: `/literateHtml/view/${resultPath}/` })
    } else {
      res.send({ success: false, result: `process returned non-zero exit code ${data}` })
    }
  })
})

console.log(`Serving static files from ${OUTPUT_ROOT_DIR}`)
app.use('/literateHtml/view', express.static(OUTPUT_ROOT_DIR))
