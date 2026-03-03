import { faCode } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { ReactNode, RefObject, useEffect, useState } from 'react'
import './css/TabView.css'
import VersoPreview from './TabPlugins/VersoPreview'
import { LeanWebPlugin } from './config/docs'
import lean4webConfig from './config/config'

export type TabId = 'info' | LeanWebPlugin
interface TabViewButtonProps {
  id: TabId
  currentTab: TabId
  setTabId: (id: TabId) => void
  children: ReactNode
}

function TabViewButton({ id, currentTab, setTabId, children }: TabViewButtonProps) {
  const isActive = id === currentTab
  return (
    <button
      className={`tab-button ${isActive ? 'tab-active' : 'tab-not-active'}`}
      id={`tab-${id}`}
      onClick={() => setTabId(id)}
    >
      {children}
    </button>
  )
}

interface InfoViewTabProps {
  infoviewRef: RefObject<HTMLDivElement>
  isUsingCodeMirror: boolean
  currentTab?: 'info' | LeanWebPlugin
}

function InfoViewTab({ infoviewRef, isUsingCodeMirror, currentTab }: InfoViewTabProps) {
  return (
    <div
      ref={infoviewRef}
      role={currentTab ? 'tabpanel' : undefined}
      className="vscode-light infoview"
      style={!currentTab || currentTab === 'info' ? {} : { display: 'none' }}
    >
      <p className={`editor-support-warning${isUsingCodeMirror ? '' : ' hidden'}`}>
        You are in the plain text editor
        <br />
        <br />
        Go back to the Monaco Editor (click <FontAwesomeIcon icon={faCode} />) for the infoview to
        update!
      </p>
    </div>
  )
}

interface TabViewProps {
  infoviewRef: RefObject<HTMLDivElement>
  isUsingCodeMirror: boolean
  isUsingMobile: boolean
  code: string
  projectId: string
  tab: string
  setTab: (tab: string) => void
  workbenchMsg: any
  sessionId: null | string
}

function TabView({
  tab,
  setTab,
  infoviewRef,
  isUsingCodeMirror,
  isUsingMobile,
  code,
  workbenchMsg,
  projectId,
  sessionId,
}: TabViewProps) {
  const tabs =
    lean4webConfig.projects.filter(({ folder }) => folder === projectId)[0]?.plugins ?? []
  if (tabs.length === 0) {
    return <InfoViewTab isUsingCodeMirror={isUsingCodeMirror} infoviewRef={infoviewRef} />
  }
  const tabId: TabId = tabs.find((t) => t === tab) ?? 'info'

  const tabTitles: { [id in LeanWebPlugin]: string } = {
    versobox: 'Verso view',
  }

  return (
    <div className="view-tabs-container">
      <div role="tablist" className="tab-list">
        <TabViewButton id="info" currentTab={tabId} setTabId={setTab}>
          InfoView
        </TabViewButton>
        {tabs.map((id) => (
          <TabViewButton key={id} id={id} currentTab={tabId} setTabId={setTab}>
            {tabTitles[id] ?? id}
          </TabViewButton>
        ))}

        <div
          style={{
            flexGrow: 1,
            borderLeft: '1px solid var(--vscode-tab-border)',
            borderBottom: '1px solid var(--vscode-tab-border)',
          }}
        />
      </div>
      <div className="tab-panels">
        <InfoViewTab
          isUsingCodeMirror={isUsingCodeMirror}
          infoviewRef={infoviewRef}
          currentTab={tabId}
        />
        {tabs.includes('versobox') && (
          <VersoPreview id={sessionId} currentTab={tabId} workbenchMsg={workbenchMsg} />
        )}
      </div>
    </div>
  )
}

export default TabView
