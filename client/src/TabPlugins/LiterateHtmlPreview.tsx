import { useEffect, useRef, useState } from 'react'
import { LeanWebPlugin } from '../config/docs'

interface LiterateHtmlPreviewProps {
  code: string
  currentTab: 'info' | LeanWebPlugin
}

const headers = new Headers()
headers.append('Content-Type', 'application/json')

let nextCallback: [string, (resp: any) => void] | null = null
let registeredCallback: ((resp: any) => void) | 'cancelled' | null = null
function request(code: string, callback: (resp: any) => void) {
  if (registeredCallback !== null) {
    nextCallback = [code, callback]
  } else {
    registeredCallback = callback
    fetch('/literateHtml/api/singlepage', {
      method: 'POST',
      headers,
      body: JSON.stringify({ projectId: 'verso-nightly', fileContents: code }),
    })
      .then((response) => response.json())
      .then((result) => {
        console.log('result success', result)
        if (registeredCallback !== 'cancelled') {
          console.log('not cancelled')
          registeredCallback(result)
        }
      })
      .catch((error) => {
        console.log('result error', error)
        if (registeredCallback !== 'cancelled') {
          registeredCallback(undefined)
        }
      })
      .finally(() => {
        registeredCallback = null
        if (nextCallback !== null) {
          const [code, callback] = nextCallback
          nextCallback = null
          request(code, callback)
        }
      })
  }
}

function cancel(f: (resp: any) => void) {
  if (registeredCallback === f) {
    registeredCallback = 'cancelled'
  } else if (nextCallback && nextCallback[1] === f) {
    nextCallback = null
  }
}

export default function LiterateHtmlPreview({ code, currentTab }: LiterateHtmlPreviewProps) {
  const ref = useRef<null | HTMLIFrameElement>(null)
  const [href, setHref] = useState<null | string>(null)

  useEffect(() => {
    const f = (resp: any) => {
      if (resp && resp.success) {
        setHref(resp.href)
        console.log({ href: resp.href })
        ref.current?.contentWindow.location.replace(resp.href)
      }
    }
    request(code, f)
    return () => {
      cancel(f)
    }
  }, [code])

  return (
    <div
      className="verso-preview-tab"
      aria-labelledby="tab-preview"
      style={currentTab === 'versobox' ? {} : { display: 'none' }}
    >
      {!href && 'waiting for literate HTML to compile'}
      <iframe
        ref={ref}
        style={href ? { backgroundColor: 'white' } : { display: 'none' }}
        src="/verso"
      />
    </div>
  )
}
