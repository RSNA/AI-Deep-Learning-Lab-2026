// A snapshot of the field names of every outgoing type, so a new field shows up in review
// (engineering spec, section 12.3).
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as P from '../src/index.ts'
import * as H from '../src/host.ts'

function fields(schema: z.ZodType, path = ''): string[] {
  const def = (schema as unknown as { _zod: { def: Record<string, unknown> } })._zod.def
  switch (def.type) {
    case 'object': {
      const shape = def.shape as Record<string, z.ZodType>
      return Object.entries(shape).flatMap(([k, v]) => [`${path}${k}`, ...fields(v, `${path}${k}.`)])
    }
    case 'optional': case 'nullable': return fields(def.innerType as z.ZodType, path)
    case 'array': return fields(def.element as z.ZodType, `${path}[].`)
    case 'record': return fields(def.valueType as z.ZodType, `${path}*.`)
    case 'tuple': return (def.items as z.ZodType[]).flatMap((x, i) => fields(x, `${path}${i}.`))
    case 'union': return [...new Set((def.options as z.ZodType[]).flatMap((x) => fields(x, path)))]
    default: return []
  }
}

describe('outgoing types', () => {
  const types: Record<string, z.ZodType> = {
    PlayerView: P.PlayerView, Welcome: P.Welcome, ScreenView: P.ScreenView, Standing: P.Standing,
    Clock: P.Clock, PlanningContent: P.PlanningContent, Moment: P.Moment, HostView: H.HostView,
    HostInspect: H.HostInspect, HostDeck: H.HostDeck,
  }
  for (const [name, schema] of Object.entries(types)) {
    it(name, () => expect(fields(schema).sort()).toMatchSnapshot())
  }
  it('every schema is strict', () => {
    expect(P.PlayerView.safeParse({ ...({} as object), extra: 1 }).success).toBe(false)
    const clock = { gameMs: 0, running: true, scale: 1, stage: 'lobby', stageEndsAtMs: null, guideEndsAtMs: null, warnings: [] }
    expect(P.Clock.safeParse(clock).success).toBe(true)
    expect(P.Clock.safeParse({ ...clock, secret: 'x' }).success).toBe(false)
  })
})
