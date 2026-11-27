# Style Guide

This guide explains how the 2026 Deep Learning Lab posters look and how their posts are written. Follow it when you make a new poster or post, so the series stays consistent.

## The idea

Each poster looks like a page from a lab notebook: warm paper, hand-inked lines and a taped sketch sheet. In the middle, a friendly teal robot acts out what the lab teaches. The look is playful, but the content is accurate. A radiologist should recognize the anatomy, the workflow and the terminology.

Every poster tells **one** idea in an 8-second loop. A viewer should get the idea from the animation alone, before reading anything.

## Canvas and timing

| Setting | Value | Why |
| --- | --- | --- |
| Size | 1080 x 1350 px (4:5 portrait) | A tall format that fills more of the feed on phones |
| Loop | 96 frames at 12 fps = 8 seconds | 12 fps suits hand-drawn animation; it feels drawn, not slick |
| Line boil | Lines redraw slightly differently every 2 frames (3 variations) | Makes still parts of the drawing look alive, like traditional animation |
| Seamless loop | The last frame flows into the first | Platforms loop the video, so a jump would repeat every 8 seconds |

Timing in a scene uses `t`, which runs from 0 to 1 over the loop. Use `seg`, `pulse` and `ease` from `lib/sketch.js` for timing. When you use periodic motion, use whole-number multiples of a full turn (`Math.sin(t * TAU * 4)`), so the motion lands back where it started.

## Layout

All posters share the layout in `lib/frame.js`. Only the text in `labs.js` and the scene change from poster to poster.

| Area | Position (px) | Contents |
| --- | --- | --- |
| Header | top 56 px margin | RSNA 2026 logo on the left. On the right: "DEEP LEARNING LAB" in JetBrains Mono, a level pill (Core in light teal, Advanced in coral) and a gold hexagon with the lab number |
| Title | y 186 to 462 | Lab title in Bricolage Grotesque ExtraBold, up to 3 lines. The size shrinks from 92 px until it fits. A gold highlighter stroke sits behind the key words (`highlight` in `labs.js`). Optional subtitle below |
| Sketch sheet | x 48, y 478, 984 x 672 | Off-white sheet, rotated very slightly, with tape on all four corners. The scene draws here |
| Footer | bottom | Calendar icon with the day number, the day in bold and the time in dark teal. On the right, "hands-on!" in coral and "bring your laptop" in handwriting |

Keep the 56 px side margins. Don't put anything important near the tape or the sheet's edges.

## Colour palette

Defined as `FRAME.PAL` in `lib/frame.js`. Scenes get it as `sk.pal`.

| Name | Hex | Use |
| --- | --- | --- |
| ink | `#26221E` | All outlines and body text. Warm near-black, never pure black |
| paper | `#F3ECDD` | Poster background |
| sheet | `#FCF8EF` | Sketch sheet |
| teal | `#3AA6A2` | Robot body, main accent |
| tealDark | `#0F6667` | Times, handwritten labels, emphasis |
| tealLight | `#A6DCD7` | Core level pill, soft fills |
| gold | `#EDB95E` | Title highlighter, lab badge, sparks and "success" glows |
| coral | `#E9714B` | Advanced level pill, "hands-on!", warnings, the thing to notice |
| navy | `#26364F` | Robot joints and dark details |
| blue | `#2F6DB3` | Secondary robots and data |
| screen | `#173B40` | Robot face and computer screens |
| cream, grey, wood | `#F8EBCD`, `#C3BCAF`, `#E1BE86` | Props and furniture |
| red, green | `#D6493B`, `#4FA463` | Status only (fail and pass) |

Use one or two accents per scene. Coral draws the eye, so save it for the main point.

## Type

| Font | Weight | Used for |
| --- | --- | --- |
| Bricolage Grotesque | 800 (titles), 500 to 700 (subtitles, dates) | Everything the viewer must read |
| Caveat | 600 to 700 | Handwritten labels inside scenes ("orchestrator", "think", "hands-on!") |
| JetBrains Mono | 700, letter-spaced | Kickers, level pills, code |

Labels in scenes are short (one to three words), lowercase and handwritten. Pass `jitter: true` to `sk.text` so labels shift slightly with the line boil.

