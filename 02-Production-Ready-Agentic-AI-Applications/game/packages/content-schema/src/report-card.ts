// The facts a line of `teaching/report-card.yaml` may ask about (engineering spec, section
// 6.12). The engine computes them per player when it makes a report card. A `when` that names
// anything else would never hold, so the loader refuses it.
export const REPORT_FACTS: Readonly<Record<string, 'boolean' | 'number' | 'band'>> = {
  final: 'boolean',                   // every phase is scored
  overall_band: 'band',               // the band of the mean of the three phases, 'none' before the end
  planning_band: 'band', development_band: 'band', maintaining_band: 'band',   // 'none' when not scored
  flagship_found: 'boolean',          // Phase 1: the agent project was in the agentic class
  planning_exact: 'number',           // Phase 1: problems in their true class
  investigations_started: 'number',   // Phase 1
  map_validated: 'boolean',           // Phase 2: a map was validated
  map_beats_reference: 'boolean',     // Phase 2: it scored at least what the reference map scores
  validations_used: 'number',         // Phase 2
  ran_a_map: 'boolean',               // Phase 3: a map ran in the last period of the year
  map_all_year: 'boolean',            // Phase 3: a map ran in every period
}

type Line = { when: Record<string, string | number | boolean> }
type File = { sections: readonly { id: string; lines: readonly Line[] }[]; closing: Record<string, string> }

/** What is wrong with a report card file: an unknown fact, a value of the wrong kind, an unknown band. */
export function reportCardProblems(file: File, bandIds: readonly string[]): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = []
  file.sections.forEach((sec, i) => sec.lines.forEach((line, k) => {
    for (const [fact, value] of Object.entries(line.when)) {
      const path = `sections[${i}].lines[${k}].when.${fact}`
      const kind = REPORT_FACTS[fact]
      if (!kind) { out.push({ path, message: `unknown fact "${fact}"` }); continue }
      if (kind === 'band') {
        if (typeof value !== 'string' || (value !== 'none' && !bandIds.includes(value))) out.push({ path, message: `"${String(value)}" is not a score band` })
      } else if (typeof value !== kind) out.push({ path, message: `the fact "${fact}" is a ${kind}` })
    }
  }))
  for (const band of Object.keys(file.closing)) if (!bandIds.includes(band)) out.push({ path: `closing.${band}`, message: `"${band}" is not a score band` })
  return out
}
