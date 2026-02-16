import { faCode } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ReactNode, RefObject, useEffect, useState } from "react";
import "./css/TabView.css";
import { preview } from "vite";

type TabId = "info" | "preview";
interface TabViewButtonProps {
  id: TabId;
  currentTab: TabId;
  setTabId: (id: TabId) => void;
  children: ReactNode;
}

function TabViewButton({ id, currentTab, setTabId, children }: TabViewButtonProps) {
  const isActive = id === currentTab;
  return (
    <button
      className={`tab-button ${isActive ? "tab-active" : "tab-not-active"}`}
      id={`tab-${id}`}
      onClick={() => setTabId(id)}
    >
      {children}
    </button>
  );
}

interface VersoPreviewProps {
  currentTab: TabId;
  isUsingMobile: boolean;
  code: string;
  
}

function VersoPreview({ currentTab, isUsingMobile, code }: VersoPreviewProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [previewedCode, setPreviewedCode] = useState<null | string>(null);
  const [hrefForIframe, setHrefForIframe] = useState<null | string>(null);
  const [error, setError] = useState<null | string>(null);

  const loadCode = () => {
    setIsLoading(true);
    setError(null);
    fetch("/verso/api/singlepage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ projectId: "Stable", fileContents: code }),
    })
      .then((resp) => resp.json())
      .then((json) => {
        console.log(json);
        setIsLoading(false);
        if (typeof json?.result !== "string") {
          setError("Unexpected response from server.");
          setPreviewedCode(code);
          console.error(json);
          return;
        }
        if (json.result !== "0") {
          setError(json.output.join(""));
          setPreviewedCode(code);
          return;
        }
        setHrefForIframe(json.href);
        setPreviewedCode(code);
      })
      .catch((err) => {
        setIsLoading(false);
        setError("Unexpected response from server.");
        setPreviewedCode(code);
        console.error(err);
      });
  };

  const [lastTab, setLastTab] = useState(currentTab);
  useEffect(() => {
    if (lastTab === currentTab) return;
    setLastTab(currentTab);
    if (currentTab !== "preview") return;
    if (code === previewedCode) return;
    if (isLoading) return;
    loadCode();
  }, [currentTab, lastTab]);

  return (
    <div
      className="verso-preview-tab"
      aria-labelledby="tab-preview"
      style={
        currentTab !== "preview"
          ? { display: "none" }
          : isUsingMobile
            ? { width: "100%" }
            : { height: "100%" }
      }
    >
      <button disabled={isLoading || previewedCode === code} onClick={loadCode}>
        {isLoading ? "Loading..." : "Load"}
      </button>
      {hrefForIframe && !error && <iframe key={previewedCode} src={hrefForIframe} />}
      {error && (
        <div style={{ overflow: "scroll", height: "100%", width: "100%" }}>
          <pre>{error}</pre>
        </div>
      )}
    </div>
  );
}

interface TabViewProps {
  infoviewRef: RefObject<HTMLDivElement>;
  isUsingCodeMirror: boolean;
  isUsingMobile: boolean;
  code: string;
}

function TabView({ infoviewRef, isUsingCodeMirror, isUsingMobile, code }: TabViewProps) {
  const [tabId, setTabId] = useState<TabId>("info");

  return (
    <div className="view-tabs-container">
      <div role="tablist" className="tab-list">
        <TabViewButton id="info" currentTab={tabId} setTabId={setTabId}>
          InfoView
        </TabViewButton>
        <TabViewButton id="preview" currentTab={tabId} setTabId={setTabId}>
          Verso view
        </TabViewButton>
        <div
          style={{
            flexGrow: 1,
            borderLeft: "1px solid rgb(200,200,200)",
            borderBottom: "1px solid rgb(200,200,200)",
          }}
        />
      </div>
      <div className="tab-panels">
        <div
          role="tabpanel"
          ref={infoviewRef}
          className="vscode-light infoview"
          style={
            tabId !== "info"
              ? { display: "none" }
              : isUsingMobile
                ? { width: "100%" }
                : { height: "100%" }
          }
          aria-labelledby="tab-info"
        >
          <p className={`editor-support-warning${isUsingCodeMirror ? "" : " hidden"}`}>
            You are in the plain text editor
            <br />
            <br />
            Go back to the Monaco Editor (click <FontAwesomeIcon icon={faCode} />) for the infoview
            to update!
          </p>
        </div>
        <VersoPreview isUsingMobile={isUsingMobile} currentTab={tabId} code={code} />
      </div>
    </div>
  );
}

export default TabView;
