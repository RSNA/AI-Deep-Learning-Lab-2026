// Pixel icons of the canvas, drawn on a 12 by 12 grid with hard edges (spec, section 11.1). A
// pack names an icon by one of the words below (listed in the spec, section 10.5). A word this file
// does not know gets the icon of its kind.
export const ICONS: Record<string, string> = {
  // sources
  form: 'M2 1h7l2 2v8H2zM3 2v8h7V4H8V2zM4 5h5v1H4zM4 7h5v1H4z',
  catalog: 'M1 2h4v8H1zM6 2h2v8H6zM9 1h2v9H9zM2 3v1h2V3z',
  mail: 'M1 3h10v7H1zM2 4v1l4 3 4-3V4L6 7z',
  truck: 'M1 3h6v5H1zM7 5h2l2 2v1H7zM2 9h2v2H2zM8 9h2v2H8z',
  chat: 'M1 2h9v6H5l-3 2V8H1zM3 4h5v1H3zM3 6h3v1H3z',
  counter: 'M2 1h8v10H2zM3 2v8h6V2zM4 3h4v3H4zM5 7h2v2H5z',
  file: 'M2 1h6l2 2v8H2zM3 2v8h6V4H7V2z',
  image: 'M1 2h10v8H1zM2 3v6h8V3zM3 8l2-3 2 2 1-1 2 2v1H3zM7 4h2v2H7z',        // a picture or a scan
  ask: 'M2 4h3v3H2zM1 8h5v3H1zM6 0h6v5H9l-2 2V5H6zM8 1h2v2H9v1H8V2h1V1z',      // a person to ask
  search: 'M1 1h6v6H1zM2 2v4h4V2zM7 7h2v2H7zM9 9h2v2H9z',                      // a search across records
  guide: 'M2 1h8v11H2zM3 3v8h6V3zM4 0h4v1H4zM4 4h1v1H4zM6 4h2v1H6zM4 6h1v1H4zM6 6h2v1H6zM4 8h1v1H4zM6 8h2v1H6z', // a guideline
  web: 'M4 1h4v1h2v2h1v4h-1v2H8v1H4v-1H2V8H1V4h1V2h2zM5 2h2v8H5zM2 5h8v2H2z',  // the web
  nurse: 'M2 0h8v3H2zM5 0h2v3H5zM4 1h1v1H4zM7 1h1v1H7zM4 4h4v3H4zM2 8h8v4H2z',
  doctor: 'M4 1h4v4H4zM2 6h8v6H2zM4 6h1v3H4zM7 6h1v3H7zM5 9h2v1H5z',
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
  return ICONS[name] ?? ICONS[KIND[kind ?? ''] ?? ''] ?? ICONS.file!
}

export function Icon({ name, kind, size = 16, title }: { name: string; kind?: string; size?: number; title?: string }) {
  return (
    <svg className="cicon" viewBox="0 0 12 12" width={size} height={size} shapeRendering="crispEdges" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={iconPath(name, kind)} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
