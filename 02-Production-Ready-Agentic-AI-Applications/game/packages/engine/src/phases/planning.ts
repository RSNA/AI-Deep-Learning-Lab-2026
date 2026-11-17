// Phase 1: Planning. The foundation opens and closes the phase. Step 5 adds the rules of
// section 6.5 of the engineering spec: investigations, the report and its score.
import type { PhaseModule } from './types.ts'

export const planning: PhaseModule = {
  phase: 'planning',
  implemented: false,
  open(_s, _pack, p) {
    p.planning = { done: [], running: [], picks: {}, submittedAtMs: null }
  },
  close() {
    return 0
  },
  liveValue(_s, _pack, p) {
    return p.planning?.done.length ?? 0
  },
  commands: {},
}
