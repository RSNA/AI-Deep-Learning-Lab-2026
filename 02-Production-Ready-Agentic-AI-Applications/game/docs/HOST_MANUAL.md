# Console manual

The controls of the facilitator console, for the people who run a session of the Lab 02 game.
It says what each button does. The **Facilitator guide** says how the game itself works: each
phase, how it is scored, what every option is for and what to say to a player who is stuck. A
server that has the guide shows a **Facilitator guide** button at the top of the console. The
guide holds answers, so keep it off the projector.

| Screen | Who looks at it | How it opens |
| --- | --- | --- |
| Player screen | Every player, on a laptop or a phone | The QR code or the join link |
| Projector | The whole room | From the console |
| Facilitator console | The facilitators | `/host` |

## 1. The short version

1. Sign in at `/host` with the facilitator passcode and your name.
2. Make a session, or open one. The first facilitator in is **in charge**.
3. Press **Open the big screen in a new window** and drag that window to the projector.
4. Players scan the QR code. Nobody types a code.
5. Press **Next** to move the room from stage to stage. Read the button first: it names the
   stage it leads to.
6. Leave the projector on **Follow the game** unless you have a reason not to.

## 2. Sessions

To make a session, give it a name and a mode and press **Create**.

| Mode | Use it for | Game speed | Reset and restart |
| --- | --- | --- | --- |
| Test | Quick checks | Any | Yes |
| Rehearsal | A practice run with people | 1× unless you change it | Yes |
| Event | The real session | Always 1× | No |

- **"Event" is crossed out** while the page says "Scores are not calibrated yet".
- **The name** starts as the date and the time. Players see it on the join page and on their
  report card. **Rename** works in the lobby and after the session has ended.
- **One session is open at a time.** When you press Create while another one runs, the console
  says which one, who started it, its stage and its players, and asks before it goes on. Going
  on ends that session for everyone and keeps its results. For an event session with players
  you type its code first.
- **Closed sessions** are behind "Show closed sessions", each with its downloads and a
  **Delete** button that says how many result pages go with it.
- **Late players** never enter a phase in play. They wait with the leaderboard and the slides
  shown so far, score 0 for that phase and start with the next one. Once Phase 3 runs nobody
  can join.
- **Single player.** The panel under the sessions has a switch. While it is on, a person who
  opens the site can play the whole game alone. Nobody can watch such a game or help in it. The
  panel lists the games so that they can be deleted, one by one or all at once after typing
  DELETE. Switch it off right before a session with a room.
- **The passcode of single player.** The same panel says who may start such a game: whoever
  has the facilitator passcode (the setting of a new server, for the days before an event), a
  passcode of its own that opens nothing else, or anybody. Never give the facilitator passcode
  to players: it opens this console.

## 3. Who is in charge

Several facilitators can open the same session, and one of them is in charge of what the room
sees. The session bar says who.

| Only the facilitator in charge | Every facilitator, at any time |
| --- | --- |
| Next, Pause, more time, End now | Open the guide and the answer key |
| What the projector shows, and its theme | Look at any player beside the key |
| Moving the slides that the room sees | Go through the slides alone |
| Renaming or removing a player, the spotlight | Read a player's rejoin code |
| Game speed, reset, restart, ending the session | Downloads and this manual |

**Take charge** in the session bar asks for the passcode and tells the other facilitator at
once. If the laptop in charge drops, control waits 20 seconds for it. After that anyone takes
charge with one press.

## 4. Stages and the clock

| Button | What it does |
| --- | --- |
| Next | Moves the whole room to the next stage. Slides, results and the winners wait for it |
| Pause, Resume | Stops and restarts the clock for everyone. Nobody loses work |
| +30 s, +60 s, +5 min | Adds time to the running phase. In Phase 3 every two minutes more bring one more report |
| End now | Ends the running phase. Every player's work is sent as it stands |

A phase ends by itself at zero. In a stage without a countdown the clock is a guide, and nothing
happens at zero. The strip under the controls shows the planned minutes and whether you are
ahead or behind.

## 5. The players

Each row shows a player's character, practice, whether they are online, what they are doing and
their points. **Click a name to look at that player beside the key.** The page opens on the
phase that runs and starts with what holds the player back, what is worth saying and what is
good. It updates as the player works. Only facilitators see it.

The button with three lines (☰) on a row has the rest.

| Action | What it does |
| --- | --- |
| Spotlight | Puts that player on the projector. Ask them first |
| Rename | For a name that should not be on a projector |
| Rejoin code | The code that brings the player back on another device |
| Remove | Takes the player out of the game and off the leaderboard |

## 6. The projector

| Button | The room sees |
| --- | --- |
| Follow the game | The normal setting: the lobby, the slides, the room at work during a phase, the results after it |
| Lobby | The QR code and the link |
| Leaderboard | Everyone, or one phase |
| Activity | Who is doing what while a phase is played. Never what a player learned |
| Slides | The deck, at the slide you showed last |
| Winners | The podium, or the standings so far |

**Every button but Follow the game pins the projector.** The console then shows a banner such
as "Pinned to Lobby" with a **Follow the game** button. Check for it before you press Next.
**Day** and **Night** change the look of the projector only.

## 7. Slides

All slides are in the game. **Slides on the projector** changes what the room sees, with Back
and Next or the arrow keys, and **Go to section** jumps. **Look through the deck** is for your
eyes only and shows your notes: Look back, Look ahead (or Shift with the arrow keys) and **Show
this slide**. If you move the shared slides into a section that is not due yet, the console
asks first, because the recap of a phase shows its answers.

In a slide stage every player's screen shows the slide. During a phase players keep their game.
The switch "Players' screens follow the slides" shows and changes this.

## 8. The guide and the answer key

**Facilitator guide** opens the guide, and **Open the answer key** opens every answer of the
game with its reason. Each opens in a window of its own and needs no second passcode. Keep both
off the projector.

## 9. Rehearsal tools

In test and rehearsal sessions only: **Game speed**, **Reset this phase** and **Restart the
game**. Each says what will be lost and asks you to confirm.

## 10. Ending a session and downloads

**End the session** closes it for everyone. An event session asks for its code first. Players
keep their report card and can look at each phase again.

| Download | What is in it |
| --- | --- |
| Results table (CSV) | One row per player with the points of each phase. Keep this |
| Timing table (CSV) | When each stage started and ended, and how fast players acted |
| Full activity log (JSON) | Everything players and facilitators did |

## 11. If something goes wrong

| What happened | What to do |
| --- | --- |
| A player lost their screen | The join link brings them back in the same browser. On another device they press "Rejoin with a code", which you read from the menu (☰) on their row |
| A player is stuck or asks why | Click their name and read the top of their page |
| "The button does nothing" | Every control that cannot be used says why beside it. Point to that sentence |
| The projector window was closed | Press "Open the big screen in a new window" again |
| The wrong view is on the projector | Look for the pinned banner and press "Follow the game" |
| Players do not see the slides | Check "Players' screens follow the slides". It is off during a phase |
| A button is greyed out for you | Another facilitator is in charge. Press "Take charge" if you should drive |
| Your laptop dies | Nothing is lost. Sign in on another laptop, open the session and take charge |
| A phase needs more time | Press +30 s, +60 s or +5 min, as often as needed |
| Something confuses the room | Press Pause. Press Resume when you are ready |
| The clock runs far too fast | Look for the game speed badge. Pause, then set the speed to 1× |
| The page looks stuck | Reload it. You keep control if you are back within 20 seconds |
