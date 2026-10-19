# 07: Pin eight workers and delete the sharded runner

**What to build:** The end-to-end configuration names one worker count — eight — with a comment stating the machine the number was measured on, so two machines produce comparable figures and a smaller machine's over-subscription is a known risk rather than a surprise. The sharded runner script and its npm script are deleted, and the full verification gate calls the end-to-end script directly.

The measurements behind this: 109 seconds at four workers, 67 at eight, 56 at twelve, and 66 for three shards of four. Sharding paid three start-ups and scheduled no better, so it cost more than it bought. Pinning rather than inheriting half the cores is deliberate: it fixes the number the budget in the next ticket is written against.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The Playwright configuration sets a fixed worker count of eight, with a comment naming the machine and the alternatives measured
- [ ] The sharded runner script and its npm script are deleted
- [ ] The full verification gate runs the end-to-end suite as one process
- [ ] No reference to sharding, shards or shard reconciliation remains in scripts, documentation or comments
- [ ] The full gate is green and its reported wall clock matches the worker count it used
