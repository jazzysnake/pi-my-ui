# 31: Phone fit and design

**What to build:** Every interactive control meets a 44x44 minimum in every state; toasts and overlays never swallow taps beneath them; drawers contain their scroll; no unintended horizontal scroll; reduced motion respected; visual design follows the v1 UI direction (drafts in docs/drafts/v1/design).

**Blocked by:** 16 Long transcripts, 18 Slash palette and session commands, 23 Tree and branch switching, 27 Subagents: live transcript, 30 Files

**Status:** resolved

- [ ] E2E asserts 44x44 targets across the app's states
- [ ] Overlay does not block taps beneath it
- [ ] No horizontal page scroll in the listed wide-content cases
- [ ] Reduced motion honoured

## Comments

Resolved on `v2-rewrite`. `npm run verify` is green: typecheck, lint/format, store and component tests, build, and 112 end-to-end tests across 2 shards in ~47 s. The spec and the branch commits are the detail; tickets 34 and 35 remain with the owner.
