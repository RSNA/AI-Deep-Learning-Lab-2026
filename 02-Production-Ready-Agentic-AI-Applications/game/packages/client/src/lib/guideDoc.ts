// Reading the facilitator guide on a page of the client (engineering spec, section 10.8). The
// guide arrives as one HTML file that the game did not write, so the menu and the search are
// built from what the file holds: its headings and its text, and no name of a section.

export type Heading = { level: number; text: string }
/** A part of the guide in the menu. `at` is the index of its heading in the list given. */
export type OutlinePart = { at: number; text: string; children: { at: number; text: string }[] }

const tidy = (t: string) => t.replace(/\s+/g, ' ').trim()

/**
 * The menu of a document from its headings, in two levels. The parts are the headings of the
 * highest level that occurs more than once, so the one title of a document is never a part. Under
 * each part come the headings of the next level that the document uses. A heading that stands
 * before the first part, on a cover for example, is left out.
 */
export function buildOutline(headings: Heading[]): OutlinePart[] {
  const named = headings.map((h, at) => ({ at, level: h.level, text: tidy(h.text) })).filter((h) => h.text)
  if (!named.length) return []
  const count = new Map<number, number>()
  for (const h of named) count.set(h.level, (count.get(h.level) ?? 0) + 1)
  const levels = [...count.keys()].sort((a, b) => a - b)
  const top = levels.find((l) => (count.get(l) ?? 0) > 1) ?? levels[0]!
  const below = levels.find((l) => l > top)
  const out: OutlinePart[] = []
  for (const h of named) {
    if (h.level === top) out.push({ at: h.at, text: h.text, children: [] })
    else if (h.level === below && out.length) out.at(-1)!.children.push({ at: h.at, text: h.text })
  }
  return out
}

/** The shortest text that is searched for. One letter matches nearly every line. */
export const SEARCH_MIN = 2

/**
 * Every place where a word or a phrase stands in a text, as [start, end). Capital letters do not
 * count, and any run of spaces and line breaks in the text matches a space of the phrase. Nothing
 * is found for a phrase shorter than `SEARCH_MIN`.
 */
export function findRanges(text: string, query: string): [number, number][] {
  const words = query.trim().split(/\s+/).filter(Boolean)
  if (words.join(' ').length < SEARCH_MIN) return []
  const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'giu')
  const out: [number, number][] = []
  for (const m of text.matchAll(pattern)) {
    if (m[0].length) out.push([m.index, m.index + m[0].length])
  }
  return out
}

/** The index of the last start that is not after `offset`, or -1 when the offset is before them all. `starts` rises. */
export function partAt(starts: number[], offset: number): number {
  let lo = 0, hi = starts.length - 1, at = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid]! <= offset) { at = mid; lo = mid + 1 } else hi = mid - 1
  }
  return at
}
