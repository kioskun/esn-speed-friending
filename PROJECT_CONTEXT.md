# ESN Speed Friending — Project Context

## Purpose and audience

This project is a browser-based presentation and event controller for an ESN speed friending event in Thessaloniki. It helps a host welcome participants, explain the activity, seat people, time conversations, and announce table changes. The intended experience is relaxed and social: participants meet people through repeated small-group conversations, with volunteers available to help.

The screen is principally for a shared display or projector, while the host operates it from a laptop. Attendees do not need accounts or an app. The existing seating text asks people to sit with three new people, suggesting four-person conversations; the exact seating and badge allocation policy still needs to be confirmed.

The welcome screen currently contains the literal event information **`09/02/2026 | 18:00 | To Podilato`**, with **Thessaloniki** in the title. The date format has not been interpreted or updated. These details are written directly in the HTML rather than exposed in Settings.

## What the project contains

The source folder is `C:\Users\chara\Desktop\Speed Friending`.

| File or folder | Role |
|---|---|
| `speed-friending-esn.html` | The application: all screen markup, styling, and interaction logic. |
| `assets/qr-help.png` | QR image presented as conversation-starter help. Its destination has not been verified. |
| `assets/audio/bg.mp3` | Background music, configured to loop during conversation rounds. |
| `assets/audio/bell-start.mp3` | Round-start sound. |
| `assets/audio/bell-end.mp3` | Round-end sound. |
| `assets/audio/tick.mp3` | Countdown and closing-seconds sound. |
| `assets/audio/rotate.mp3` | Rotation music or sound. |
| `Badges/` | Six PNG designs: A, B, C, D, ESN, and Volunteer. Their filenames describe them as 5 × 5 cm badges. |
| `esn-speed-friending-v3.zip` | An existing archive; it should not be assumed to contain the current working version. |

The audio directory also contains `music-background.mp3`, `sfx-start-round.mp3`, `sfx-end-round.mp3`, and `sfx-tick.mp3`. The application does not reference those alternative filenames. The large music files account for most of the folder size. The small corner ESN logo is embedded directly inside the HTML.

## Participant experience and badge update

The introductory flow now includes the badge update:

**Welcome → How it works → Participant badges → Volunteer badges → Seating → Ready for round → Start countdown → Conversation → Rotation → Ready for next round.**

After the final scheduled conversation, the app displays its thank-you screen. Help and breaks are additional branches controlled by the host.

The badge addition connects the physical materials to the instructions on the screen:

- **Participant badges:** show the actual A, B, C, and D designs. Explain that the letter identifies the participant's group and that participants should follow the on-screen movement instructions for that letter.
- **Volunteer badges:** show the actual Volunteer design on a dedicated introductory screen. Explain that people wearing a **VOLUNTEER** badge can help with seating, rounds, and questions.
- **Seating:** reinforce the connection to the badge instructions and invite attendees to ask a volunteer for help.

This deliberately does not invent a requirement for one A, B, C, and D at every table. That may become the event policy, but it is not established by the existing application. The generic ESN badge is a supplied design; its operational role has not been specified.

## Default schedule and settings

Saved settings can override these source defaults:

| Setting | Default | Allowed setting values |
|---|---:|---|
| Conversation | 15 minutes | 1–60 minutes |
| Rotation | 5 minutes | 1–30 minutes |
| Break | 15 minutes | 0–60 minutes |
| Start countdown | 10 seconds | 0–60 seconds |
| Total rounds | 6 | 0–50; 0 means unlimited |
| Master volume | 70% | 0–100% |
| Start automatically after countdown | On | On/off |
| Group A movement | Stay | Stay or move 1, 2, or 3 tables |
| Group B movement | Move 1 table | Same choices |
| Group C movement | Move 2 tables | Same choices |
| Group D movement | Move 2 tables | Same choices |

Six full conversations, five full rotations, and six start countdowns total **116 minutes**: 90 + 25 + 1. This excludes introductions, manual waiting between rounds, and breaks. Breaks are started by the host, not automatically inserted into the schedule. Time adjustments and skipped rotations can change the total.

## Host operation

Space is the main control. It advances introductory screens, starts the countdown from the ready screen, pauses or resumes an active conversation, and skips a rotation or break. Once a rotation finishes, the host decides when everyone is ready before starting the next countdown.

