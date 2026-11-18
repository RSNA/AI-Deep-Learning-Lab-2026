// The deck of the session (engineering spec, section 6.12): one list of slides in sections. The
// screen state holds the index of the slide shown last, across the whole deck.
import type { Pack } from '@lab02/content-schema'
import type { StageId } from '@lab02/protocol'

export type FlatSlide = {
  index: number
  sectionIndex: number
  section: { id: string; title: string; stage: string }
  slide: NonNullable<Pack['deck']>['sections'][number]['slides'][number]
}

const cache = new WeakMap<object, FlatSlide[]>()

/** Every slide of the deck in order, with its section. */
export function deckSlides(pack: Pack): FlatSlide[] {
  const deck = pack.deck
  if (!deck) return []
  let out = cache.get(deck)
  if (!out) {
    out = []
    deck.sections.forEach((section, sectionIndex) => {
      for (const slide of section.slides) out!.push({ index: out!.length, sectionIndex, section, slide })
    })
    cache.set(deck, out)
  }
  return out
}

/** The first slide of the section that opens at this stage, or null. */
export function sectionStartFor(pack: Pack, stage: StageId): number | null {
  const hit = deckSlides(pack).find((x) => x.section.stage === stage)
  return hit ? hit.index : null
}
