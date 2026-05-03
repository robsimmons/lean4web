import '../css/Modal.css'
import '../css/Navigation.css'

import {
  faArrowRotateRight,
  faCode,
  faEye,
  faHandshakeSimple,
  faInfoCircle,
} from '@fortawesome/free-solid-svg-icons'
import {
  faArrowUpRightFromSquare,
  faBars,
  faCloudArrowUp,
  faDownload,
  faGear,
  faHammer,
  faShield,
  faStar,
  faUpload,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useAtom } from 'jotai'
import { ChangeEvent, Dispatch, SetStateAction, useState } from 'react'

import { lean4webConfig } from '../../config'
import ZulipIcon from '../assets/zulip.svg'
import { useNavBar } from '../context/NavBarContext'
import { codeAtom } from '../editor/code-atoms'
import ImpressumPopup from '../Popups/Impressum'
import LoadUrlPopup from '../Popups/LoadUrl'
import LoadZulipPopup from '../Popups/LoadZulip'
import PrivacyPopup from '../Popups/PrivacyPolicy'
import ToolsPopup from '../Popups/Tools'
import { mobileAtom } from '../settings/settings-atoms'
import { SettingsPopup } from '../settings/SettingsPopup'
import { setImportUrlAndProjectAtom } from '../store/import-atoms'
import { currentProjectAtom, projectsAtom, visibleProjectsAtom } from '../store/project-atoms'
import { save } from '../utils/SaveToFile'
import { Dropdown } from './Dropdown'
import { NavButton } from './NavButton'