| Key | Function |
|---|---|
| **Space** | Advance, start, pause/resume, or skip, depending on the current screen. |
| **H** | Toggle conversation-starter help. During a conversation, the timer continues running. |
| **G** | Open/close Settings. Opening is blocked while the conversation timer is running; pause first. |
| **O** | Toggle the operator information panel: screen, round, time, settings, and shortcuts. |
| **K** | Toggle keyboard lock. While locked, K, O, and G remain available. |
| **M** | Start a rotation immediately. |
| **B** | Start a break. See the known timer issue below. |
| **W**, twice within two seconds | Return to Welcome. This is separate from resetting the event. |
| **0**, twice within two seconds | Reset to round one and the ready timer screen. |
| **] / [** | Add/subtract 60 seconds from a conversation, rotation, or break. |
| **+ or = / −** | Add/subtract 30 seconds from those timers. |

Settings also has Save, Cancel, and Reset Event buttons. Keyboard lock only filters keyboard handling; it is not a complete lock of clickable controls. The timer changes colour near the end of a round and flashes during the last five running seconds. Audio includes music, bells, ticks, and generated fallback tones when sound playback fails.

## Technical structure and persistence

The project uses ordinary HTML, CSS, and JavaScript without a framework, build process, server, or database. Screen sections are shown and hidden by a central function; application variables track the active screen, round, remaining times, pause state, and help state. Interval timers drive conversations, countdowns, rotations, and breaks.

Settings are stored in browser local storage under **`esn_sf_cfg_v8`**. Their availability depends on the browser and the location from which the page is opened. **Runtime progress is not saved:** refreshing the page loses the active round and timer progress and starts the introduction again. There is no attendee registration or participant matching database.

Styling uses a dark background, bright ESN-labelled colour variables, large display typography, animations, and responsive sizing. That is a description of the source, not a verification against official ESN brand requirements.

## Known issues remaining outside this badge update

1. **Rotation rules overwrite saved choices.** Every rotation independently assigns each of four groups one of three actions: stay, move one table, or move two. At least two groups therefore share an action. The system does not track previous encounters or guarantee three new faces; it also replaces the host's chosen movements in memory.
2. **Breaks can overlap existing timers.** Starting a break does not clear the conversation or rotation interval. An earlier timer can continue and change the screen during the break.
3. **Manual start mode loops.** With automatic start disabled, countdown completion returns the conversation timer to READY. Space then sends the host back through the ready/countdown flow instead of starting the conversation.
4. **The end bell may be cut short.** Round completion plays the end bell and immediately changes screens; screen changes stop and reset bell playback. The likely audible effect has not been tested.

Adding the badge introduction does not fix these existing behaviours.

## Decisions still needed and next improvements

First confirm the attendee count, number and numbering of tables, badge distribution, initial seating policy, movement direction, and what happens after the last table. These determine whether a planned rotation schedule can keep tables balanced and reduce repeat meetings. The QR destination and whether participants need internet access for it also remain unverified.

The highest-priority follow-up is to fix timer transitions and replace random movement with an agreed, tested rotation plan. Next, rehearse the full event schedule and consider shorter conversation or movement periods if the available event time requires them. Add a few visible conversation starters alongside the QR, then improve the closing invitation so participants can reconnect and exchange contact details if they wish.

## Launch and verification

Keep the HTML, `assets`, and `Badges` together. If using the updated ZIP, extract it completely, then open `speed-friending-esn.html` in a desktop browser. Check the event details and saved settings, use browser fullscreen for the shared display, and rehearse the introduction, sounds, one complete round, and a rotation on the actual event equipment.

The update passed checks for JavaScript syntax, registered screens, the introduction sequence, HTML nesting, unique element identifiers, and local image references. A separate source review found no introduced navigation regressions.

Browser security policy blocked the attempted HTML preview, so **live layout, projector readability, badge-screen rendering, and audio playback have not been verified**. An event rehearsal remains the final practical check.

The updated distribution is `ESN-Speed-Friending-Updated.zip`. It includes the revised HTML, all six badge designs, this context document, the QR image, and the five audio files used by the application. Unreferenced alternate audio filenames are omitted from this distribution to avoid duplicating large files; the original source assets remain in place.
