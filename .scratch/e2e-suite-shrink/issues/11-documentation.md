# 11: Documentation for the two heights and the admission rule

**What to build:** The vocabulary and the decisions that made this effort possible, written down so the suite cannot grow back.

The glossary gains Journey, Claim, Wiring claim, Browser suite and Rig, defined as they were used to make the cuts. The two-heights decision is amended to say that the heights are about what is faked, not about which runner runs them — its current claim that the first height is "through a browser" becomes false the moment the backend specs move. A new decision record states the admission rule: a browser test survives only if it carries a wiring claim no store or component test carries, and two tests may cover one journey when their claims differ. That record is what answers the next "why is there no end-to-end test for this?".

**Blocked by:** 10 — the amended decision is only true once the backend specs run under their own runner.

**Status:** ready-for-agent

- [ ] The glossary defines Journey, Claim, Wiring claim, Browser suite and Rig, in glossary form, with no implementation detail
- [ ] The existing two-heights decision is amended to say the runner is a tool and the fakes are the rule
- [ ] A new decision record states the wiring-claim admission rule and names the alternatives it rejected
- [ ] The decision record explains why a deleted browser test is not a coverage loss when a store test carries its claim
- [ ] Every document names the browser half and the backend half by the vocabulary the glossary defines
