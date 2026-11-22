// Phase 3: Maintaining. A stub until Step 9 adds the rules of section 6.7.
import type { PhaseModule } from './types.ts'

export const maintaining: PhaseModule = {
  phase: 'maintaining',
  implemented: false,
  open() {},
  close() {
    return 0
  },
  liveValue() {
    return 0
  },
  commands: {},
}
