# 09: The admission walk

Status: proposed keep/cut list, nothing deleted. Review this before anything is removed.

The rule applied: a browser test survives only if it carries a **wiring claim** — a claim whose
truth needs a real Pi child, a real socket, a real browser or a real layout engine — and no store or
component test already carries that same claim. A pure component rule fails the first condition even
when no store test covers it yet; those rows say which store test must be added before the deletion,
rather than keeping the browser test as the only home for a rule jsdom can hold.

## Measurement

| field | value |
| --- | --- |
| commit | `6da45595e0eee6373707309c4303d417f0993247` (merge of ticket 04: gate the remaining run-holding scripts) |
| machine | AMD Ryzen 7 7840HS, 16 CPUs, Linux, Node v26.9.0 |
| workers | 8 (pinned in `packages/e2e/playwright.config.ts`, one project) |
| command | `PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/e2e-report-09.json npx playwright test --config packages/e2e/playwright.config.ts --reporter=json` |
| result | 153 passed, 0 failed, 0 skipped, 0 flaky |
| wall clock | **41.5 s** (JSON `stats.duration` 41 492 ms) |
| test bodies | 276.5 s |
| page-less | 40 tests, 49.2 s |
| browser | 113 tests, 227.3 s |
| load at start | `11:05:16 up 2 days, 15:54, 1 user, load average: 4.05, 4.99, 5.67` |
| load after | `11:06:04 ... load average: 6.64, 5.60, 5.85` |

41.5 s against the recent idle 40.9 s: the machine was modestly loaded, not enough to distort the
number. Durations below are for information only; no test is cut for being slow, and the two abort
cases (`sleep 30` under Escape and under Stop) stay for the reasons their rows give.

## Page-less tests (input to ticket 10)

None of these takes the Playwright `page` fixture; they drive the server or a real `pi` child through
`startServer`, a spawned CLI, or `connectWsSession`. They are not judged as browser tests and move to
the backend runner under ticket 10.

| file | test | duration | real-server / socket / Pi claim |
| --- | --- | --- | --- |
| bridge.spec.ts | the bridge socket and its directory are user-only | 0.1 s | A real bridge socket is created at 0600 inside a 0700 directory. |
| bridge.spec.ts | a stale socket left by a crash is replaced | 0.1 s | A real leftover socket file is reclaimed by the next server. |
| bridge.spec.ts | a socket a live server already owns is refused loudly | 0.1 s | A second server refuses a socket a live listener owns. |
| bridge.spec.ts | a Session whose Pi child never connects its bridge fails loudly | 3.1 s | A real Pi child without the bridge makes subscribe fail and logs it. |
| bridge.spec.ts | a Session whose bridge extension cannot be loaded fails loudly | 0.1 s | A real child whose bridge extension is missing fails loudly. |
| bridge.spec.ts | a Session is served with the real bridge and the socket path never reaches the browser | 2.1 s | A real bridge attaches and its socket path is absent from the Snapshot. |
| compaction.spec.ts | the Session reports compaction in progress before the boundary and the remeasured figure | 1.2 s | A real compaction is reported running, then boundary, then pi's remeasured figure, in that frame order. |
| files.spec.ts | listing, preview and download are rooted at the Project each request names | 0.0 s | Real filesystem listings and previews are rooted at the named Project. |
| files.spec.ts | a cross-Project symlink and an unserved Project are both refused | 0.0 s | Real symlinks out of root and unserved Projects are refused by the server. |
| files.spec.ts | refuses path traversal, out-of-root reads, and anything that would write | 1.3 s | Real traversal, out-of-root reads and writes are refused by the server. |
| fork-and-clone.spec.ts | a fork writes a new Session file and leaves the original on its own child | 2.7 s | A real pi fork writes a Session file and the original keeps its own child. |
| launcher.spec.ts | --help lists every flag | 1.1 s | The built CLI's `--help` names every documented flag. |
| launcher.spec.ts | a taken port fails with one line naming --port | 1.1 s | The CLI refuses an occupied port in one line. |
| launcher.spec.ts | health answers and the server serves no pages | 1.1 s | The launched server answers `/healthz` and serves no page. |
| launcher.spec.ts | --project is repeatable and the banner names every Project in order | 1.1 s | The CLI accepts repeated `--project` and prints each resolved path in order. |
| launcher.spec.ts | a --project that does not exist refuses startup and names it | 1.1 s | The CLI refuses a missing Project and names it. |
| launcher.spec.ts | a --project that is a file refuses startup and names it | 1.2 s | The CLI refuses a file posing as a Project and names it. |
| launcher.spec.ts | two spellings of one Project are refused after resolution | 1.1 s | The CLI refuses two symlinked spellings of one resolved Project. |
| launcher.spec.ts | a Project nested inside another served Project is refused naming both | 1.2 s | The CLI refuses a nested Project and names both paths. |
| launcher.spec.ts | --cwd is not an alias for --project | 1.2 s | The CLI rejects `--cwd` as an unknown flag. |
| launcher.spec.ts | --help describes --project as repeatable | 1.1 s | The CLI documents `--project` as repeatable and does not document `--cwd`. |
| launcher.spec.ts | a foreign or missing origin is refused and logged | 0.0 s | A real WebSocket upgrade from a foreign or missing origin is refused and logged. |
| launcher.spec.ts | SIGINT shuts down cleanly and stops the Pi children across every Project | 2.9 s | One signal stops real Pi children seated in two Projects. |
| message-tree.spec.ts | a Leaf move is confirmed by pi, and an unconfirmed one is refused honestly | 1.4 s | pi confirms a Leaf move without touching the Session file and refuses an unknown entry. |
| multi-project-commands.spec.ts | a bare sessionId is refused for every Session command | 0.0 s | Every Session command needs the Project/Session pair on the wire. |
| multi-project-commands.spec.ts | exporting a Session writes inside its own Project | 1.4 s | A real export writes inside the Session's own Project and nowhere else. |
| multi-project-commands.spec.ts | the tree and a Leaf move run through a Project's own pair | 1.4 s | A real pi tree and Leaf move are addressed by the Project pair. |
| multi-project-commands.spec.ts | reconnect respawns a Session through its Project's pair | 2.6 s | A reconnect respawns a real child in the Session's own Project. |
| multi-project-commands.spec.ts | a settled subagent's transcript is read through its Project's pair | 1.4 s | A settled subagent's transcript is read from the Project that owns it. |
| multi-project.spec.ts | a connection watching one Project is pushed no other Project's list | 0.0 s | One real connection is pushed only the list of the Project it watches. |
| multi-project.spec.ts | a pair naming an id from another Project is refused and nothing is searched | 0.0 s | A cross-Project id is refused without searching the other Project. |
| multi-project.spec.ts | a refused pair leaves the Session the connection was watching attached | 1.3 s | A refused subscribe leaves the previous real attachment live. |
| multi-project.spec.ts | renaming in one Project refreshes only that Project's list | 1.4 s | A rename refreshes only the owning Project's list on the wire. |
| pool-defaults.spec.ts | the idle window --help documents is the one the pool evicts on | 4.4 s | `--help`'s default idle window is the window real children are evicted on. |
| pool-defaults.spec.ts | switching Session before the first Snapshot is built leaves neither Session watching | 4.1 s | Two attaches racing one socket leave neither Session watched after it closes. |
| protocol-snapshot.spec.ts | a WebSocket client receives a correct Snapshot for a seeded Session | 1.2 s | A real socket receives pi's Snapshot of a seeded Session. |
| protocol-snapshot.spec.ts | a Projects request answers with the served Projects in order and starts no Pi child | 0.0 s | A registry read answers in order and seats no real child. |
| protocol-snapshot.spec.ts | malformed and unknown inbound messages are rejected loudly | 1.2 s | A real connection rejects malformed, unknown and under-specified frames and still serves a Snapshot. |
| resync.spec.ts | a client reattaching at a known Cursor receives the missed Deltas | 1.3 s | A real reattach replays the Deltas from the given Cursor. |
| resync.spec.ts | an unknown Cursor is answered with a fresh Snapshot | 1.4 s | A stale or future Cursor is answered with a fresh Snapshot. |

