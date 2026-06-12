import './css/index.css'
// Installs the `$/echo/alert` websocket tap (proof of concept). Side-effect
// import; must run before lean4monaco opens its LSP socket.
import './echo-alert'

import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'

import App from './App.tsx'
import { NavBarComp } from './NavBar.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NavBarComp />
    <App />
  </StrictMode>,
)
