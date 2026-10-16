# 30: Files

**What to build:** The Files button opens a read-only tree rooted at the Session's working directory. Directories expand lazily; tapping a file downloads it; text-like files can be previewed inline with truncation stated. Reads outside the root and path traversal are rejected.

**Blocked by:** 05 Client shell: connect and render the transcript

**Status:** ready-for-agent

- [ ] E2E: browse, expand, download and preview
- [ ] Truncated previews say so
- [ ] Traversal and out-of-root reads rejected
- [ ] No editing capability exists
