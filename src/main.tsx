import { Buffer } from 'buffer'
;(window as any).Buffer = Buffer
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import './style.css'

createRoot(document.getElementById('root')!).render(<App />)
