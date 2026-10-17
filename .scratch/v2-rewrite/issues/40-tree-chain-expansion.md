# 40: Walking back along an abandoned branch takes one tap per message

**Category:** bug

**Blocked by:** None (can start immediately)

**Status:** resolved

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

- [x] One tap on the first row past the new Leaf reveals the branch through to the leaf you came from
- [x] The branch is still collapsed before that tap, and alternatives still hang off it collapsed and
      counted
- [x] The first open after a move still expands only the active path
- [x] A strictly linear Session on the active path still shows no toggles
- [x] Whatever a row's toggle announces is what that tap actually reveals
- [x] `npm run verify` green

## Comments

Resolved on `v2-rewrite`. A tap now opens a **run**: the row itself plus every **continuation** below
it — nodes with exactly one child — stopping at the first fork or at the end of the branch. So the
first row past a new Leaf opens the whole branch the Session came from in one tap, while a fork
inside that run is revealed closed and counted, and stays one tap of its own. Linear Sessions on the
active path are untouched: `expandable` still covers branch points and off-path one-child nodes only,
so no new control appeared anywhere. `revealIds` in `lib/tree/rows.ts` is the one definition of the
run; `toggleExpanded` takes the node and opens or closes that same set, and closing removes the whole
run so a later tap higher up cannot resurrect rows closed inside it.

The announcement is derived, not asserted: `TreeRow.childCount` is gone, replaced by
`TreeRow.reveals`, and the modal's label and count badge both read it. `flattenTree` measures two
numbers per node in one post-order pass — the rows its subtree shows now (`shown`) and the rows it
would show with its run opened (`opened`) — and `reveals` is `opened - shown` from the same walk that
emits the rows. That is why the box "whatever a row's toggle announces is what that tap actually
reveals" holds for free rather than by agreement: there is one net, not a count function beside a
render function. It also corrects a mismatch this ticket did not set out to fix — a collapsed row on
the active path used to promise `childCount` replies while revealing its whole on-path continuation,
and now says what the tap will add.

Red first, at the row-model seam in `packages/client/test/message-tree.test.ts`, over a fixture of the
owner's position (active path through the edit, the abandoned run hanging off the new Leaf, no forks
in it). `expect(announced).toBe(3)` read the old `childCount` of 1; after the tap `expect(row(target,
"a2")).not.toBeNull()` (ticket 24's test, whose one-step-at-a-time expectation this ticket reverses)
failed with `null`, which is the symptom — one row appeared where the run held three. A second test
puts a fork inside the run and showed the row set after one tap missing `f1`'s branch head, so the
stop-at-a-fork rule is pinned rather than incidental. Both assert `rows revealed === announced`.

Only a real tap can prove the move-and-walk-back sequence, so `packages/e2e/test/message-tree.spec.ts`
gained "one tap on the row past a new Leaf reveals the branch behind it in full": it moves the Leaf by
selecting an earlier message, reopens the tree (branch behind it collapsed, the old Leaf off screen),
then taps once and asserts the old Leaf appears and the row delta equals the announced number. The
abandoned-branch test now expects the whole run from that one tap (and still counts only the head
before it), and the root-collapse test compares the stated count against the rows the tap gives back
instead of a literal, which is what the old count would now get wrong.

`docs/guide.md`'s `/tree` entry says a collapsed branch states how many messages a tap reveals and
that one tap opens the run down to the next fork or the Leaf the Session came from.

`npm run verify` is green: typecheck, lint/format, 136 client tests (+2), build, and 119 end-to-end
tests across 2 shards (+1) in ~48 s.
