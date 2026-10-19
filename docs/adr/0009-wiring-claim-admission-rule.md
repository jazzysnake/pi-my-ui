# A browser test survives only on a wiring claim

Status: accepted

A browser test survives only if it carries at least one **wiring claim** — a Claim whose truth needs a real Pi child, a real socket, a real browser or a real layout engine behind it — and no store or component test already carries that same Claim. A Claim is one sentence the test fails on if it turns false. A Journey is a path a user takes across a seam, named by its outcome; it is one reason a test exists, not the only one. Two tests may cover one Journey when their Claims differ, as reloading into a Project and switching to it in-app do. The rule applies to the whole existing browser suite, not to new tests only. Speed is not a deletion reason: a slow test that carries a wiring claim no other height can carry stays.

Applying the rule starts by naming the Claim in the test, then checking whether a store or component test already carries it. A rendering rule, a dismissal, a label or a depth cap belongs at store height even when the browser currently proves it. The same check applies to a candidate deletion: the browser test leaves only after the store or component test that carries its Claim is present and green.

A deleted browser test is not a coverage loss when a store or component test carries its Claim: the Claim stays tested at its natural height. The runner changes, not the promise. What the browser suite keeps is the set of Claims that only the real stack can hold — a real child, a real socket, a real layout engine — and those are the expensive tests worth paying for.

The alternatives were rejected. Keeping every browser test preserves duplicate Claims, pays real-Pi cost for each one, and lets the suite regrow by default. Deleting all browser tests or moving everything to jsdom loses the real stack, the socket and the layout Claims. A third height or a fake WebSocket is forbidden by ADR 0005; a mock one level down produces cases a real server will not. Coverage thresholds or mutation testing measure execution, not Claims, and cannot decide which test is the right home for a promise.

Consequence: adding a browser test is a visible cost, and its Claim must be stated. The suite cannot grow without someone answering why the Claim needs a real browser rather than the store or component height.
