import type { PhaseId } from '@lab02/protocol'
import { development } from './development.ts'
import { maintaining } from './maintaining.ts'
import { planning } from './planning.ts'
import type { PhaseModule } from './types.ts'

export const PHASE_MODULES: Record<PhaseId, PhaseModule> = { planning, development, maintaining }
export type { PhaseModule }
