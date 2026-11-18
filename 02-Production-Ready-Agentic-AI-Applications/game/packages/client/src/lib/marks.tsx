// The two inline marks a pack may use in tile, brief and letter text: **bold** and *italic*
// (engineering spec, section 10.4). Everything else is shown as text. No HTML is interpreted.
import { Fragment, type ReactNode } from 'react'

const TOKEN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g

export function Marks({ text }: { text: string }): ReactNode {
  const parts = text.split(TOKEN)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <b key={i}>{part.slice(2, -2)}</b>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <i key={i}>{part.slice(1, -1)}</i>
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** Paragraphs split on blank lines, each with its marks. */
export function Paragraphs({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {text.split(/\n\s*\n/).map((para, i) => <p key={i} className={className}><Marks text={para} /></p>)}
    </>
  )
}
