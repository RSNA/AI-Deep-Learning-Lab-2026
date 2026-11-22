// Pixel icons of the canvas, drawn on a 12 by 12 grid with hard edges (spec, section 11.1). A
// pack names an icon by a free word. A word this file does not know gets the icon of its kind.
const P: Record<string, string> = {
  // sources
  form: 'M2 1h7l2 2v8H2zM3 2v8h7V4H8V2zM4 5h5v1H4zM4 7h5v1H4z',
  catalog: 'M1 2h4v8H1zM6 2h2v8H6zM9 1h2v9H9zM2 3v1h2V3z',
  mail: 'M1 3h10v7H1zM2 4v1l4 3 4-3V4L6 7z',
  truck: 'M1 3h6v5H1zM7 5h2l2 2v1H7zM2 9h2v2H2zM8 9h2v2H8z',
  chat: 'M1 2h9v6H5l-3 2V8H1zM3 4h5v1H3zM3 6h3v1H3z',
  counter: 'M2 1h8v10H2zM3 2v8h6V2zM4 3h4v3H4zM5 7h2v2H5z',
  file: 'M2 1h6l2 2v8H2zM3 2v8h6V4H7V2z',
  person: 'M4 1h4v4H4zM2 6h8v5H2z',
  clerk: 'M4 1h4v4H4zM2 6h8v5H2zM5 7h2v3H5z',
  agent: 'M3 2h6v1h1v5H9v1H3V8H2V3h1zM4 4v2h1V4zM7 4v2h1V4zM5 7h2v1H5zM5 0h2v2H5zM1 10h10v1H1z',
  step: 'M1 4h6V2l4 4-4 4V8H1z',
  rule: 'M2 1h8v2H2zM2 5h8v2H2zM2 9h8v2H2z',
  result: 'M1 6l2-2 2 2 4-5 2 2-6 7z',
  model: 'M3 1h6v2h2v6H9v2H3V9H1V3h2zM4 4v4h4V4z',
  compute: 'M1 2h10v3H1zM1 7h10v3H1zM2 3h1v1H2zM2 8h1v1H2z',
  prompt: 'M1 1h7l3 3v7H1zM2 3h5v1H2zM2 5h7v1H2zM2 7h7v1H2zM2 9h4v1H2z',
  lock: 'M3 5V3l1-2h4l1 2v2h1v6H2V5zM4 5h4V3H4zM5 7h2v2H5z',
  warn: 'M5 0h2l5 11H0zM5 4v4h2V4zM5 9v1h2V9z',
}

const KIND: Record<string, string> = { ai: 'agent', fixed: 'rule', person: 'person' }

export function iconPath(name: string, kind?: string): string {
  return P[name] ?? P[KIND[kind ?? ''] ?? ''] ?? P.file!
}

export function Icon({ name, kind, size = 16, title }: { name: string; kind?: string; size?: number; title?: string }) {
  return (
    <svg className="cicon" viewBox="0 0 12 12" width={size} height={size} shapeRendering="crispEdges" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={iconPath(name, kind)} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
