# Host manual

For the people who run a session of the Lab 02 game. Read it beside the console. Each part is
short, and the last one is a table for when something goes wrong.

| Screen | Who looks at it | How it opens |
| --- | --- | --- |
| Player screen | Every player, on a laptop or a phone | The QR code or the join link |
| Projector | The whole room | From the host console |
| Host console | The hosts | `/host` |

## 1. The short version

1. Sign in at `/host` with the host passcode and your name.
2. Make a session, or open one. The first host in is **in charge**.
3. Press **Open the big screen in a new window** and drag that window to the projector.
4. Players scan the QR code. Nobody types a code.
5. Press **Next** to move the room from stage to stage. Read the button first: it names the
   stage it leads to.
6. Leave the projector on **Follow the game** unless you have a reason not to.

## 2. Signing in and making a session

The sign-in page asks for the **passcode**, which all hosts share, and for **your name**. The
other hosts see who is in charge by that name.

To make a session, fill the fields and press **Create**.

| Field | What to enter |
| --- | --- |
| Label | A name such as "Sunday 2:30 PM". Players see it on the join page |
| Mode | Test, rehearsal or event |
| Link name (optional) | The end of the join link. Leave it empty and the game picks one |

| Mode | Use it for | Game speed | Players pick a health system | Reset and restart |
| --- | --- | --- | --- | --- |
| Test | Quick checks | Any | Yes | Yes |
| Rehearsal | A practice run with people | 1× unless you change it | Yes | Yes |
| Event | The real session | Always 1× | No, the game assigns them | No |

**"Event" is crossed out** while the page says "Scores are not calibrated yet". Until the
scoring is calibrated the game opens test and rehearsal sessions only.

**The session code** (the box beside the label) is the end of the join link. Players never type
it. It matters when two sessions are open at once, and an event session asks you to type it
before it resets or ends.

The list under the form shows the open sessions. Closed ones are behind "Show closed sessions",
each with its downloads and a **Delete** button.

## 3. Who is in charge

Several hosts can open the same session. **One host is in charge** of what the room sees. The
session bar says who: "You are in charge" or "Maya is in charge".

| Only the host in charge | Every host, at any time |
| --- | --- |
| Next, Pause, more time, End now | Open the answer key |
| What the projector shows, and its theme | Look at any player beside the key |
| Moving the slides that the room sees | Go through the slides alone |
| Renaming or removing a player, the spotlight | Read a player's rejoin code |
| Game speed, reset, restart, ending the session | Downloads and this manual |

**To take charge**, press **Take charge** in the session bar. The dialog names the host who
loses control and asks for the host passcode. That host is told at once and is not asked. They
can take it back the same way.

If the laptop of the host in charge drops, control waits 20 seconds for it. After that anyone
takes charge with one press, and a host who is alone gets it automatically.

## 4. Stages and the clock

| Stage | What happens | How it ends |
| --- | --- | --- |
| Lobby | Players join and meet their practice | You press Next |
| Intro slides | You present the opening | You press Next |
| A phase | Everyone plays against the countdown | At zero, or with End now |
| Results of a phase | Players read their results. The projector shows how the room did | You press Next |
| Break | You present the recap of that phase | You press Next |
| Reflection | You present the closing | You press Next |
| Winners | The podium | You end the session |

| Button | What it does |
| --- | --- |
| Next | Moves the whole room to the next stage |
| Pause, Resume | Stops and restarts the clock for everyone. Nobody loses work |
| +30 s, +60 s | Adds time to the running phase |
| End now | Ends the running phase. Every player's work is sent as it stands |

In an untimed stage the clock is a guide: nothing happens at zero. The strip under the controls
shows the planned minutes and whether you are ahead or behind.

## 5. The players

Each row shows a player's character, practice, health system, whether they are online, what
they are doing and their points. The chips above the list filter by health system.

**Click a player's name to look at them beside the key.** You see how far they are, what runs
now, and every problem under its true class, with the player's pick and a mark. **Why** opens
the reason for each.

| Mark | Means |
| --- | --- |
| ✓ green | The right class. Full points |
| ≈ orange | One class off among the real classes, such as "One model" where "No AI" is true. Part of the points |
| ✗ red | A wrong class, such as a real problem under "Not a problem". No points |
| – grey | Not sorted yet |


**In Phase 2 the page opens on its Phase 2 tab.** You see the player's draft map as it is now,
whether it is ready to validate (and the accuracy it would get, from the key) or what stops it,
their money, free developers, actions and validations. Click a validation to see the map it
scored. Beside it is what only the key knows: the share of each kind of case the draft solves,
and what the scoring notices on the draft:

| Note | Means |
| --- | --- |
| Private data unprotected | A tile sends private data through a service that does not protect it |
| A worker overloaded | A worker has more lines coming in than it can keep track of |
| A distracting source read | An AI worker reads a source that sounds sure and is often wrong |
| A prompt that only hurts | A prompt that makes its worker worse |
| Tiles not connected | Tiles that do not reach the result, so they do nothing |

The reference map, with its accuracy and summary, is folded at the bottom. The Phase 1 tab is
still there.

The page updates as the player works, and it stays available after the phase. Use it to answer a
question or to give a hint. Only hosts see it, so keep it off the projector.

The button with three lines (☰) on a row has the other actions.

| Action | What it does |
| --- | --- |
| Look at this player | The same page as a click on the name |
| Spotlight | Puts that player on the projector. Ask them first |
| Rename | For a name that should not be on a projector |
| Rejoin code | The code that brings the player back on another device |
| Remove | Takes the player out of the game and off the leaderboard |

## 6. The projector

The preview at the top of the panel is what the room sees now.

