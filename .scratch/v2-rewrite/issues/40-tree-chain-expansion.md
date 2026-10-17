# 40: Walking back along an abandoned branch takes one tap per message

**Category:** bug

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Symptom:** After selecting an earlier entry in the message tree, the conversation follows the new
Leaf as it should. Reopening the tree shows the branch you came from collapsed, but that branch can
only be opened one message at a time, so reaching the Leaf you just left means tapping every message
in between. Owner: "when I go to the tree again to maybe move back to the previous leaf I have to
click on each message that happened between the current and the previous leaf to expand it to be able
to expand the next message."

**Repro:** open a Session with at least a few messages past a point you can return to. Open `/tree`,
select an earlier entry, watch the transcript follow it, reopen `/tree`. The entries between the new
Leaf and the one you left are hidden behind a toggle. Tap it: exactly one more row appears, and the
next one is still behind its own toggle.

**Desired:** the branch stays collapsed as it is now — owner: "the branch should be collapsed" — but
one tap opens the whole run of it. Owner: "when I click on the first message after the leaf I
travelled back to I want to see the whole branch expand all the way to the previous leaf."

Related recorded decision, still in force: ticket 24 (an off-path branch head whose only child is off
the active path is reachable by tapping), and a strictly linear Session on the active path shows no
toggles at all.

**Done when**

- [ ] One tap on the first row past the new Leaf reveals the branch through to the leaf you came from
- [ ] The branch is still collapsed before that tap, and alternatives still hang off it collapsed and
      counted
- [ ] The first open after a move still expands only the active path
- [ ] A strictly linear Session on the active path still shows no toggles
- [ ] Whatever a row's toggle announces is what that tap actually reveals
- [ ] `npm run verify` green
