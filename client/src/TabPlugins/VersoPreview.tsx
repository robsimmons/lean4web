import { useEffect, useState } from 'react'
import { LeanWebPlugin } from '../config/docs'

interface VersoPreviewProps {
  currentTab: 'info' | LeanWebPlugin
  id: string
  workbenchMsg: any
}

function VersoPreview({ id, currentTab, workbenchMsg }: VersoPreviewProps) {
  const [state, setState] = useState<any>(null)

  useEffect(() => {
    if (workbenchMsg?.event === 'buildHtml') {
      console.log(`Verso preview updated, ${workbenchMsg.elapsed}ms`)
      setState(workbenchMsg)
    }
  }, [workbenchMsg])

  return (
    <div
      className="verso-preview-tab"
      aria-labelledby="tab-preview"
      style={currentTab === 'versobox' ? {} : { display: 'none' }}
    >
      {!state && 'waiting for a Verso document to be fully loaded'}
      {state && state.errors.length === 0 && (
        <iframe style={{backgroundColor: "white"}} key={state.id} src={'/verso/view/' + id + '/html-single'} />
      )}
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
    </div>
  )
}

export default VersoPreview