| Button | The room sees |
| --- | --- |
| Follow the game | The normal setting. The projector changes as the session moves |
| Lobby | The QR code and the link, for people who walk in late |
| Leaderboard | Everyone, one health system, or one phase with the health systems side by side |
| Activity | Who is doing what while a phase is played. Never what a player learned |
| Slides | The deck, at the slide you showed last |
| Winners | The podium, or the standings so far before the last phase is scored |

With **Follow the game** the room sees the lobby, then the opening slides, then during a phase
a loop (the activity of the room, the phase leaderboard, one practice at work), then the
results of the room, then the recap slides of the break. In Phase 2 the practice at work is shown
with its map, and the activity names the actions practices start and finish and who validated a
map, never an accuracy.

**Every other button pins the projector.** A pinned projector does not follow the game. The
console shows a banner, "Pinned to Lobby", with a **Follow the game** button. Check for that
banner before you press Next.

A button that cannot be used says why beside it. **Day** and **Night** change the look of the
projector only.

## 7. Slides

All slides are in one deck with a section for the opening, one for each break and one for the
closing. You need no slide program.

- **Back** and **Next** move one slide. So do the left and right arrow keys while you are not
  typing.
- **Go to section** jumps to the first slide of a section.
- Under the controls you see **the slide on the projector now and the next slide**, drawn as
  they look, and your **notes** for the current one. Only hosts see notes.
- While slides are up, the box at the top right of the projector shows **the slide number** in
  place of the count of players, so that people can ask about "slide 7".
- A slide with a chart of the room shows the chart empty until that phase has been scored.
- A box in a health system's color (with its shape in the tag) is about that health system.
  The colors are the same as on the players' badges and on the leaderboards.
- A slide flagged "Placeholder" is a stand-in whose text is still to be written.
- The deck remembers where you stopped. Following the game into a break moves it to that
  break's section.

**Slides on the players' screens.** In a slide stage with "Follow the game", every player's
screen shows the slide, exactly as on the projector and scaled to their window. On a phone it
is larger when the phone is held sideways. When you press **Slides** yourself outside a phase, the console asks
whether players' screens follow. During a phase players always keep their game. The switch
"Players' screens follow the slides" shows and changes this.

**Slides that come later.** If you move the shared slides into a section that is not due yet,
the console asks first: "These slides come later". The recap of a phase shows its answers, so
only confirm when you mean it.

**The slides, for your eyes.** The panel under the projector lets any host go through the whole
deck with the notes. The room sees nothing of it. Use it to prepare, or to check a slide while
someone else presents.

## 8. Answer key

**Open the answer key** opens every answer of the game with its reason, in a window of its
own. It needs no second passcode. Keep it off the projector.

## 9. Rehearsal tools

Present in test and rehearsal sessions only.

- **Game speed.** At 10× a ten-minute phase takes one minute. It changes in the lobby or while
  paused. A badge in the session bar shows any speed other than 1×.
- **Reset this phase.** Starts the phase again for everyone and erases their work in it. Points
  of earlier phases stay. In the break after a phase it restarts that phase.
- **Restart the game.** Everyone goes back to the lobby with no points and stays in the
  session, so nobody joins again.

Each says what will be lost and asks you to confirm.

## 10. Ending a session and downloads

**End the session** closes it for everyone. In an event session you type the session code
first. Players keep a page with their rank and points and can look at their results again.
When you open a new session, a button "Join the new game" appears on their page by itself.

| Download | What is in it |
| --- | --- |
| Results table (CSV) | One row per player with the points of each phase. Keep this |
| Timing table (CSV) | When each stage started and ended, and how fast players acted |
| Full activity log (JSON) | Everything players and hosts did |

The downloads stay available on the first page until you delete the session.

## 11. What players can do on their own

- **Day or night:** the sun or moon button in their top bar.
- **Lost their screen:** the join link brings them back in the same browser. On another device
  they press "Rejoin with a code".
- **Their rejoin code and the opening letter:** in the menu (☰).
- **Their results of a finished phase:** in the menu, "Look at your Phase 1 result" and, once
  Phase 2 is scored, "Look at your Phase 2 result".
- **In Phase 2:** undo and redo in the bar of the map (Ctrl+Z on a laptop), any earlier
  validation loaded back onto the map, and the map they want sent chosen from the validations.
  Without a choice, the map with the best accuracy is sent.
- **Start over as a new player:** in the menu, "Join as a new player".
- **The practice room too tall or too low:** they drag its bottom edge.

## 12. If something goes wrong

| What happened | What to do |
| --- | --- |
| A player lost their rejoin code | Open the menu (☰) on their row, press "Rejoin code" and read it out |
| A player is stuck or asks why | Click their name. The page shows their picks beside the key |
| The projector window was closed | Press "Open the big screen in a new window" again |
| The wrong view is on the projector | Look for the pinned banner and press "Follow the game" |
| Players do not see the slides | Check "Players' screens follow the slides". It is off during a phase |
| A button is greyed out for you | Another host is in charge. Press "Take charge" if you should drive |
| The host in charge is not answering | Press "Take charge" and enter the passcode |
| Your laptop dies | Nothing is lost. Sign in on another laptop, open the session and take charge |
| A phase needs more time | Press +30 s or +60 s, as often as needed |
| Something confuses the room | Press Pause. Press Resume when you are ready |
| The clock runs far too fast | Look for the game speed badge. Pause, then set the speed to 1× |
| A phase went wrong in a rehearsal | "Reset Phase 1" in the rehearsal tools |
| You want to play once more | "Restart the game" in the rehearsal tools |
| You ended a session by mistake | Open a new one. The players' pages offer "Join the new game" |
| The page looks stuck | Reload it. You keep control if you are back within 20 seconds |
