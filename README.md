# ESN Speed Friending

The screen we project at ESN Thessaloniki speed friending nights. It welcomes people, explains the game, times each conversation, tells every badge group where to move, and says thank you at the end with a feedback QR.

It is one HTML file. There is nothing to install and no internet is needed on the night.

## Running the event

1. Open `current/speed-friending-esn.html` in Chrome, on the laptop connected to the projector. Press F11 for full screen.
2. Press any key once so the browser allows sound.
3. Press **Esc** for Settings and check: talking time, rounds, **number of tables**, date/venue, and the feedback form link.
4. Press **Space** to go through the intro screens.

### Keys

| Key | What it does |
|---|---|
| Space | Next screen / start / pause / resume / skip rotation or break |
| ← → | Back and forward through the intro screens |
| R | Rotate now |
| B | Break |
| H | Conversation-starter help (QR) |
| Esc or G | Settings (not while a conversation is running: pause first) |
| ] / [ | +1 / −1 minute on the current timer |
| + / − | +30 / −30 seconds |
| W W | Back to the Welcome screen |
| 0 0 | Reset to round 1 (Get Seated) |
| L | Lock the keyboard (only L, M, O, Esc/G still work) |
| M | Mute / unmute |
| O | Operator view (a large panel, or a separate window for a second screen, chosen in Settings) |

### Seating and rotation

- People sit anywhere, up to 4 per table, and a volunteer hands out badges A, B, C and D so each table has different letters. Tables of 3 are fine; never seat 5.
- **Warm-up to split friends:** once badges are out, press **R** for one rotation, then **0 0**. The event starts at round 1 with everyone at a new table.
- Each rotation shows how many tables each letter moves (stay, 1, 2 or 3), and **nobody ever meets the same person twice**, the warm-up included. The moves are picked at random on the first rotation of the night and then stay the same each round: a full search showed that for 5 or more rotations this is the only repeat-free way. The app remembers every move in the browser, also after a refresh or a reset.
- **Set the number of tables in Settings.** The rule depends on it, and Settings shows how many rotations your table count allows with all-new faces. Table counts divisible by 3 allow fewer (45 tables: 14 rotations); around 50 tables allows far more than a normal night needs. If the night runs past that limit, the app picks the move with the fewest repeats and shows a warning.
- Before a **new** event, press *Clear seating history* in Settings (it also clears itself after 12 hours).

### Feedback form

`feedback-form/create-feedback-form.gs` builds the feedback Google Form:

1. Go to [script.google.com](https://script.google.com) signed in to the ESN account, and click **New project**.
2. Delete the sample code, paste the whole file, and click **Save**.
3. Click **Run**. Google asks for permission: choose the account, then **Advanced → Go to (project) (unsafe)** → **Allow**. That warning appears because the script is your own and hasn't been reviewed by Google.
4. Open the **Execution log** and copy the `forms.gle` link.
5. In the app, paste it into **Settings → Feedback form link** and Save. The Thank you screen then shows its QR code. Leave the field empty to hide the QR.

Answers appear in the form's *Responses* tab in Google Drive.

## Files

| Path | What it is |
|---|---|
| `current/` | The version in use: `speed-friending-esn.html`, `assets/` (sounds, help QR) and `Badges/` (print at 5 × 5 cm). Only edit here. |
| `versions/` | Numbered snapshots of earlier versions. `VERSIONS.txt` says what changed in each. |
| `feedback-form/` | Google Apps Script that creates the feedback form. |
| `tests/` | Automatic tests (below). |
| `archive/` | Old material, not in GitHub because it is too large. Kept on Drive. |

## Changing the app

Before every change, copy `current/speed-friending-esn.html` to `versions/` as the next number and add a line to `VERSIONS.txt`.

Tests run automatically on GitHub for every push (the *Actions* tab shows a green tick or a red cross). To run them on your own computer, install [Node.js](https://nodejs.org), then in this folder:

```
npm install
npm test
```

- `tests/simulate-rotation.js` plays thousands of nights person by person and fails if anyone meets someone twice when the table count allows it. `npm run simulate` runs the full 200,000-night version.
- `tests/key-test.js` presses every key on every screen and state, with the lock on and off, in both operator modes, and checks nothing breaks. It also plays a whole night with the warm-up.

Settings and progress are saved in the browser (`localStorage`), so they belong to one browser on one computer. Run the event from the same browser you set it up in.
