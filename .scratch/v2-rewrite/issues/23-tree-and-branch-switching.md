# 23: Tree and branch switching

**What to build:** `/tree` and the branch control open the same modal. Only the active path is expanded with alternative branches collapsed and counted; search filters and expands to the result. Selecting an entry moves the Leaf through the bridge, switches the transcript, and keeps the old branch; selecting one of my own messages returns its text to the composer. A refused or unconfirmed move is shown as such, never as success. A 100-deep tree is navigable.

**Blocked by:** 22 Bridge required, 18 Slash palette and session commands, 03 Fixture builder

**Status:** ready-for-agent

- [ ] E2E: both entry points open one modal
- [ ] Alternatives collapsed by default with counts
- [ ] Search expands and highlights a result
- [ ] Leaf move confirmed by the server before the UI shows it; refusal shown honestly
- [ ] 100-deep seed navigable
