// One application, three entry routes: players, hosts, the big screen (engineering spec, 10.1).
import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import './styles/base.css'
import './styles/phase1.css'
import './styles/phase2.css'
import './styles/firstbuild.css'
import './styles/phase3.css'
import './styles/slides.css'
import './styles/card.css'
import { initTheme } from './lib/theme.ts'
import { HostPage } from './pages/Host.tsx'
import { ManualPage } from './pages/Manual.tsx'
import { JoinPage } from './pages/Join.tsx'
import { PlayPage } from './pages/Play.tsx'
import { ResultPage } from './pages/Result.tsx'
import { ScreenPage } from './pages/Screen.tsx'
import { StartPage } from './pages/Start.tsx'

initTheme()

function App() {
  const [path, setPath] = useState(() => location.pathname + location.search)
  const go = useCallback((to: string) => {
    if (to !== location.pathname + location.search + location.hash) history.pushState(null, '', to)
    setPath(location.pathname + location.search)
  }, [])
  useEffect(() => {
    const on = () => setPath(location.pathname + location.search)
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  const pathname = path.split('?')[0]!
  const j = /^\/j\/([A-Za-z0-9]{4,8})\/?$/.exec(pathname)
  if (j) return <JoinPage key={j[1]} code={j[1]!} go={go} />
  if (pathname === '/play') return <PlayPage go={go} />
  if (pathname === '/host/manual') return <ManualPage />
  if (pathname === '/host') return <HostPage go={go} />
  if (pathname === '/screen') return <ScreenPage />
  const res = /^\/result(?:\/([A-Za-z0-9]{4,8}))?\/?$/.exec(pathname)
  if (res) return <ResultPage key={res[1] ?? ''} code={res[1] ?? null} go={go} />
  // The address without a path and `/home`. The server sends the first to the open session when there is one.
  return <StartPage go={go} />
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
