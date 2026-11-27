// Practice names (engineering spec, section 6.4).

// A short list of words a room would not want on the big screen. Matched on the letters of the
// name after common look-alike digits are mapped back to letters.
const BLOCKED = [
  'fuck', 'shit', 'cunt', 'bitch', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'slut', 'whore',
  'fag', 'nigg', 'retard', 'nazi', 'hitler', 'rape', 'porn', 'penis', 'vagina', 'wank', 'twat',
]
const LOOKALIKE: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' }

export function isProfane(name: string): boolean {
  const letters = name.toLowerCase().split('').map((c) => LOOKALIKE[c] ?? c).join('').replace(/[^a-z]/g, '')
  return BLOCKED.some((w) => letters.includes(w))
}

export function cleanName(name: string): string {
  return name.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
}

export type NameCheck = { ok: true; name: string } | { ok: false; error: 'name_invalid' | 'name_taken' }

export function checkName(
  raw: string,
  rule: { min_chars: number; max_chars: number; filter_profanity: boolean },
  taken: (lower: string) => boolean,
): NameCheck {
  const name = cleanName(raw)
  const len = [...name].length
  if (len < rule.min_chars || len > rule.max_chars) return { ok: false, error: 'name_invalid' }
  if (rule.filter_profanity && isProfane(name)) return { ok: false, error: 'name_invalid' }
  if (taken(name.toLowerCase())) return { ok: false, error: 'name_taken' }
  return { ok: true, name }
}
