# Host manual

This manual is for the person who runs a session of the Lab 02 game. It explains every control
of the host console, what the room sees when you use it, and what to do when something goes
wrong. You can read it beside the console while a session runs.

Three screens make up a session.

| Screen | Who looks at it | Address |
| --- | --- | --- |
| Player screen | Every player, on a laptop or a phone | The join link or the QR code |
| Projector | The whole room | Opened from the host console |
| Host console | You | `/host` |

---

## 1. Signing in

Open `/host`. The page asks for two things.

- **The passcode.** Every host uses the same one.
- **A name for this console**, such as "Maya's laptop". Other hosts see this name when you
  are in control, so pick one they will recognize. The browser remembers it.

After signing in you see the first page, with the content that is loaded and the list of
sessions.

## 2. The first page

### What the top lines tell you

- **"Content loaded"** says which phases have content and how many health systems the game
  has. A phase without content cannot be played.
- **"Scores are not calibrated yet"** appears while the scoring of the content is still an
  estimate. Calibration makes the health systems fair against each other on one leaderboard.
  Until it is done you can open test and rehearsal sessions and you cannot open an event
  session.
- **"The deck has placeholder slides"** appears while some slides are stand-ins. You can still
  run a session.
- **The fingerprint** in small type identifies the exact content on the server. You only need
  it when you report a fault.

### Making a session

Fill the three fields and press **Create**.

| Field | What to enter |
| --- | --- |
| Label | A name for you and the other hosts, such as "Sunday 2:30 PM". Players see it on the join page |
| Mode | Test, rehearsal or event. See the table below |
| Join code | What players type to join. It needs 4 to 8 letters or digits. Leave it empty and the game picks one |

| Mode | Use it for | Game speed | Players pick their health system | Reset a phase or restart the game |
| --- | --- | --- | --- | --- |
| Test | Quick checks by you or by automated players | Any | Yes, when the content allows it | Yes |
| Rehearsal | A full practice run with people | 1× unless you change it | Yes, when the content allows it | Yes |
| Event | The real session | Always 1× | No. The game assigns them in turn | No |

The line under the mode control repeats what the picked mode allows. "Event" cannot be picked
while scores are not calibrated, and the page says so beside it.

### The list of sessions

The list shows the sessions that are open. Press **Open** to run one. Closed sessions are
hidden. "Show closed sessions" brings them up, each with its downloads and a **Delete** button.
Deleting a session removes its results and logs for good, so download what you need first.

A closed session may say that it was started on older content. The game never reopens a session
on content that changed after it started, because the scores would no longer mean the same
thing.

---

## 3. The session page at a glance

| Area | What it is for |
| --- | --- |
| Session bar | The label, the join code, the mode, the stage, the clock, how many players are in and connected, and who is in control |
| Stage controls | Moving the session forward and handling the clock |
| Schedule | The planned run of the session against real time |
| Players | Everyone in the room, with what they are doing |
| Projector | What the room sees, and the slides |
| Room | The leaderboard and, after each phase, how the room did |
| Rehearsal tools | Game speed, reset of a phase and restart of the game. Absent in an event session |
| End the session | Closing the session for good |
| Downloads | Results and logs |
| Answer key | The answers, for hosts only |

Under the stage controls the page has three columns. The players and the room are on the left.
The projector is in the middle and takes the most space, because you use it most. The panels
you seldom need are on the right, in the order of the table above. On a narrow window the three
columns stand one under the other.

## 4. Stages and the clock

A session moves through stages in a fixed order.

| Stage | What happens | How it ends |
| --- | --- | --- |
| People are joining | Players scan the code and name their practice | You press Next |
| Intro slides | You present the opening slides | You press Next |
| Phase 1, 2 or 3 | Everyone plays against the countdown | By itself at zero, or when you press End now |
| Results of a phase | Each player reads their own results. The projector shows how the room did | You press Next |
| Break | You present the slides about the phase that just ended | You press Next |
| Reflection | You present the closing slides | You press Next |
| Winners | The podium | You end the session |

The stage controls are these.

| Button | What it does |
| --- | --- |
| Next | Moves to the next stage. The button names the stage it leads to, so read it before you press |
| Pause, Resume | Stops and restarts the clock for everyone. Nothing else changes, and nobody loses work |
| +30 s, +60 s | Adds time to the phase that is running |
| End now | Ends the running phase at once. Every player's work is sent as it stands |

In the untimed stages the clock shows a guide countdown. It tells you how long the schedule
gives that stage. Nothing happens when it reaches zero.

The **schedule** strip shows the planned stages with their minutes, where the session is now,
and whether you are ahead or behind.

## 5. The players

Each row is one player: their character, the name of their practice, their health system,
whether they are online, what they are doing in the current phase, how long ago they last did
something, and their points. The filter above the list shows everyone or one health system. The
button with three lines (☰) at the end of a row opens the actions for that player.

| Action on a row | What it does |
| --- | --- |
| Spectate | Shows you that player's screen, read-only. The player does not notice |
| Spotlight | Puts that player's screen on the projector, read-only. Ask the player first |
| Rename | Changes the name of the practice, for a name that should not be on a projector |
| Rejoin code | Shows the code that brings this player back on another device |
| Remove | Takes the player out of the game and off the leaderboard |

