// Every refusal in plain words (engineering spec, section 10.1). No error name ever reaches a
// screen: a screen shows `plainError(code)`, beside the field or the control it concerns.
import type { ErrorCode } from '@lab02/protocol'

const PLAYER: Record<ErrorCode, string> = {
  bad_message: 'The game did not understand that. Try again.',
  rate_limited: 'Too many clicks at once. Wait a moment and try again.',
  wrong_stage: 'That is not possible at this point of the game.',
  already_submitted: 'Your board is already sent, so it cannot change now.',
  busy: 'The game is busy. Try again in a moment.',
  unknown_id: 'That item is not part of this game.',
  already_done: 'That is already done.',
  no_bandwidth: 'Not enough bandwidth is free. Wait until a running investigation ends.',
  not_enough_credits: 'Not enough credits left for that.',
  invalid_report: 'A class has more problems than it has room for.',
  invalid_design: 'The design is not complete yet.',
  not_buildable: 'This design cannot be built yet.',
  no_runs_left: 'No trial runs are left.',
  offer_closed: 'That offer has closed.',
  offer_full: 'That offer is taken.',
  not_available: 'That is not available here.',
  window_closed: 'The time for that has passed.',
  action_used: 'That action is already used this month.',
  removed: 'The host removed this player from the session.',
  name_taken: 'A player with this name is already in the game. If it is yours, rejoin it with its code. Otherwise pick another name.',
  name_invalid: 'Pick another name. It must fit the length, and the room will see it.',
  join_closed: 'Joining is closed for this session.',
  session_full: 'The session is full.',
  unknown_player: 'No player has that code in this session.',
  unknown_system: 'That health system is not in this session.',
  not_in_control: 'Another host console has control. Take control first.',
  no_scores_yet: 'No score exists yet.',
  no_deck: 'This game has no slides.',
  not_during_play: 'Slides cannot go to the players while a phase is being played.',
  confirm_mismatch: 'The code you typed does not match the session code.',
  pause_first: 'Pause the game first, then change the speed.',
}

/** Errors of the HTTP API that are not socket error codes. */
const HTTP: Record<string, string> = {
  network: 'The server cannot be reached. Check the Wi-Fi and try again.',
  unknown_session: 'This session does not exist or has ended.',
  session_open: 'Only a closed session can be deleted. End it first.',
  wrong_passcode: 'That passcode is wrong.',
  unauthorized: 'Your sign-in has expired. Sign in again.',
  code_invalid: 'A join code is 4 to 8 letters or digits.',
  label_invalid: 'Give the session a name of 1 to 80 characters.',
  code_taken: 'Another session already uses this join code. Pick another one, or leave it empty.',
  provisional_anchors: 'Scores are not calibrated yet, so an event session cannot be opened. Use test or rehearsal.',
  no_answer_key: 'This server has no answer key.',
  not_open: 'This phase has not opened yet.',
  not_found: 'That page does not exist.',
  internal: 'The server had a problem. Try again in a moment.',
  bad_response: 'The server sent something this page cannot read. Reload the page.',
}

const FALLBACK = 'Something went wrong. Try again.'

/** The plain sentence for an error name. Unknown names get a general sentence, never the name. */
export function plainError(code: string | undefined | null, overrides: Partial<Record<string, string>> = {}): string {
  if (!code) return FALLBACK
  return overrides[code] ?? (PLAYER as Record<string, string>)[code] ?? HTTP[code] ?? (/^http_\d+$/.test(code) ? HTTP.internal! : FALLBACK)
}

export const ERROR_TEXT = { ...PLAYER, ...HTTP } as Readonly<Record<string, string>>
