// The console manual (engineering spec, section 10.8): docs/HOST_MANUAL.md of this repository,
// included in the build as text. Rendered with headings, paragraphs, lists, tables and bold, and
// nothing else. Every other character is text and no HTML is interpreted.
import type { ReactNode } from 'react'
import manual from '../../../../docs/HOST_MANUAL.md?raw'

/** Bold between double asterisks; backticks are dropped and their text kept. */
function inline(text: string, key: string): ReactNode[] {
  return text.replace(/`([^`]*)`/g, '$1').split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={`${key}-${i}`}>{part.slice(2, -2)}</b> : part)
}

type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'hr' }

export function parseManual(src: string): Block[] {
  const lines = src.split('\n')
  const out: Block[] = []
  let i = 0
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  while (i < lines.length) {
    const l = lines[i]!
    if (!l.trim()) { i++; continue }
    const h = /^(#{1,4})\s+(.*)$/.exec(l)
    if (h) { out.push({ kind: 'h', level: h[1]!.length, text: h[2]! }); i++; continue }
    if (/^---+\s*$/.test(l)) { out.push({ kind: 'hr' }); i++; continue }
    if (l.trim().startsWith('|')) {
      const head = cells(l)
      i += 2 // the header and its rule
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(cells(lines[i++]!))
      out.push({ kind: 'table', head, rows })
      continue
    }
    const li = /^(\s*)(-|\d+\.)\s+(.*)$/.exec(l)
    if (li) {
      const kind = li[2] === '-' ? 'ul' : 'ol'
      const items: string[] = []
      while (i < lines.length) {
        const m = /^(\s*)(-|\d+\.)\s+(.*)$/.exec(lines[i]!)
        if (m) { items.push(m[3]!); i++; continue }
        // A wrapped item goes on with an indented line.
        if (items.length && /^\s{2,}\S/.test(lines[i]!)) { items[items.length - 1] += ` ${lines[i]!.trim()}`; i++; continue }
        break
      }
      out.push({ kind, items })
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|\||\s*(-|\d+\.)\s|---)/.test(lines[i]!)) para.push(lines[i++]!.trim())
    out.push({ kind: 'p', text: para.join(' ') })
  }
  return out
}

const blocks = parseManual(manual)

export function ManualBody() {
  return (
    <div className="manual">
      {blocks.map((b, i) => {
        const k = String(i)
        switch (b.kind) {
          case 'h': return b.level === 1 ? <h1 key={k}>{inline(b.text, k)}</h1> : b.level === 2 ? <h2 key={k}>{inline(b.text, k)}</h2> : <h3 key={k}>{inline(b.text, k)}</h3>
          case 'p': return <p key={k}>{inline(b.text, k)}</p>
          case 'ul': return <ul key={k}>{b.items.map((t, j) => <li key={j}>{inline(t, `${k}-${j}`)}</li>)}</ul>
          case 'ol': return <ol key={k}>{b.items.map((t, j) => <li key={j}>{inline(t, `${k}-${j}`)}</li>)}</ol>
          case 'hr': return <hr key={k} />
          case 'table': return (
            <table key={k}>
              <thead><tr>{b.head.map((c, j) => <th key={j}>{inline(c, `${k}-h${j}`)}</th>)}</tr></thead>
              <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, n) => <td key={n}>{inline(c, `${k}-${j}-${n}`)}</td>)}</tr>)}</tbody>
            </table>
          )
        }
      })}
    </div>
  )
}

/** The manual in a window of its own, at /host/manual. */
export function ManualPage() {
  return <main className="manual-page"><ManualBody /></main>
}
