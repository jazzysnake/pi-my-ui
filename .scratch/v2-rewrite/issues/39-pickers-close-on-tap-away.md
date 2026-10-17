# 39: An open model or effort list does not close when you tap away

**Category:** bug

**Blocked by:** 38

**Status:** ready-for-agent

**Symptom:** Tapping the model control opens a list of models. Tapping anywhere outside that list
leaves it open, so the only way to dismiss it is to tap its own control again. Owner: "when I click on
the model selector the list appears, but when I click away without selecting one, it does not close."
The same applies to the effort list.

**Repro:** open a Session, tap the model control, then tap the transcript (or the input, or the
header) without choosing a row. The list is still up.

**Desired:** a tap anywhere outside an open list dismisses it and applies no change. Choosing a row
still applies that choice and closes the list, once.

**Done when**

- [ ] A tap outside an open model list dismisses it and the model is unchanged
- [ ] A tap outside an open effort list dismisses it and the effort is unchanged
- [ ] Choosing a row still applies it and closes the list, with no flicker and no second toggle
- [ ] Opening one list while the other is open leaves only the newly opened one
- [ ] `npm run verify` green