Players join in turn into the health systems, so the two halves of the room stay equal. In a
test or a rehearsal the join page may let a player pick a side.

---

## 6. The projector

### Opening it

Press **Open the big screen in a new window** in the Projector panel. Drag the new window to
the projector and make it full screen. There is no address to type. The link already knows your
session, and typing `/screen` by hand only shows a line that sends you back here.

The panel tells you how many projector windows are open. The small preview in the panel shows
what the room sees right now, so you never have to turn around to check.

The projector window takes no input. Nothing you press in it changes anything. You drive it
from the console.

### What the projector shows

| Button | The room sees |
| --- | --- |
| Follow the game | The normal setting. The projector changes by itself as the session moves |
| Lobby | The join code, the link and the QR code. Use it when someone walks in late |
| Leaderboard | The ranking. The list under the button picks everyone, one health system, or one phase with the health systems side by side |
| Activity | Who is doing what, line by line, while a phase is played. It never shows what a player learned |
| Slides | The slide deck, at the slide you showed last |
| Winners | The podium. Before the last phase is scored it shows the standings so far |

**While a phase is played, "Follow the game" rotates.** The projector shows the activity of the
room for 20 seconds, then the leaderboard of the phase for 10, the activity again, and then one
practice at work for 8, and starts over. Nothing in it gives an answer away: a line names the
practice and the investigation, never the insight, and a practice is shown with counts only. To
hold one of these views, pin **Activity** or **Leaderboard**.

With **Follow the game** the projector shows this in each stage.

| Stage | With "Follow the game" the room sees |
| --- | --- |
| People are joining | The lobby with the join code |
| Intro slides | The opening section of the deck |
| A phase | The countdown and a loop: the activity of the room, the leaderboard of the phase, one practice at work |
| Results of a phase | How the room did in that phase |
| Break | The slides about that phase |
| Reflection | The closing slides |
| Winners | The podium |

### Pinned views

Every button except "Follow the game" **pins** the projector. A pinned projector stays on that
view when the session moves on. If you pin the lobby and start Phase 1, the room keeps looking
at the lobby.

The console warns you while a view is pinned, with a banner such as "Pinned to Lobby. The
projector will not follow the game." Press **Follow the game** on the banner to return to the
normal setting. Make it a habit to check for that banner before you press Next.

### When a button is unavailable

| Button | Unavailable when | Why |
| --- | --- | --- |
| Leaderboard | Before Phase 1 starts | There is nothing to rank yet |
| Winners | Before the first phase is scored | There are no points yet |
| Slides | The content has no deck | There is nothing to show |

The console shows such a button as unavailable and gives the reason beside it.

### Theme

"Day" and "Night" switch the projector between a light and a dark look. Use the dark one in a
dim room and the light one in a bright room. This changes the projector only. Each player sets
the look of their own screen.

---

## 7. Slides

All slides of the session are in **one deck**. It has sections, one for the opening, one for
each break and one for the closing. You do not need a slide program or a second window.

### Moving through the deck

- **Next** and **Previous** move one slide. The left and right arrow keys do the same while
  you are not typing in a field.
- The console shows "Slide 2 of 6" and the name of the section.
- **Go to section** jumps to the first slide of a section.
- You see a small preview of the current slide and of the next one, and your **notes** for the
  current slide. The notes appear on your console only. The room never sees them.
- A slide marked "Placeholder" is a stand-in whose text is still to be written.

### The deck remembers where you stopped

When you leave the slides and come back, the deck opens at the slide you showed last. You can
show the leaderboard in the middle of a break and then return to the same slide.

When the session enters a stage that has its own section, and you follow the game, the deck
moves to the first slide of that section. If you were already inside that section it stays
where you were.

You may press Next and Previous while the slides are not on the projector. That lets you line
up a slide before you show it.

### Slides on the players' screens

Players who sit far from the projector can follow the slides on their own screens.

| When you show the slides | What the console asks | What players see |
| --- | --- | --- |
| In a slide stage, with "Follow the game" | Nothing | The current slide, on every screen |
| With the Slides button, outside a phase | "Show the slides on every player's screen too?" | The slide if you say yes. Their own screen if you say no |
| With the Slides button, during a phase | "Phase 1 is running. The projector will leave the leaderboard." | Their game, always. A phase is never interrupted |

- The switch **Players' screens follow the slides** shows whether the players see the slides,
  and lets you turn that on or off outside a phase.
- A player's screen follows you from slide to slide. A player cannot move ahead.
- During the results and the breaks a player can press "Back to my board" to look at their own
  results, and "Back to the slides" to return.
- When you leave the slides, or when a phase starts, every player's screen returns to the game
  by itself.

---

## 8. Winners and standings

The Winners button shows different things as the session goes on.

| When | The room sees |
| --- | --- |
| Before the first phase is scored | Nothing. The button is unavailable |
| After one or two phases | "Standings so far", the overall ranking as a plain table, with no podium |
| After the last phase is scored | The podium, with the top players overall, the top player of each health system and the top health system |

