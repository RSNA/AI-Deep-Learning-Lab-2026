// Every refusal in plain words (engineering spec, section 8.2). No error name ever reaches a
// screen: a screen shows `plainError(code)`, beside the field or the control it concerns. A name
// this file does not know gets the sentence of `bad_message`.
import type { ErrorCode } from '@lab02/protocol'

const SOCKET: Record<ErrorCode, string> = {
  bad_message: 'That did not go through. Reload the page and try again.',
  rate_limited: 'That was too fast. Wait a moment and try again.',
  wrong_stage: 'That is not possible at this point of the game.',
  already_submitted: 'You have already sent this. It can no longer be changed.',
  unknown_id: 'The game does not know that item. Reload the page.',
  already_done: 'You have already done this investigation.',
  no_bandwidth: 'Not enough free bandwidth. Wait for an investigation to finish.',
  not_enough_credits: 'You do not have enough credits for that.',
  invalid_report: 'That class is full. Move one of its problems out first.',
  not_available: 'That is not available right now.',
  window_closed: 'The time to answer that has passed.',
  action_used: 'You have already used that action.',
  removed: 'The host removed this practice from the game.',
  invalid_map: 'That change breaks a rule of the map, so it was not saved.',
  unknown_action: 'The game does not know that action. Reload the page.',
  action_taken: 'That action is already done or under way.',
  requires_action: 'Another action has to be done first.',
  not_enough_money: 'There is not enough money left for that.',
  developers_busy: 'Not enough developers are free. Wait for an action to finish.',
  validation_running: 'A validation is still running. Wait for its result.',
  no_validations_left: 'You have no validations left.',
  not_ready: 'The map is not ready to validate yet.',
  line_refused: 'That line cannot be drawn on this map.',
  unknown_validation: 'The game does not know that validation. Reload the page.',
  name_taken: 'A practice with that name is already in the game. If it is yours, rejoin with your code. If not, pick another name.',
  name_invalid: 'A practice name needs 3 to 24 characters and no rude words.',
  join_closed: 'This game no longer takes new players.',
  session_full: 'This game is full.',
  unknown_player: 'That player is no longer in the game.',
  unknown_system: 'That health system is not part of this game.',
  not_in_control: 'Another host is in charge. Take charge first.',
  wrong_passcode: 'That passcode is not right.',
  no_scores_yet: 'There are no scores yet. The leaderboard opens with Phase 1, and the winners after the first phase is scored.',
  no_deck: 'This content has no slides.',
  not_during_play: "Players' screens stay on the game while a phase is running.",
  confirm_mismatch: 'That is not the session code. Type it exactly to confirm.',
  pause_first: 'Pause the game first, then change the speed.',
}

/** Names that only HTTP routes send. */
const HTTP: Record<string, string> = {
  unknown_session: 'There is no open game with that code. Check the code on the big screen.',
  not_open: 'That phase has not started yet.',
  not_found: 'That rejoin code does not match a practice in this game.',
  unauthorized: 'Your sign-in has ended. Sign in again.',
  code_invalid: 'A link name needs 4 to 8 letters or digits.',
  code_taken: 'Another session already uses that link name. Pick another one.',
  provisional_anchors: 'Scores are not calibrated yet, so an event session cannot be opened. Use rehearsal or test.',
  no_answer_key: 'This server has no answer key file.',
  internal: 'Something went wrong on the server. Try again, and tell the host if it happens twice.',
}

/** The client's own conditions, said in the same plain way. */
const CLIENT: Record<string, string> = {
  network: 'The server cannot be reached. Check the Wi-Fi and try again.',
}

export type NameRule = { min: number; max: number }

/** The plain sentence for an error name. `rule` fills in the length of a practice name. */
export function plainError(code: string | undefined | null, rule?: NameRule): string {
  if (code === 'name_invalid' && rule) return `A practice name needs ${rule.min} to ${rule.max} characters and no rude words.`
  if (!code) return SOCKET.bad_message
  return (SOCKET as Record<string, string>)[code] ?? HTTP[code] ?? CLIENT[code] ?? (/^http_5\d\d$/.test(code) ? HTTP.internal! : SOCKET.bad_message)
}

export const ERROR_TEXT = { ...SOCKET, ...HTTP, ...CLIENT } as Readonly<Record<string, string>>
