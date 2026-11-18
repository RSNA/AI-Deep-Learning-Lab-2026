// Phase 2: Development. A stub until Step 7 adds the rules of section 6.6.
import type { PhaseModule } from './types.ts'

export const development: PhaseModule = {
  phase: 'development',
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