40 tests, 49.2 s of test bodies.

## Keep

84 tests, 192.6 s of test bodies. The comment column is the line to place directly above the test.

| file | test | journey | wiring claim | duration | why jsdom/store cannot hold it | proposed comment |
| --- | --- | --- | --- | --- | --- | --- |
| bash-mode.spec.ts | streams the command's output live and ends with its exit code | open/choose/send | A real shell command's output reaches the card before the command exits, with pi's exit code at the end. | 3.0 s | Needs a real Pi child running a real command that emits output in two visible stages. | `// Wiring claim: a real command's output is streamed before it exits and pi's exit code closes the card.` |
| bash-mode.spec.ts | shows a non-zero exit as an error | open/choose/send | A real shell command exiting 3 is reported as exit code 3 and an error card. | 2.4 s | Needs a real bash process's exit status to cross pi and the socket. | `// Wiring claim: a real command's non-zero exit status reaches the card as pi reports it.` |
| bash-mode.spec.ts | the bash card survives a dropped connection and resync | reconnect and resync | A projected bash execution survives a real socket drop and resync as one unchanged card. | 3.2 s | Needs a real socket drop and the server's replay of the projected execution. | `// Wiring claim: a dropped socket and resync re-send the projected bash execution rather than re-creating it.` |
| bash-mode.spec.ts | `!!` output never enters the model's context | open/choose/send | A real `!!` command's output reaches the web UI but not the model's context. | 2.5 s | Needs a real Pi child whose model call can be told what context it received. | `// Wiring claim: a real command's excluded output is visible in the web UI and absent from pi's context.` |
| compaction.spec.ts | a Session pi already compacted shows its boundary straight from the Session file | open/choose/send | pi's own compaction entry in a Session file is projected as a boundary with a measured readout. | 2.2 s | Needs pi's real file format for a compaction boundary and its measurement. | `// Wiring claim: a compaction pi already wrote is projected from the Session file, not from a server-side event.` |
| compaction.spec.ts | compaction from the palette leaves a boundary and clears the context readout | open/choose/send | A real manual compaction produces a boundary and a remeasured context figure only after the next model call. | 1.7 s | Needs a real compaction and pi's own token measurement after it. | `// Wiring claim: a real compaction leaves pi's boundary and its readout recalculates only after a model call.` |
| compaction.spec.ts | compaction typed with instructions reaches pi as the summary's focus | open/choose/send | Text typed after `/compact` reaches pi as the focus of the history summary it asks for. | 1.8 s | Needs a real Pi child whose compaction request carries the typed instructions. | `// Wiring claim: the instructions typed after /compact are the focus pi summarizes with.` |
| composer-controls.spec.ts | an attached image reaches pi with the message | open/choose/send | An attached image's bytes reach a real Pi child with the prompt. | 1.6 s | Needs a real Pi child that accepts and decodes an image attachment. | `// Wiring claim: an attached image reaches pi with the message and the accepted send clears it.` |
| composer-controls.spec.ts | steer enters the run at its next step | open/choose/send | A steer is delivered by pi at the next turn boundary, not into the running turn. | 1.7 s | Needs a real run held mid-turn and pi's own delivery point. | `// Wiring claim: pi delivers a steer at the next turn boundary, and the draft stays until then.` |
| composer-controls.spec.ts | follow up waits until the run finishes | open/choose/send | A follow-up is queued by the server until the real run settles, then answered. | 2.3 s | Needs a real run held open and pi's ordering of the queued turn. | `// Wiring claim: a follow-up reaches pi only after the run in front of it settles.` |
| composer-controls.spec.ts | the status strip round-trips pi's automatic compaction | open/choose/send | Toggling automatic compaction writes to pi and the strip follows pi's reported value only. | 1.6 s | Needs a real settings round trip through pi, not a fed `Settings` message. | `// Wiring claim: the auto-compaction toggle round-trips through pi and shows only what pi reports.` |
| composer-controls.spec.ts | the status strip lists pi's models and thinking levels | open/choose/send | pi reports the model list and thinking levels, and a chosen level round-trips back into the strip. | 2.1 s | Needs the real child's reported models and levels, including an applied selection. | `// Wiring claim: the pickers show pi's own models and levels, and a chosen level comes back from pi.` |
| composer-controls.spec.ts | send is the row's last control in the thumb corner at a full touch size | phone layout and touch | Send closes the control row at the composer's right edge, with a 44 px target and an unclipped glyph. | 2.0 s | Needs a laid-out composer to measure containment and target size. | `// Wiring claim: send is the row's last control, at the thumb corner and a full touch target.` |
| composer-controls.spec.ts | the composer holds up with a keyboard-sized viewport and after rotation | phone layout and touch | The composer and send stay visible and tappable in a keyboard-height viewport and after rotation. | 2.1 s | Needs a real viewport and layout engine at two aspect ratios. | `// Wiring claim: a keyboard-sized viewport and a rotation leave the composer and send usable.` |
| composer-status-strip.spec.ts | model and thinking read in the accent tone and auto-compact is green only while on | phone layout and touch | The strip paints its controls in the theme's resolved accent, hairline and success tones, and green only when pi reports auto-compaction on. | 1.6 s | Needs computed CSS custom properties from the real browser. | `// Wiring claim: the strip's tones are the theme's resolved palette, and green follows pi's own auto-compaction state.` |
| composer-status-strip.spec.ts | the status strip fits the narrowest phone and never cuts a label | phone layout and touch | All three strip controls keep a whole label inside the strip at 320 px and 393 px without scrolling. | 2.0 s | Needs real text measurement to know a label is clipped. | `// Wiring claim: every status-strip label fits inside the strip at the narrowest phone widths.` |
| composer-status-strip.spec.ts | a long model name ellipsizes instead of pushing the toggle off the row | phone layout and touch | pi's long model name gives way on the narrowest phone and never pushes the toggle off the row. | 2.0 s | Needs real text overflow measurement with a name pi reported. | `// Wiring claim: a long model name ellipsizes at 320 px and leaves the toggle on the row.` |
| crash-recovery.spec.ts | a crashed Pi child shows its exit details, and Reconnect and Resume both restore it | reconnect and resync | A real killed child is reported as crashed with its signal, and both recovery controls respawn it from the Session file. | 8.0 s | Needs a real Pi child killed with SIGKILL and a real respawn. | `// Wiring claim: a killed Pi child is reported as crashed and both recovery controls respawn it.` |
| dev-proxy.spec.ts | the dev server reaches real pi from a browser through the proxy | launch and shutdown | A browser loaded from the real Vite dev server reaches real pi through the proxy. | 2.8 s | Needs a spawned dev server, its proxy and a real Pi child. | `// Wiring claim: a browser served by the dev server reaches real pi through the proxy.` |
| eviction.spec.ts | an idle, unwatched Session's Pi child is evicted after the timeout and respawns when opened | Session switching and Project isolation | A real child is evicted exactly at the idle window, never while watched, and respawns from the Session file. | 4.5 s | Needs real child PIDs and the server's injected clock to observe eviction. | `// Wiring claim: an unwatched real child is evicted at the idle window and respawns from the Session file.` |
| eviction.spec.ts | keep-alive keeps an unwatched Session's Pi child, however long it sits | Session switching and Project isolation | Keep-alive holds a real child past ten idle windows, and reopening reuses the same child. | 3.1 s | Needs the same real child PIDs across a clock advance. | `// Wiring claim: keep-alive keeps the same real child however long it sits unwatched.` |
| failed-turn.spec.ts | a failed turn states pi's error in the transcript, live and again from the Session file | open/choose/send | A real pi error reaches the run-state row and the durable card live, and again when a restarted server projects the file. | 3.0 s | Needs a real failing model call and a real server restart reading pi's file. | `// Wiring claim: pi's error shows live and again from the Session file after a server restart.` |
| failed-turn.spec.ts | a live failure whose error text is blank states the fallback in both places | open/choose/send | pi's blank error text becomes the server's fallback sentence in both the live row and the card. | 1.6 s | Needs a real child that reports a blank error and the server's fallback projection. | `// Wiring claim: a blank error from pi becomes the same fallback sentence in the row and the card.` |
| failed-turn.spec.ts | a seeded attempt keeps its error after the content, and an attempt with no content leaves no row | open/choose/send | pi's failed attempts project with content before error, no row for an empty attempt, and the same rows on a re-read. | 1.6 s | Needs pi's real attempt entries and the server's projection of them. | `// Wiring claim: pi's own failed attempts project with content before error and no row for an empty one.` |
| files.spec.ts | browses, expands, downloads and previews files from the chosen Project | files | A real Project tree is listed lazily, expanded, downloaded through the browser and previewed with truncation. | 1.8 s | Needs the real filesystem, a browser download event and the server's truncation bound. | `// Wiring claim: a real Project tree lists lazily, downloads through the browser and previews with truncation.` |
| fork-and-clone.spec.ts | /fork branches from a chosen message into a new Session and lists both | open/choose/send | pi forks from a chosen message into a real Session file, opens it, and leaves the original intact. | 4.3 s | Needs a real fork, its new file, and the original's own child. | `// Wiring claim: pi forks a real Session from the chosen message and leaves the original untouched.` |
| fork-and-clone.spec.ts | /clone copies the active branch into a new Session and lists both | open/choose/send | pi clones the active branch into a real Session file and both Sessions are listable. | 4.3 s | Needs a real clone and both Session files. | `// Wiring claim: pi clones the active branch into a real Session and both remain listable.` |
| long-transcripts.spec.ts | a 500+ entry Session loads within the budget with a bounded, scrolling window | open/choose/send | A 500+ entry Snapshot renders a bounded window whose count survives scrolling and page loading. | 3.4 s | Needs the browser's scroll box and real row-count behaviour. | `// Wiring claim: a 500+ entry transcript renders a bounded window that scrolling and loading older rows never exceed.` |
| long-transcripts.spec.ts | a streaming Delta updates text without remounting the mounted rows | open/choose/send | A streamed reply grows one row in place, adding no row and removing none. | 1.6 s | Needs real DOM nodes and a MutationObserver over a real stream. | `// Wiring claim: a streamed reply updates one row in place instead of remounting the mounted rows.` |
| long-transcripts.spec.ts | preserves the reader's scroll position when a stale Cursor is answered with a Snapshot | reconnect and resync | A stale Cursor is answered with a Snapshot that renumbers entries while the mounted range and pixel position stay put. | 3.8 s | Needs a real layout with scroll metrics and a real reconnect that evicts the child. | `// Wiring claim: a fresh Snapshot after a stale Cursor keeps the mounted range and the reader's pixel position.` |
| markdown.spec.ts | renders assistant markdown, contains a wide code block, and copies raw markdown | phone layout and touch | Rendered markdown keeps a wide code block scrolling inside itself and copies its raw source to the clipboard. | 1.9 s | Needs the browser clipboard and a real layout width comparison. | `// Wiring claim: wide markdown stays inside its block and the copy control writes the raw source.` |
| markdown.spec.ts | the message card keeps its corner control inside the card at 320 px | phone layout and touch | At 320 px the card's copy control stays inside the card and a 44 px target, clear of the first block. | 1.6 s | Needs real box geometry at a narrow width. | `// Wiring claim: at 320 px the card's copy control stays inside the card and clear of its text.` |
| message-tree.spec.ts | both entry points open one modal that collapses alternatives and searches the whole tree | open/choose/send | The tree modal opens from both entry points and its body never scrolls horizontally on a phone. | 2.0 s | The horizontal-overflow claim needs a real layout engine; the rest is store-covered and kept here only for that measurement. | `// Wiring claim: the tree body never scrolls horizontally on a phone.` |
| message-tree.spec.ts | selecting a message moves the Leaf, follows it in the transcript and keeps the old branch | open/choose/send | pi confirms a Leaf move, the transcript follows the confirmed Leaf, and the branch left behind stays in the tree. | 1.7 s | Needs pi's confirmation and the server's re-projection of the transcript. | `// Wiring claim: the transcript follows the Leaf pi confirmed, and the branch it left stays in the tree.` |
| message-tree.spec.ts | a hidden custom message has no tree row, exactly as the transcript has none | open/choose/send | A hidden custom entry in pi's Session file is projected out of both the transcript and the tree. | 1.6 s | Needs the server's projection of a real Session file. | `// Wiring claim: an entry pi records but the UI hides is absent from both the transcript and the tree.` |
| message-tree.spec.ts | a 100-deep Session renders flat and every visible row is one tap away | phone layout and touch | A 100-deep Session renders with depth at most two, no horizontal overflow, and a deep row one tap from the composer. | 1.6 s | The depth cap is not carried at store height, and the overflow claim needs a layout engine. | `// Wiring claim: a 100-deep Session stays flat and never widens the tree on a phone.` |
| multi-project-commands.spec.ts | fork and clone open their new Session in the source Project | Session switching and Project isolation | With two Projects served, pi's fork and clone land in the source Project and the other Project's list never sees them. | 6.7 s | Needs real fork/clone children and two real Project lists. | `// Wiring claim: fork and clone write into the source Project, and the other Project's list never sees them.` |
| multi-project-commands.spec.ts | a steer reaches a running agent in another Project | Subagents | A steer typed while a second Project is open reaches the running agent in the first Project. | 2.3 s | Needs a real subagent held mid-run and a real socket per Project. | `// Wiring claim: a steer reaches a running agent that lives in a Project other than the one on screen.` |
| multi-project.spec.ts | a Session opens and answers a prompt inside its own Project | Session switching and Project isolation | A Session opened in the second Project runs its Pi child there and answers from its own file. | 1.6 s | Needs the child's real working directory and file. | `// Wiring claim: a Session's Pi child runs in the Session's own Project and answers from that Project's file.` |
| multi-project.spec.ts | creating a Session starts it in the chosen Project | Session switching and Project isolation | A created Session's id comes from the server, pi writes it into the chosen Project, and the other Project's list omits it. | 1.7 s | Needs a real child writing its file into one Project. | `// Wiring claim: a created Session's Pi child writes into the chosen Project and only that Project lists it.` |
| multi-project.spec.ts | a run keeps working while another Project is viewed | Session switching and Project isolation | A run held in the first Project finishes while the browser has reloaded into the second Project. | 1.8 s | Needs a real child that survives a full page load in another Project. | `// Wiring claim: a run in one Project survives a full reload into another Project.` |
| multi-project.spec.ts | a run keeps working while another Project is viewed without reloading | Session switching and Project isolation | A run held in the first Project finishes while the same page switches to the second Project and back. | 2.4 s | Needs a real child that survives an in-app Project switch. | `// Wiring claim: a run in one Project survives an in-app switch to another Project and back.` |
| no-session.spec.ts | a bare page connects, lists the project's Sessions and offers a new one | open/choose/send | A page with no Session named still connects, lists the Project's Sessions and creates one with a server id. | 0.3 s | Needs a real socket before any Session is chosen. | `// Wiring claim: a page with no Session still connects, lists the Project's Sessions and creates one.` |
| phone-fit.spec.ts | the shell is drawn in the console theme: palette, monospace type and composer geometry | phone layout and touch | The shell's palette, type ramp and composer geometry resolve to the design's rendered values. | 1.5 s | Needs computed styles and box geometry. | `// Wiring claim: the shell's palette, type and composer geometry are the ones the design states, as rendered.` |
| phone-fit.spec.ts | reduced motion stops the pulse and loses no text | phone layout and touch | Reduced motion removes the running pulse while the same fact stays in text and the stop control still works. | 1.7 s | Needs a real media-query evaluation and CSS animation. | `// Wiring claim: reduced motion stops the pulse without losing the text or the stop control.` |
| phone-fit.spec.ts | an overlay covers nothing it cannot act on, and a hidden label holds no tap | phone layout and touch | Every point an open overlay covers resolves to its panel or its dismissing scrim, and a hidden label swallows no tap. | 1.6 s | Needs `elementFromPoint` over a real laid-out overlay. | `// Wiring claim: an open overlay covers only points that act, and a hidden label swallows no tap.` |
| phone-layout.spec.ts | wide content scrolls inside itself and never widens the page at any phone width | phone layout and touch | Wide markdown, a long URL and long bash output stay contained at 320, 360, 393 and 430 px. | 2.5 s | Needs real text wrapping and scroll widths at four widths. | `// Wiring claim: wide content stays contained and scrolls inside itself at every phone width.` |
| phone-layout.spec.ts | a drawer scrolls itself and never the page or the transcript behind it | phone layout and touch | A wheel gesture over the drawer scrolls neither the document nor the transcript behind it. | 2.7 s | Needs real wheel events and scroll positions. | `// Wiring claim: scrolling the drawer never moves the page or the transcript behind it.` |
| phone-layout.spec.ts | the top bar holds its controls inside the narrowest phone | phone layout and touch | Every top-bar control stays inside 320 px, with Files rightmost and the connection status to its left. | 2.0 s | Needs real control boxes at the narrowest width. | `// Wiring claim: every top-bar control fits inside the narrowest phone, with Files rightmost.` |
| phone-layout.spec.ts | the session bar leads with the agent pill inside the narrowest phone | phone layout and touch | The agent pill leads the session bar, caps its width and leaves the context readout inside the bar at 320 px. | 2.0 s | Needs real box geometry for the pill and the readout. | `// Wiring claim: the agent pill leads the session bar and leaves the readout inside it at 320 px.` |
| project-picker.spec.ts | the first load shows the Project picker and one tap lists that Project's Sessions | open/choose/send | A real registry reaches the picker, and one tap fetches that Project's Sessions and writes the choice into the address. | 0.2 s | Needs the server's Projects and Sessions answers over a real socket. | `// Wiring claim: the picker is the real registry, and choosing a Project fetches that Project's Sessions.` |
| project-picker.spec.ts | two pages on different Projects do not change each other's view | Session switching and Project isolation | Two browsers on one server stay on their own Project when one of them sends a prompt. | 3.5 s | Needs two real pages, two sockets and one real server. | `// Wiring claim: two pages on one server keep their own Project when either runs a prompt.` |
| reconnect.spec.ts | a drop rejoins after the first backoff and catches up on output produced meanwhile | reconnect and resync | A real socket drop rejoins exactly at the transport's first backoff and catches up on output produced while down. | 1.5 s | Needs a real drop, the real backoff timer and a second real writer. | `// Wiring claim: a dropped socket rejoins at the first backoff and catches up on output produced while down.` |
| send-and-stream.spec.ts | sends a message and renders the streamed scripted reply and its thinking | open/choose/send | A prompt sent through the composer produces a real pi reply whose thinking and text stream into the transcript. | 2.1 s | Needs a real Pi child and a streamed reply. | `// Wiring claim: a prompt sent from the composer produces pi's streamed reply and thinking.` |
| send-and-stream.spec.ts | keeps the view pinned to the newest output while streaming | open/choose/send | The transcript stays within four pixels of the bottom while a real reply streams. | 2.2 s | Needs real scroll metrics during a live stream. | `// Wiring claim: the transcript stays pinned to the newest output while a real reply streams.` |
| send-and-stream.spec.ts | turns send into stop while a run is active and stop aborts it | open/choose/send | Stop aborts a real running turn and the run settles as aborted. | 1.6 s | Needs a real run to abort and its state to come back over the socket. | `// Wiring claim: stop aborts the real run and the settled state is aborted.` |
| send-and-stream.spec.ts | renders an errored run with the failure text | open/choose/send | A real failing model call sets an errored run state carrying pi's message. | 2.1 s | Needs a real child that reports a failure. | `// Wiring claim: a real failed turn sets an errored state carrying pi's message.` |
| send-and-stream.spec.ts | renders the retry attempt count and recovers | open/choose/send | pi's retry attempt count reaches the run-state row and the retry's eventual reply clears it. | 3.9 s | Needs a real child retrying and then succeeding. | `// Wiring claim: pi's retry attempt count is shown and a recovered run leaves no row behind.` |
| sessions.spec.ts | tapping a row switches the transcript and starts that Session lazily | Session switching and Project isolation | Tapping a Session row starts that Session's own child lazily and replaces the transcript with its file. | 2.9 s | Needs a real child started only on the tap. | `// Wiring claim: a tapped Session starts its own child then, and its transcript replaces the previous one.` |
| sessions.spec.ts | the plus control opens a new Session with a server-generated id | open/choose/send | The client names no id; the server creates the Session and the shell opens it. | 1.6 s | Needs the server's real create answer. | `// Wiring claim: the plus control opens a Session whose id only the server supplied.` |
| sessions.spec.ts | a background Session keeps running and its output is there on return | Session switching and Project isolation | An unviewed Session keeps a real run alive and its output is there when the reader returns. | 3.0 s | Needs a real child running while another Session is watched. | `// Wiring claim: a background Session's run continues while another is read and its output survives the return.` |
| sessions.spec.ts | two Sessions run in separate Pi children and never share a transcript | Session switching and Project isolation | Two Sessions each get their own child and each child's first model call is its own. | 3.1 s | Needs two real children with separate model-call order. | `// Wiring claim: two Sessions run in separate children and never consume each other's replies.` |
| shell.spec.ts | the app opens, connects and renders a seeded transcript on a phone | launch and shutdown | The built bundle loads at the phone viewport, connects and renders pi's Snapshot of a seeded Session. | 1.5 s | Needs the built client bundle, a real socket and a real child. | `// Wiring claim: the built bundle opens on a phone, connects, and renders pi's Snapshot.` |
| slash-palette.spec.ts | the palette lists built-ins and pi's prompt templates, filters, and inserts without sending | open/choose/send | pi's discovered prompt templates appear beside the built-ins, filter, and insert without reaching the model; an unknown command is forwarded. | 1.7 s | Needs pi's real template discovery and command routing. | `// Wiring claim: the palette lists pi's own prompt templates and forwards an unknown command to pi.` |
| slash-palette.spec.ts | /resume opens the list, /name renames, /session shows pi's statistics, /export downloads | open/choose/send | `/resume`, `/name`, `/session` and `/export` round-trip through pi: the drawer opens, the rename lands, pi's statistics render and the export downloads. | 1.9 s | Needs pi's real name, statistics and export. | `// Wiring claim: /resume, /name, /session and /export round-trip through pi and show pi's own answers.` |
| subagent-drawer.spec.ts | the drawer hides a subagent child and keeps the owner's own fork | Session switching and Project isolation | A Session file whose header names the open Session and whose name carries a run id is hidden, while an owner's fork stays listed. | 0.2 s | Needs the server's rule over real Session files, which a fed list cannot prove. | `// Wiring claim: a run's child Session is hidden from the drawer while the owner's own fork stays listed.` |
| subagent-drawer.spec.ts | a Session with only one of a child's facts stays listed | Session switching and Project isolation | A Session with a run-id-shaped name but no parent, or a parent but no run id, stays listed. | 0.2 s | Needs the server's rule over real Session files. | `// Wiring claim: one of a child's two facts is not enough to hide a Session from the drawer.` |
| subagent-list.spec.ts | the list shows each agent's type, name, status and elapsed time, and a row focuses it | Subagents | A real pi-subagents run reports type, name, live status and elapsed time, and focusing a row moves the view. | 2.3 s | Needs a real subagent held mid-run. | `// Wiring claim: a real subagent's row reports its type, name, live status and elapsed time.` |
| subagent-list.spec.ts | a workflow run is its own row in the list | Subagents | A real workflow run appears as its own row and cannot be focused. | 2.2 s | Needs a real SubagentWorkflow run. | `// Wiring claim: a real workflow run is its own row and focusing it changes nothing.` |
| subagent-past.spec.ts | past subagent runs are listed after a server restart | Subagents | After a restart, a settled run is listed from pi's files and its conversation opens from the child's own session file. | 3.6 s | Needs a real settled run, its files and a restarted server. | `// Wiring claim: a settled run survives a server restart in pi's files and its conversation opens from them.` |
| subagent-past.spec.ts | a settled run with no child session file says its conversation is gone | Subagents | With the child file removed, the UI says the conversation is gone instead of showing an empty one. | 3.1 s | Needs a real run's file removed behind the server. | `// Wiring claim: a settled run with no child file says its conversation is gone.` |
| subagent-past.spec.ts | two child sessions matching one run are refused instead of guessed | Subagents | Two files matching one run id are refused rather than one being chosen. | 3.1 s | Needs real child files and the server's refusal. | `// Wiring claim: two child files matching one run are refused rather than guessed between.` |
| subagent-past.spec.ts | an unreadable child session refuses instead of reporting the conversation gone | Subagents | An unreadable child file is reported as unavailable, not as gone. | 3.1 s | Needs real file modes that deny a read. | `// Wiring claim: an unreadable child file is reported as unavailable, never as gone.` |
| subagent-pill.spec.ts | a scripted Agent call spawns a real subagent and the pill counts it | Subagents | A real Agent call spawns a subagent and the pill counts it while it works, then drops the count. | 1.8 s | Needs the real pi-subagents extension and a held subagent. | `// Wiring claim: a real Agent call spawns a subagent the pill counts while it works.` |
| subagent-pill.spec.ts | a background subagent is counted on main after the parent settles | Subagents | A background subagent stays counted after the parent's turn settles. | 2.4 s | Needs a real background spawn and its live status. | `// Wiring claim: a background subagent stays counted after the parent settles.` |
| subagent-pill.spec.ts | without pi-subagents the extension is absent and no agent pill is shown | Subagents | Without the extension, pi reports no `/agents` command and no pill appears. | 1.6 s | Needs the child's real extension list. | `// Wiring claim: without pi-subagents the child reports no /agents command and no pill appears.` |
| subagent-steering.spec.ts | typed text steers the focused running agent and is shown until it lands | Subagents | A steer reaches the focused running agent at its turn boundary, is shown pending until then, and never enters the Session's own conversation. | 1.9 s | Needs a real subagent held mid-command and pi's delivery. | `// Wiring claim: a steer reaches the focused agent at its turn boundary and never the Session.` |
| subagent-transcript.spec.ts | a focused running agent's conversation streams into the transcript view | Subagents | Focusing a running agent replaces the transcript with that agent's live conversation. | 2.2 s | Needs the agent's real event stream. | `// Wiring claim: a focused running agent's own conversation replaces the Session transcript and streams live.` |
| subagent-transcript.spec.ts | the focused agent's transcript survives a resync | reconnect and resync | A focused Agent's conversation survives a real socket drop with no Cursor, is carried in the new Snapshot, and keeps streaming afterwards. | 2.6 s | Needs a real drop, a real Snapshot carrying subagent transcripts, and a still-live agent. | `// Wiring claim: a focused agent's conversation survives a resync and keeps streaming into the same view.` |
| tool-cards.spec.ts | renders the seed's completed and failed tool results as cards | open/choose/send | pi's Snapshot folds durable tool results into their calls, and an orphan result keeps its own row. | 1.5 s | Needs the server's projection of pi's real entries. | `// Wiring claim: pi's durable tool results fold into their calls, and an unmatched result keeps its own row.` |
| tool-cards.spec.ts | streams a scripted tool call from running to a success card | open/choose/send | A real tool call is running while its command executes and becomes a success card when pi reports the result. | 1.7 s | Needs a real child executing the command between the two states. | `// Wiring claim: a real tool call is running while its command executes and succeeds when pi reports it.` |
| touch-targets.spec.ts | every control the composer's own states put on screen meets the minimum | phone layout and touch | Every control in every composer state, overlay and picker is at least a 44 px target. | 2.2 s | Needs real boxes for each laid-out state. | `// Wiring claim: every control the composer's states put on screen is at least a 44 px target.` |
| touch-targets.spec.ts | a Session that is still starting meets the minimum | phone layout and touch | The Starting row's controls meet the minimum before any Snapshot lands. | 1.5 s | Needs the real first frame and box geometry. | `// Wiring claim: the Starting row's controls are full touch targets before any Snapshot arrives.` |
| touch-targets.spec.ts | the agent list and the transcript's own controls meet the minimum | phone layout and touch | The agent list, notification card and focused-subagent composer all meet the minimum. | 1.6 s | Needs real boxes for the list and the focused composer. | `// Wiring claim: the agent list, notification controls and a focused subagent's composer are full touch targets.` |

## Cut

29 tests, 34.6 s of test bodies.

| file | test | duration | claim it makes | store/component test that already carries it |
| --- | --- | --- | --- | --- |
| bash-mode.spec.ts | states the bash mode before the command is sent | 2.3 s | `!` and `!!` are labelled as in/out of context before sending. | `bash-mode.test.ts` — "states that `!` output enters the context, before the command is sent"; "states that `!!` output stays out of the context, before the command is sent" |
| composer-controls.spec.ts | a tap outside an open model list dismisses it and leaves the model alone | 1.7 s | Tapping away closes the model list and changes no model; tapping the toggle closes it without reopening. | **Not carried.** Add to `composer-attachments-status.test.ts`: "dismisses an open model list on a tap away, leaves the model alone, and the toggle closes rather than reopens it." |
| composer-controls.spec.ts | a tap outside an open effort list dismisses it and leaves the effort alone | 1.6 s | Tapping the composer closes the effort list, keeps the level and focuses the input. | **Not carried.** Add to `composer-attachments-status.test.ts`: "dismisses an open effort list on a tap on the composer, keeps the level, and lets the tap reach the input." |
| composer-controls.spec.ts | a pointer that moves before it lifts leaves an open list open | 1.6 s | A scroll or drag that begins outside the list does not dismiss it. | **Not carried.** Add to `composer-attachments-status.test.ts`: "a pointer that moves past the tap slop before it lifts leaves the open list open." |
| composer-controls.spec.ts | opening one picker closes the other, and a chosen row applies once | 1.8 s | The two pickers are exclusive, and a chosen row closes its list and applies exactly once. | **Partly carried.** `composer-attachments-status.test.ts` — "offers only pi's models and thinking levels" covers a chosen row applying (`setModel`/`setThinking` once). Exclusivity is **not carried**: add "opening one picker closes the other" there. |
| composer-controls.spec.ts | Enter inserts a newline and Ctrl+Enter sends | 1.6 s | Plain Enter inserts a newline and never sends; Ctrl+Enter sends. | `composer-controls.test.ts` — "sends on Ctrl+Enter and leaves plain Enter to insert a newline" |
| composer-controls.spec.ts | Escape cancels the running turn | 1.6 s | Escape while a run is active aborts it and the state settles aborted. | `composer-controls.test.ts` — "cancels a running turn"; "gives the first Escape to an open palette and does not abort". The abort-to-pi wiring is carried by the kept `send-and-stream.spec.ts` "turns send into stop while a run is active and stop aborts it". |
| files.spec.ts | the file panel follows the chosen Project, not the open Session | 0.5 s | On a Project switch the panel closes, re-roots, and a same-named file previews the new Project's copy. | `files.test.ts` — "never renders a listing that belongs to another Project"; "re-roots at the newly chosen Project and forgets the previous tree"; "names both the Project and the path relative to it". The server-side rooting is carried by the page-less "listing, preview and download are rooted at the Project each request names". |
| files.spec.ts | the folder control waits for a chosen Project | 0.2 s | The files control is disabled until a Project is chosen, then enabled. | `projects.test.ts` — "is disabled until a Project is chosen, then enabled for that Project" |
| markdown.spec.ts | renders a recorded extension notification as a card in the transcript | 1.6 s | A recorded extension message renders as a notification card with its summary and payload. | `transcript.test.ts` — "renders an extension message as a card named by its summary" |
| message-tree.spec.ts | one tap opens a whole abandoned branch, not one message of it | 1.6 s | One tap opens an abandoned branch to its end and collapsing it destroys nothing. | `message-tree.test.ts` — "reveals an abandoned branch head whose only child is off the active path" |
| message-tree.spec.ts | one tap on the row past a new Leaf reveals the branch behind it in full | 1.7 s | After a Leaf move, one tap opens the whole branch left behind and reveals exactly the announced count. | `message-tree.test.ts` — "opens the branch you came from in one tap after moving the Leaf back" |
| message-tree.spec.ts | a linear Session opens the whole tree with no toggles | 1.5 s | A linear Session renders every entry flat with no toggles. | `message-tree.test.ts` — "gives a linear Session no toggles at all" |
| multi-project.spec.ts | the drawer lists only the chosen Project's Sessions | 0.2 s | The drawer renders only the chosen Project's list. | `projects.test.ts` — "ignores another Project's Session list"; the server push is carried by the page-less "a connection watching one Project is pushed no other Project's list" |
| multi-project.spec.ts | the drawer's Sessions and the file panel change together on one switch | 2.3 s | One Project switch moves the drawer's rows and re-roots the file panel. | `projects.test.ts` — "lists Projects, switches, and returns to the chosen Project's Sessions"; `files.test.ts` — "re-roots at the newly chosen Project and forgets the previous tree" |
| multi-project.spec.ts | a Session from the Project left behind still opens after switching away | 2.3 s | After switching away and back, the old Project's Session opens with its own transcript. | `projects.test.ts` — "keeps the chosen Project's list when that Project is chosen again"; `sessions.test.ts` — "drops the previous transcript on a switch and never applies its late Deltas" |
| project-picker.spec.ts | a remembered Project opens directly and a ?project= link does too | 0.2 s | A remembered Project and a linked `?project=` both open directly. | `projects.test.ts` — "remembers the chosen Project and recalls it on the next visit"; "chooses the linked Project when the registry serves it" |
| project-picker.spec.ts | an unserved remembered Project shows the picker with a notice naming the path | 0.2 s | An unserved remembered Project falls back to the picker with a path-naming notice. | `projects.test.ts` — "shows the picker and names a remembered Project the server no longer serves" |
| project-picker.spec.ts | an unserved linked Project shows the picker with a notice naming the path | 0.2 s | An unserved linked Project falls back to the picker with a path-naming notice. | `projects.test.ts` — "shows the picker and names a linked Project the server does not serve" |
| project-picker.spec.ts | a server serving one Project skips the picker | 0.2 s | A single-Project server skips the picker and opens the drawer. | `projects.test.ts` — "skips the picker when the server serves exactly one Project" |
| project-picker.spec.ts | an unserved remembered Project keeps its notice even when one Project is served | 0.2 s | A single-Project server with an unserved remembered Project keeps the picker and its notice. | `projects.test.ts` — "keeps the picker when the only served Project is not the remembered one" |
| project-picker.spec.ts | a Project with no Sessions opens to an empty transcript with New Session available | 0.4 s | An empty Project renders "No sessions yet.", an empty transcript and a working New Session action. | **Not carried.** Add to `sessions.test.ts`: "renders an empty Session list and offers New Session when the Project has none." |
| project-picker.spec.ts | two Projects sharing a last path segment are distinguishable in the picker and the drawer | 0.3 s | Shared last segments are disambiguated by parent labels in the picker and the drawer. | `projects.test.ts` — "distinguishes Projects that share a last segment by their parents" carries the label rule. The drawer's `current-project-label` assertion is not carried: extend "lists Projects, switches, and returns to the chosen Project's Sessions" with it. |
| sessions.spec.ts | the drawer lists this project's Sessions with name, first message and recency | 1.5 s | A Session row shows pi's name or first-message fallback, whole-day recency and no rename/delete. | `sessions.test.ts` — "renders the server's sessions with the name, the first-message fallback and recency"; "offers no rename or delete control" |
| shell.spec.ts | the connection label is revealed on tap | 0.2 s | The status label is hidden at opacity 0 and revealed on tap as "Connected". | **Not carried.** Add to `header.test.ts`: "hides the connection label until the status control is tapped, then reveals its text." |
| slash-palette.spec.ts | /new opens a Session with a server-generated id | 1.6 s | `/new` creates a Session whose id came from the server and opens it. | `slash-palette.test.ts` — "starts a new Session with /new". The server-supplied id and the open are carried by the kept `sessions.spec.ts` "the plus control opens a new Session with a server-generated id"; the claim is the same one with a different trigger. |
| subagent-steering.spec.ts | a settled agent disables sending and says why | 2.2 s | A settled agent refuses a steer, says why and sends nothing. | `subagent-steering.test.ts` — "refuses to send to a settled agent and states why" (plus "states the queued reason rather than the settled one") |
| tool-cards.spec.ts | folds a long tool output and opens it in place | 1.6 s | A long output shows six lines, states its folded remainder, and opens as one text node. | `tool-cards.test.ts` — "shows a capped preview and says how much is folded"; "opens a long output as one text node rather than a paragraph per line" |
| tool-cards.spec.ts | renders a failing scripted tool as an error card | 1.6 s | A failed tool result renders as an error card with the "Failed" status. | `tool-cards.test.ts` — "shows a failed tool call as an error". The real failure-to-status wiring is carried by the kept `bash-mode.spec.ts` "shows a non-zero exit as an error". |

### Expected cut areas, confirmed against the store tests

| expected area | verdict |
| --- | --- |
| Composer model/effort pickers — dismissal, exclusivity, a chosen row applying once | Confirmed as the right place to cut, but **coverage is missing**. Only "a chosen row applies" is carried (`composer-attachments-status.test.ts`). Dismissal, tap slop, and exclusivity need the three store tests named above before deletion. |
| Project picker's near-identical notice variants | Confirmed. `projects.test.ts` carries the remembered/linked notices, the single-Project skip and the remembered-Project-beats-single-Project case. One picker variant survives (first load), plus the two-page isolation test, which is not a variant. |
| Message tree's collapsed-branch rendering | Confirmed. `message-tree.test.ts` carries the abandoned-branch reveal, the one-tap open after a Leaf move, the fork stop, and the linear tree. The browser keeps the pi-confirmed Leaf move, the entry-point/overflow measurement, the hidden-entry projection and the depth cap. |
| Tool card's folded output | Confirmed. `tool-cards.test.ts` carries the capped preview, the folded count and the one-text-node open. |

## Journey coverage after the cuts

| journey | surviving browser tests (examples, all in the keep table) |
| --- | --- |
| open/choose/send | `send-and-stream.spec.ts` (5), `bash-mode.spec.ts` (3), `compaction.spec.ts` (3), `composer-controls.spec.ts` (5), `no-session.spec.ts`, `slash-palette.spec.ts` (2), `sessions.spec.ts` (plus control), `failed-turn.spec.ts` (3), `fork-and-clone.spec.ts` (2), `message-tree.spec.ts` (4), `tool-cards.spec.ts` (2) |
| Subagents | `subagent-list.spec.ts` (2), `subagent-past.spec.ts` (4), `subagent-pill.spec.ts` (3), `subagent-steering.spec.ts` (1), `subagent-transcript.spec.ts` (1), `multi-project-commands.spec.ts` (steer) |
| reconnect and resync | `reconnect.spec.ts`, `bash-mode.spec.ts` (bash card resync), `long-transcripts.spec.ts` (stale Cursor), `subagent-transcript.spec.ts` (focused agent resync), `crash-recovery.spec.ts` |
| Session switching and Project isolation | `sessions.spec.ts` (3), `multi-project.spec.ts` (4), `multi-project-commands.spec.ts` (fork/clone), `project-picker.spec.ts` (two pages), `eviction.spec.ts` (2), `subagent-drawer.spec.ts` (2) |
| phone layout and touch | `phone-layout.spec.ts` (4), `phone-fit.spec.ts` (3), `touch-targets.spec.ts` (3), `composer-status-strip.spec.ts` (3), `composer-controls.spec.ts` (2), `markdown.spec.ts` (1), `message-tree.spec.ts` (depth) |
| files | `files.spec.ts` "browses, expands, downloads and previews files from the chosen Project" |
| launch and shutdown | `dev-proxy.spec.ts` (spawns the real dev server, a browser reaches real pi through its proxy), `shell.spec.ts` (the built bundle opens and connects) |

Note for ticket 10: the server launcher and SIGINT-shutdown claims are all page-less, so the
browser suite keeps only the page-launch face of this journey. That is consistent with the split —
shutdown of Pi children is a backend fact — but it should be said out loud when the launcher specs
move.

## Predicted after state

| field | before | after the cuts (browser suite only) |
| --- | --- | --- |
| browser tests | 113 | 84 |
| cut browser tests | — | 29 |
| browser test bodies | 227.3 s | 192.6 s |
| page-less tests | 40 (49.2 s) | 0 under Playwright; ticket 10 moves them |
| total Playwright tests | 153 | 84 |
| test bodies under Playwright | 276.5 s | 192.6 s |
| wall clock | 41.5 s at 8 workers | ~30–34 s predicted |

The prediction is arithmetic, not a measurement: 227.3 s of browser bodies finished in 41.5 s, and
84 tests carrying 192.6 s should finish in roughly 30–34 s at the same concurrency, with the 8.0 s
crash-recovery test and the 6.7 s cross-Project fork test setting the lower bound on the critical
path. The spec's 20–25 s projection assumed roughly 120 s of surviving bodies; the kept tests are the
expensive ones — real children, gates, layout — so 192.6 s is the honest floor and the budget script
will have to measure whether 45 s still has room. Cut decisions above are about claims, not speed:
the cut set is only 34.6 s of bodies, and the two slowest tests are both kept.

## Ambiguous cases

These are the calls the orchestrator should check before deletion.

1. **message-tree "both entry points open one modal that collapses alternatives and searches the
   whole tree" (2.0 s) — keep.** For: every rule in it except one is store-covered, so it is a
   mega-test; against: it is the only test that measures the tree body's horizontal overflow on a
   phone, and jsdom cannot. Recommendation: keep for the overflow claim, but consider shrinking the
   body to that one measurement so the store-covered assertions stop being restated.
2. **message-tree "a 100-deep Session renders flat" (1.6 s) — keep.** For: the depth cap has no
   store test and no other browser test; against: depth is pure component logic and could be carried
   by `message-tree.test.ts` with a 100-deep fixture, leaving only the overflow claim. Recommendation:
   keep now; if the orchestrator wants it gone, add the depth-cap store test first and keep the
   overflow assertion somewhere.
3. **message-tree "a hidden custom message has no tree row" (1.6 s) — keep.** For: it proves the
   server projects a hidden custom entry out of both surfaces from a real Session file; against: the
   rendering half is a store rule. Recommendation: keep; the projection half has no other home.
4. **project-picker "two pages on different Projects do not change each other's view" (3.5 s) —
   keep.** For: two real pages, two sockets, one server is the strongest Project-isolation statement;
   against: `projects.test.ts` "routes each device's list by the Project that device chose" plus the
   page-less push test hold the routing. Recommendation: keep; it is the only browser test with two
   live sockets on one server.
5. **sessions "the drawer lists this project's Sessions with name, first message and recency"
   (1.5 s) — cut.** For keeping: it is the only test showing pi's real name/first-message/timestamp
   metadata surviving into the drawer; against: `sessions.test.ts` carries every rendering rule and
   the list plumbing is exercised by the kept drawer tests. Recommendation: cut, but only if the
   orchestrator accepts that no test asserts pi's real metadata end to end; the cheaper alternative is
   to keep it and cut something else.
6. **slash-palette "/new opens a Session with a server-generated id" (1.6 s) — cut.** For: `/new`
   and the plus control are different entry points to one claim; against: two entry points may be two
   claims if the command path through the server is considered distinct. Recommendation: cut; the
   server-generated id and the open are already asserted by the kept plus-control test.
7. **tool-cards "renders a failing scripted tool as an error card" (1.6 s) — cut.** For: the error
   card is store-covered and the real non-zero exit is kept in `bash-mode.spec.ts`; against: the
   tool-card status is a different surface from the bash card, and a server regression that maps a
   failed result to "success" would now be caught only at the bash-card surface. Recommendation: cut;
   if that risk feels real, extend the kept bash-mode non-zero-exit test to assert the tool card too.
8. **composer-controls "Escape cancels the running turn" (1.6 s) — cut.** For: the keyboard-to-abort
   rule is store-covered and the abort-to-pi wiring is kept under Stop; against: Escape is the one
   gesture a phone/keyboard user reaches for and no kept test presses it against a real run.
   Recommendation: cut, unless the orchestrator values the gesture's own end-to-end path.
9. **shell "the connection label is revealed on tap" (0.2 s) — cut, with a missing store test.** For
   cutting: opacity and tap reveal are component rules; against: nothing at store height carries it,
   and `phone-fit.spec.ts` only covers hit-testing, not the reveal. Recommendation: add the
   `header.test.ts` component test named in the cut table, then cut.
10. **bash-mode "shows a non-zero exit as an error" (2.4 s) — keep.** For keeping: a real process's
    exit status crossing pi into the card is a wiring claim; against: `bash-mode.test.ts`
    "classifies a non-zero exit as an error" carries the classification rule and the kept streaming
    test already proves a real command completes. Recommendation: keep; the exit *status* is pi's
    fact, not the component's rule.
11. **failed-turn tests 2 and 3 (1.6 s each) — keep.** For keeping: the blank-error fallback is
    computed by the server (`RUN_FAILED_TEXT` in `projection.ts`) and the attempt rows come from pi's
    own file, so no store test can carry either; against: the rendered card rules are store-covered
    and the tests are mostly rendering assertions. Recommendation: keep; they are the only coverage of
    the server's fallback and attempt projection.
12. **multi-project "a Session from the Project left behind still opens after switching away"
    (2.3 s) — cut.** For keeping: re-opening across a Project switch is a real reattach; against:
    `projects.test.ts` keeps the chosen Project's list and the kept in-app run test already returns to
    the first Project and opens its Session. Recommendation: cut; the in-app run test covers the
    return path with a stronger claim (a live run).

## Review decisions (orchestrator)

Reviewed before any deletion. The tables above are the proposal; these decisions are what ticket 09
applies.

| decision | test | reason |
| --- | --- | --- |
| **Keep** | `sessions.spec.ts` — "the drawer lists this project's Sessions with name, first message and recency" | It is the only end-to-end proof that pi's real Session metadata — name, first-message fallback, age — survives into the drawer. `sessions.test.ts` carries the rendering but not the server's read of pi's own file. 1.5 s. |
| **Keep** | `tool-cards.spec.ts` — "renders a failing scripted tool as an error card" | pi's failed tool result reaching the card as an error is a wiring claim; `tool-cards.test.ts` only renders a fed failure. 1.6 s. |
| Apply as proposed | every other keep/cut row, including the ambiguous-case recommendations 1–4 and 6, 8–12 | The rule and the store coverage were checked; no cut is made for speed. |

**Final counts: 86 keep, 27 cut** (113 browser tests).

Comments for the two kept-from-cut tests:

- `// Wiring claim: pi's own Session metadata — its name or first-message fallback and its age — reaches the drawer from the Session file.`
- `// Wiring claim: pi's failed tool result is projected as an error card with its failure status.`

