# 16: Long transcripts

**What to build:** A transcript of 500+ entries loads quickly and scrolls smoothly with a bounded number of mounted rows. Streamed Deltas update text without remounting rows, and scroll position survives a resync.

**Blocked by:** 14 Transcript: markdown and notifications, 15 Transcript: tool cards and collapsed reasoning, 03 Fixture builder

**Status:** ready-for-agent

- [ ] E2E with the generated 500+ entry seed meets a stated load budget
- [ ] Mounted rows stay bounded while scrolling
- [ ] A streaming Delta does not remount existing rows
- [ ] Scroll position is preserved across a resync