## Drawing

- Draw everything with `SK.Sketch` (`sk.shape`, `sk.path`, `sk.line`, `sk.fillPts`, `sk.text`). It adds the wobble, the double ink stroke and the boil. Plain canvas calls look out of place next to it.
- Outlines are 2.2 to 3.4 px. Use thicker lines for main objects and thinner ones for details.
- Fill shapes with flat colours from the palette. For shading, use hatching (`sk.hatch`), not gradients. Soft glows (`sk.glow`) are only for light and success moments.
- The robot (`ROBOT.robot` in `lib/robot.js`) is the series mascot. Keep its colours and proportions. Change its pose, expression (`happy`, `confused`, `blink`), gaze (`look`), what it holds (`holdL`, `holdR`) and accessories (`headset`). Smaller robots in other colours can play specialist agents.
- **Medical images must be believable.** Use `lib/xray.js` for chest X-rays. The default "balanced" style keeps the ribs faint, the heart and mediastinum soft, and shows a few lung markings. An early version with bright, dense bones looked fake to radiologists, so avoid it. Findings such as a nodule or pneumonia should be soft and hazy, never a hard white ball.

## Animation

- Build one clear story with a beginning, a turning point and a payoff. For example, in Lab 04 the model gets a scan from a new scanner, its uncertainty spikes, and it hands the case to a radiologist.
- Ease every movement (`ease.inOut`, `ease.out`, or `ease.back` for things that pop in). Nothing should flash or strobe.
- Put the most telling moment near 55% of the loop. `render.js` takes the still image from that frame.
- Leave a beat of rest before the loop restarts, so the viewer can take in the final state.

## Writing the posts

The exact text for each poster is in [POSTS.md](POSTS.md).

### All posts

- Open with a hook that speaks to the reader's problem or curiosity ("New to AI agents? Start here."), not with the lab title.
- Tag **@RSNA** in every post. RSNA's marketing team reposts posts that tag them. Use **#RSNA26** plus two to four topic hashtags.
- Give the day, time (with "CT"), place and room. All of this must appear in the text, because people can't search or read an animation.
- List every faculty member with degrees and affiliation, exactly as they asked to be listed. Check names, degrees and affiliations with each faculty member before posting.
- End with a registration link on its own line.
- Don't link to this GitHub repository in the promotional posts.

### LinkedIn

LinkedIn has no formatting: no bullets, bold or headings. Use emoji as markers and blank lines for structure:

```text
Hook line.

🎓 @RSNA 2026 Deep Learning Lab 01
Lab title

🗓️ Day · time CT
📍 Venue, room, city

One or two sentences on what the lab does. You will:

🔹 Learning goal
🔹 Learning goal

👥 Faculty
🔸 Name, degrees (Affiliation), moderator
🔸 Name, degrees (Affiliation)

💻 Level. Bring a laptop and a Google account.

🎟️ Seats are limited. Register here:
https://registration-link

#RSNA26 #Radiology #AI #Topic
```

- Use 🔹 for learning goals and 🔸 for people. Put a blank line between sections and no blank lines inside a section.
- Pasted text turns `@RSNA` into plain text. After pasting, delete it, type `@RSNA` again and pick the RSNA page from the list.
- Attach the MP4. LinkedIn doesn't loop videos, so the MP4 plays the loop three times.

### X

- Write a thread of three or four posts. Each post is a full, natural sentence or two, not a list of fragments, and fits in 280 characters. X counts every link as 23 characters.
- Post 1 carries the GIF, the hook, `@RSNA`, the day, time and room, and `#RSNA26`.
- The middle posts cover what attendees will do and who teaches the lab. Tag faculty by their X handle when they agree to it.
- The last post gives the level, what to bring and the registration link.
- X shows text exactly as written, without bold or italics.

## Before you post

- [ ] Names, degrees and affiliations confirmed by each faculty member
- [ ] Day, time and room match the official RSNA program
- [ ] Registration link works
- [ ] @RSNA tagged (retyped on LinkedIn)
- [ ] Right file attached: MP4 for LinkedIn, GIF for X
- [ ] The poster's title, level, date and time match the post text