## 9. Several hosts

More than one person can open the console of the same session. **One console controls at a
time.** This keeps two people from pressing Next in the same second.

- The first console that opens the session is in control.
- Every other console watches. It shows everything live, and a bar at the top says who is in
  control, for example "Controlled from Maya's laptop. You are watching."
- A console that watches can still spectate a player, read a rejoin code, download results and
  open the answer key and this manual.
- To take over, press **Take control** and confirm. The other console sees at once that
  control moved, with your console's name.
- If the controlling laptop loses its connection, control waits for it for 20 seconds. After
  that, any console can take control without a confirmation. If only one console is left, it
  takes control by itself.

A good habit for an event is that one host drives and a second host watches from another
laptop, ready to take control.

## 10. Rehearsal tools

This box exists in test and rehearsal sessions. An event session does not show it.

- **Game speed** makes every clock run faster. At 10× a ten-minute phase takes one minute. Use
  it to walk through a whole session quickly. You can change the speed in the lobby or while
  the game is paused. A badge at the top of the console shows the speed whenever it is not 1×,
  so check for that badge before a rehearsal with people.
- **Reset this phase** puts every player back at the start of the phase that is running and
  erases their work in it. Points of earlier phases stay. In the break after a phase it starts
  that phase again. The phase begins at once with its full time. Every player reads a line that
  says so and gets the opening letter of the phase again.
- **Restart the game** takes everyone back to the lobby with no points, in the same session.
  The players stay in, with their names, health systems and rejoin codes, so nobody has to join
  again, and new players can still join. Use it to play the same session once more.

Both tell you exactly what will be lost and ask you to confirm with one click.

## 11. Downloads

| Download | What is in it | When you need it |
| --- | --- | --- |
| Results table (CSV) | One row per player with the points of each phase | Keep this after every session |
| Timing table (CSV) | When each stage started and ended against the schedule, and how fast players acted | To tune the timing after a rehearsal |
| Full activity log (JSON) | Everything players and hosts did | To replay a session or to find a fault |

The downloads stay available after a session has ended, from "Show closed sessions" on the
first page, until you delete the session.

## 12. Ending a session

**End the session** closes it for everyone. Nobody can join or play again. The console tells
you how many players this affects and asks you to confirm. In a test or a rehearsal one click
confirms. In an event session you first type the join code, so that the real session is never
ended by a slip. The downloads stay available afterwards.

What the players see: their page says "This game has ended" and keeps their rank and points,
and they can look at their Phase 1 result again. When you open a new session, a button "Join
the new game" appears on that page by itself within a few seconds, and the join page already
holds the name of their practice. You do not need to hand out a new link.

The projector then shows the standings under the heading "This session has ended". The stage
controls leave the console, because an ended session has no next stage.

Do not end a session to fix a mistake in the middle of a rehearsal. Use Pause, Reset this
phase, or Restart the game.

## 13. The answer key

"Open the answer key" asks for the passcode again and then opens the answers in a new tab. The
tab is for hosts only. Keep it off the projector and close it when you are done. The projector
window cannot open it.

---

## 14. If something goes wrong

| What happened | What to do |
| --- | --- |
| A player lost their screen or closed the browser | Opening the join link again in the same browser brings them back. On another device they press "Rejoin with a code" and type their rejoin code. If they lost the code, find their row in the players list, open its menu (☰), press "Rejoin code" and read it out |
| A player types the name of a practice that already exists | The join page offers the rejoin field. This is on purpose, so that nobody ends up with two practices |
| The projector window was closed | Press "Open the big screen in a new window" again. It opens on the same view |
| The wrong view is on the projector | Look for the pinned banner in the Projector panel and press "Follow the game" |
| The projector shows slides during a phase | You pinned the slides. Press "Follow the game". No player's screen was affected |
| Players do not see the slides | Check the switch "Players' screens follow the slides". It cannot be on during a phase |
| Your laptop dies or loses the network | The session keeps running on the server and nothing is lost. Open `/host` on any other laptop, sign in and open the session. After 20 seconds you can take control |
| Another host has control and is not answering | Press "Take control" and confirm |
| A phase went wrong in a rehearsal | Press "Reset Phase 1" (or the phase in play) in the rehearsal tools. Earlier phases keep their points |
| You want to play the same session once more | Press "Restart the game" in the rehearsal tools. Everyone is back in the lobby and stays in the session |
| You ended a session and want the players in a new one | Open a new session on the first page. The players' screens offer "Join the new game" by themselves |
| A phase needs more time | Press +30 s or +60 s. You can press them more than once |
| Something is confusing the room | Press Pause. The clock stops for everyone and nobody loses work. Press Resume when you are ready |
| A button says it is unavailable | Read the line beside it. It gives the reason |
| The clock seems far too fast | Look for the game speed badge at the top. Pause, then set the speed to 1× |
| A message says another console is in control | You are watching. Press "Take control" if you should be driving |
| The page looks stuck | Reload it. The console loses nothing by reloading, and it keeps control if you return within 20 seconds |
