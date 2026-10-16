# 10: Sessions: list and switch

**What to build:** A collapsed-by-default drawer lists this project's Sessions with name (or first line of the first message) and time since last active. Tapping a row switches the view. Pi children start lazily on first open.

**Blocked by:** 06 Send a message and stream the reply, 03 Fixture builder

**Status:** ready-for-agent

- [ ] E2E: drawer lists seeded Sessions with names and recency
- [ ] Switching changes the view and loads that Session's transcript
- [ ] Child is started lazily; one Pi child per Session file
- [ ] No rename or delete exists in the UI
