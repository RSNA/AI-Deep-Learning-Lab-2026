// One application, three entry routes: players, hosts, the big screen (engineering spec, 10.1).
import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import './styles/base.css'
import { initTheme } from './lib/theme.ts'
import { store } from './lib/storage.ts'
import { HostPage } from './pages/Host.tsx'
import { JoinPage, NoSessionPage } from './pages/Join.tsx'
import { PlayPage } from './pages/Play.tsx'
import { ScreenPage } from './pages/Screen.tsx'

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
  if (pathname === '/host') return <HostPage go={go} />
  if (pathname === '/screen') return <ScreenPage />
  const saved = store.player()
  if (saved) return <JoinPage key={saved.session} code={saved.session} go={go} />
  return <NoSessionPage go={go} />
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
