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
      {!state && 'waiting for server'}
      {state && <iframe key={state.id} src={'/verso/view/' + id + '/html-single'} />}
    </div>
  )
}

export default VersoPreview