/** The menu items either appearing inside the dropdown or outside */
function FlexibleMenu({
  isInDropdown = false,
  setOpenNav,
  openExample,
  setOpenExample,
  openLoad,
  setOpenLoad,
  setContent,
  setLoadUrlOpen,
  setLoadZulipOpen,
}: {
  isInDropdown: boolean
  setOpenNav: Dispatch<SetStateAction<boolean>>
  openExample: boolean
  setOpenExample: Dispatch<SetStateAction<boolean>>
  openLoad: boolean
  setOpenLoad: Dispatch<SetStateAction<boolean>>
  setContent: (code: string) => void
  setLoadUrlOpen: Dispatch<SetStateAction<boolean>>
  setLoadZulipOpen: Dispatch<SetStateAction<boolean>>
}) {
  const [, setImportUrlAndProject] = useAtom(setImportUrlAndProjectAtom)
  const [{ data: projects }] = useAtom(projectsAtom)
  const loadFileFromDisk = (event: ChangeEvent<HTMLInputElement>) => {
    console.debug('Loading file from disk')
    const fileToLoad = event.target.files![0]
    var fileReader = new FileReader()
    fileReader.onload = (fileLoadedEvent) => {
      var textFromFileLoaded = fileLoadedEvent.target!.result as string
      setContent(textFromFileLoaded)
    }
    fileReader.readAsText(fileToLoad, 'UTF-8')
    // Manually close the menu as we prevent it closing below.
    setOpenLoad(false)
  }
  const [code] = useAtom(codeAtom)
  const [openWarning, setOpenWarning] = useState(
    typeof code === 'string' && code.trim() === ''
      ? false
      : document.referrer.startsWith('https://compybox2.onrender.com/')
        ? false
        : true,
  )
  console.log('AAAAA', { code, openWarning }, typeof code === 'string' && code.trim() === '')

  return (
    <>
      <Dropdown
        open={openExample}
        setOpen={setOpenExample}
        icon={faStar}
        text="Examples"
        useOverlay={isInDropdown}
        onClick={() => {
          setOpenLoad(false)
          !isInDropdown && setOpenNav(false)
        }}
      >
        {projects.map((it) =>
          it.config.examples?.map((example) => (
            <NavButton
              key={`${it.config.name}-${example.name}`}
              icon={faStar}
              text={example.name}
              title={`${it.config.name}: ${example.name}`}
              onClick={() => {
                setImportUrlAndProject({
                  url: `${window.location.origin}/api/example/${it.folder}/${example.file}`,
                  project: it.folder,
                })
                setOpenExample(false)
              }}
            />
          )),
        )}
      </Dropdown>
      <Dropdown
        open={openLoad}
        setOpen={setOpenLoad}
        icon={faUpload}
        text="Load"
        useOverlay={isInDropdown}
        onClick={() => {
          setOpenExample(false)
          !isInDropdown && setOpenNav(false)
        }}
      >
        <input
          id="file-upload"
          type="file"
          onChange={loadFileFromDisk}
          onClick={(ev) => ev.stopPropagation()}
        />
        {/* Need `ev.stopPropagation` to prevent closing until the file is loaded.
          Otherwise the file-upload is destroyed too early. */}
        <label htmlFor="file-upload" className="nav-link" onClick={(ev) => ev.stopPropagation()}>
          <FontAwesomeIcon icon={faUpload} /> Load file from disk
        </label>
        <NavButton
          icon={faCloudArrowUp}
          text="Load from URL"
          onClick={() => {
            setLoadUrlOpen(true)
          }}
        />
        <NavButton
          iconElement={<ZulipIcon />}
          text="Load Zulip Message"
          onClick={() => {
            setLoadZulipOpen(true)
          }}
        />
      </Dropdown>
      <NavButton
        icon={faHandshakeSimple}
        text="Can I Trust This Proof?"
        onClick={() => {
          window.location.assign('https://compybox2.onrender.com/' + window.location.hash)
        }}
      />
      <div style={{ position: 'relative', display: openWarning ? 'inline' : 'none' }}>
        <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 4, paddingTop: 20 }}>
          <div
            style={{
              width: 280,
              backgroundColor: 'pink',
              borderRadius: '1em',
              padding: '1em',
              display: 'relative',
              border: '2px solid red',
              fontSize: '90%',
              color: 'black',
            }}
          >
            <div style={{ width: '2em', height: '2em', float: 'right' }} />
            <p style={{ marginTop: 0 }}>
              <strong>Warning:</strong> don't trust proofs from untrusted sources unless they are
              validated against a trusted challenge.
            </p>
            <p style={{ marginBottom: 0 }}>
              Click here to go to comparator.live-lean.org and validate this proof.
            </p>
            <button
              style={{
                position: 'absolute',
                right: 0,
                top: 20,
                padding: '1em',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                border: 'none',
              }}
              onClick={() => setOpenWarning(false)}
            >
              <FontAwesomeIcon size="xl" icon={faXmark} />
            </button>
            <svg
              style={{ position: 'absolute', right: 0, top: 0, overflow: 'visible' }}
              viewBox="0 0 100 23"
              height="23"
              xmlns="http://www.w3.org/2000/svg"
            >
              <polygon points="23,23 0,0 46,23" fill="pink" />
              <polyline
                points="0,21 21,21 0,0 42,21 50,21"
                fill="none"
                stroke="red"
                stroke-width="2"
              />
            </svg>
          </div>
        </div>
      </div>
    </>
  )
}