### Store/component tests to add before deleting

The cuts are conditional on these, because the rule is that a store or component test carries the
claim before the browser test leaves:

- `composer-attachments-status.test.ts` (or the existing composer test that already owns the state):
  dismissing an open model list on a tap away without changing the model; dismissing an open effort
  list on a tap on the composer while the tap still reaches the input; a pointer that moves past the
  tap slop leaving the list open; opening one picker closing the other.
- `sessions.test.ts`: an empty Project renders "No sessions yet.", an empty transcript and a working
  New Session action.
- `header.test.ts`: the connection label is hidden at opacity 0 and revealed on tap.

**Correction to the proposal:** `current-project-label` for Projects sharing a last segment is
already carried by `projects.test.ts` — its "distinguishes Projects that share a last segment by
their parents" test asserts the drawer label `oss/api`. No new store test is needed for that cut.

### Additional decision: message-tree depth cap moves down

The ticket requires the message tree's *rendering* rules to be carried at store level, with the
browser keeping the pi-confirmed Leaf move. The 100-deep test's depth cap is pure component logic, and
its overflow claim is already asserted by the kept "both entry points open one modal" test. So:

- **Add** a `message-tree.test.ts` test that a 100-deep Session renders with depth at most two and no
  horizontal overflow, using the existing store/component harness and a generated deep fixture.
- **Cut** `message-tree.spec.ts` — "a 100-deep Session renders flat and every visible row is one tap
  away" once that store test is green. The browser keeps the overflow measurement in the kept
  entry-points test and the pi-confirmed Leaf move in its own test.

**Revised final counts: 85 keep, 28 cut** (113 browser tests).
