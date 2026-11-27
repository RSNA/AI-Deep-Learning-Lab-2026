// The practice a person plays: its character and its name. The same on the join page of a
// session and at the start of a single-player game (engineering spec, section 10.2).
import { AVATARS } from '@lab02/protocol'
import { COPY } from '../copy.ts'
import { Avatar } from './ui.tsx'

export function AvatarPicker({ avatar, setAvatar }: { avatar: string; setAvatar: (a: string) => void }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <legend className="lbl" style={{ marginBottom: 6, fontWeight: 800, padding: 0 }}>{COPY.pickCharacter}</legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8 }}>
        {AVATARS.map((a, i) => (
          <button key={a} type="button" className="pick" aria-pressed={avatar === a} aria-label={`Character ${i + 1}${avatar === a ? ', picked' : ''}`}
            onClick={() => setAvatar(a)}
            style={{
              height: 56, padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `3px solid ${avatar === a ? 'var(--line)' : 'var(--soft)'}`,
              background: avatar === a ? 'var(--sun)' : 'var(--panel)',
              boxShadow: avatar === a ? '3px 3px 0 var(--shade)' : 'none',
            }}>
            <Avatar id={a} size={44} />
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** The character a browser starts from: the one of its last game, or the first. */
export function firstAvatar(last: { avatar: string } | null): string {
  return last && (AVATARS as readonly string[]).includes(last.avatar) ? last.avatar : AVATARS[0]
}