/** The Navigation menu */
export function Menu({
  setContent,
  restart,
  codeMirror,
  setCodeMirror,
}: {
  setContent: (code: string) => void
  restart?: () => void
  codeMirror: boolean
  setCodeMirror: Dispatch<SetStateAction<boolean>>
}) {
  const [visibleProjects] = useAtom(visibleProjectsAtom)
  const [project, setProject] = useAtom(currentProjectAtom)
  const [code] = useAtom(codeAtom)

  // state for handling the dropdown menus
  const [openNav, setOpenNav] = useState(false)
  const [openExample, setOpenExample] = useState(false)
  const [openLoad, setOpenLoad] = useState(false)
  const [loadUrlOpen, setLoadUrlOpen] = useState(false)
  const [loadZulipOpen, setLoadZulipOpen] = useState(false)

  // state for the popups
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [impressumOpen, setImpressumOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [mobile] = useAtom(mobileAtom)

  const hasImpressum = lean4webConfig.impressum || lean4webConfig.contactDetails

  let navbar = useNavBar()

  return (
    <div className="menu">
      {project && (
        <select
          name="leanVersion"
          value={project.folder}
          onChange={(ev) => {
            setProject(ev.target.value)
            console.log(`set Lean project to: ${ev.target.value}`)
          }}
        >
          {project.folder}
          {visibleProjects.map((proj) => (
            <option key={proj.folder} value={proj.folder}>
              {proj.config.name}
            </option>
          ))}
        </select>
      )}
      {mobile && (
        <NavButton
          icon={faCode}
          text={codeMirror ? 'Lean' : 'Text'}
          onClick={() => {
            setCodeMirror(!codeMirror)
          }}
        />
      )}
      {!mobile && (
        <FlexibleMenu
          isInDropdown={false}
          setOpenNav={setOpenNav}
          openExample={openExample}
          setOpenExample={setOpenExample}
          openLoad={openLoad}
          setOpenLoad={setOpenLoad}
          setContent={setContent}
          setLoadUrlOpen={setLoadUrlOpen}
          setLoadZulipOpen={setLoadZulipOpen}
        />
      )}
      <Dropdown
        open={openNav}
        setOpen={setOpenNav}
        icon={openNav ? faXmark : faBars}
        onClick={() => {
          setOpenExample(false)
          setOpenLoad(false)
        }}
      >
        {mobile && (
          <FlexibleMenu
            isInDropdown={true}
            setOpenNav={setOpenNav}
            openExample={openExample}
            setOpenExample={setOpenExample}
            openLoad={openLoad}
            setOpenLoad={setOpenLoad}
            setContent={setContent}
            setLoadUrlOpen={setLoadUrlOpen}
            setLoadZulipOpen={setLoadZulipOpen}
          />
        )}
        <NavButton
          icon={faGear}
          text="Settings"
          onClick={() => {
            setSettingsOpen(true)
          }}
        />
        <NavButton icon={faHammer} text="Lean Info" onClick={() => setToolsOpen(true)} />
        {navbar.requiresNavBar != 0 && (
          <NavButton
            icon={faEye}
            text={`${navbar.hideNavBar ? 'Show' : 'Hide'} Navbar`}
            onClick={() => navbar.setHideNavBar(!navbar.hideNavBar)}
          />
        )}
        <NavButton icon={faArrowRotateRight} text="Restart server" onClick={restart} />
        <NavButton
          icon={faDownload}
          text="Save file"
          onClick={() => {
            if (code !== undefined) save(code)
          }}
        />
        {hasImpressum && (
          <NavButton
            icon={faInfoCircle}
            text={'Impressum'}
            onClick={() => {
              setImpressumOpen(true)
            }}
          />
        )}
        <NavButton
          icon={faArrowUpRightFromSquare}
          text="Lean community"
          href="https://leanprover-community.github.io/"
        />
        <NavButton icon={faArrowUpRightFromSquare} text="Lean FRO" href="https://lean-lang.org" />
        <NavButton
          icon={faArrowUpRightFromSquare}
          text="GitHub"
          href="https://github.com/leanprover-community/lean4web"
        />

        <NavButton icon={faShield} text="Privacy policy" href="https://lean-lang.org/privacy/" />
        <NavButton icon={faShield} text="Terms of use" href="https://lean-lang.org/terms/" />
      </Dropdown>
      <PrivacyPopup open={privacyOpen} handleClose={() => setPrivacyOpen(false)} />
      {hasImpressum && (
        <ImpressumPopup open={impressumOpen} handleClose={() => setImpressumOpen(false)} />
      )}
      {project && (
        <ToolsPopup
          open={toolsOpen}
          handleClose={() => setToolsOpen(false)}
          project={project.folder}
        />
      )}
      <SettingsPopup
        open={settingsOpen}
        handleClose={() => setSettingsOpen(false)}
        closeNav={() => setOpenNav(false)}
      />
      <LoadUrlPopup open={loadUrlOpen} handleClose={() => setLoadUrlOpen(false)} />
      <LoadZulipPopup
        open={loadZulipOpen}
        handleClose={() => setLoadZulipOpen(false)}
        setContent={setContent}
      />
    </div>
  )
}
