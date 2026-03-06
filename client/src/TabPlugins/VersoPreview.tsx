import { useEffect, useRef, useState } from 'react'
import { LeanWebPlugin } from '../config/docs'

interface VersoPreviewProps {
  currentTab: 'info' | LeanWebPlugin
  id: string
  workbenchMsg: any
}

/**
 * In order to have the invariant that there's always an iframe, but also to
 * make sure we don't have a behind-the-scenes 404 happening, we give the
 * iframe a URL to load initially.
 */
const INITIAL_HREF = '/verso/'

function VersoPreview({ id, currentTab, workbenchMsg }: VersoPreviewProps) {
  const [state, setState] = useState<any>(null)
  const ref = useRef<null | HTMLIFrameElement>(null)

  useEffect(() => {
    if (workbenchMsg?.event === 'buildHtml') {
      console.log(`Verso preview updated, ${workbenchMsg.elapsed}ms`)
      setState(workbenchMsg)
      console.log(ref.current?.contentWindow.location.pathname)
      if (ref.current?.contentWindow.location.pathname === INITIAL_HREF) {
        ref.current?.contentWindow.location.replace('/verso/view/' + id + '/html-single/')
      }
      if (workbenchMsg.errors.length === 0) {
        ref.current?.contentWindow.location.reload()
      }
    }
  }, [workbenchMsg])

  return (
    <div
      className="verso-preview-tab"
      aria-labelledby="tab-preview"
      style={currentTab === 'versobox' ? {} : { display: 'none' }}
    >
      {!state && 'waiting for a Verso document to be fully loaded'}
      {state && state.errors.length > 0 && (
        <div>
          Error{state.errors.length === 1 ? '' : 's'} encountered rendering to HTML:
          <ul>
            {state.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}
      {/* The iframe is always present, but we { display: none } it when another element is shown */
        <iframe
          ref={ref}
          style={
            state && state.errors.length === 0 ? { backgroundColor: 'white' } : { display: 'none' }
          }
          src={INITIAL_HREF}
        />
      }
    </div>
  )
}

export default VersoPreview
