# 05: Files follow the chosen Project

**What to build:** Directory listing, preview and download name the chosen Project and are rooted there. The existing containment rule receives exactly one root per request: lexical rejection of absolute paths and `..`, `realpath` validation and the escape check all stay as they are. A symlink inside Project A that resolves into Project B is refused because it leaves A's root. A file request naming a Project outside the registry is refused. The folder control is disabled while no Project is chosen, and the panel follows the chosen Project rather than the open Session. The temporary multi-Project file guard from 04 is removed.

**Blocked by:** 04 (the browser has a chosen Project to scope files to).

**Status:** resolved

- [x] Directory listing, preview and download carry the chosen Project
- [x] The containment check is rooted at that Project for every file request
- [x] A symlink inside Project A pointing into Project B is refused
- [x] A request naming an unserved Project is refused
- [x] The folder control is disabled before a Project is chosen
- [x] The file panel follows the chosen Project, not the open Session
- [x] No file request can read another served Project's files
- [x] The temporary multi-Project file guard from 04 is gone
- [x] Path-safety specs include the cross-Project symlink escape
- [x] End-to-end specs show the file panel changing with the chosen Project

## Comments

Merged as `f420d8b` (`git merge --no-ff` of `pi-agent-e5137889-4f6d-466`, commit `38b363b Root
every file request at the chosen Project`) with no conflicts; the branch was already based on the
integration tip `b09f330`.

What landed: `FILE_PROJECT_PARAM` joins `FILE_PATH_PARAM` in `protocol/src/files.ts`, and
`ListDirectoryMessage` / `PreviewFileMessage` and `DirectoryListingMessage` / `FilePreviewMessage`
all carry `project`, so a request names its root and an answer echoes the root it described.
`requireProject` guards both requests in `validate.ts`, which makes a bare `{ type: "listDirectory",
path }` fail as `MalformedPayload` rather than resolve against anything. `server.ts` answers both
requests through `registry.require(message.project)` and stamps the served path back on the reply,
and `handleFileDownload` now takes the registry: a missing `project` is a 400 naming the parameter,
an unserved one is a bodyless 403 decided before the filesystem is touched, and `openFileTarget`
receives exactly that Project as its single root — `path-safety.ts` is unchanged, so the lexical
check, the `realpath` and one escape check still run once per request, and a link inside A that
resolves into B is refused as leaving A. `ProjectRegistry.primary` and `primaryProject` are deleted
outright, so nothing falls back to the first served Project. On the client, `files.svelte.ts` gained
`follow(project)`, which drops every listing, failure and preview when the chosen Project changes
and discards an answer whose `project` is not the current one; `ClientStore` calls it on receive and
on both clears. `FileTreePanel` takes `project` — the chosen one, not `transcript.cwd` — names it as
`file-tree-root` and passes it on every list, preview and download, `fileDownloadUrl` sets both query
parameters, and `Shell.svelte` replaced 04's `filesAllowed` one-Project guard with `filesEnabled`
(disabled only when no Project is chosen) plus a `filesProject` that closes the panel on a Project
change so it never draws rows under another root. Cases in `packages/client/test/files.test.ts` cover
the another-Project drop, the re-root on switch and the two-parameter URL; `packages/e2e/test/files.spec.ts`
grew a two-Project harness whose first tree holds `only-in-first.txt` and whose symlinks point into
the second, and asserts the panel and its root changing with the choice, `README.md` previewing
differently under each root, the folder control disabled until a Project is chosen, both Projects
listing and previewing their own files over one connection, the cross-Project symlink refused for
listing, preview and download, an unserved Project refused over the socket and as a bodyless 403 on
the download route, a missing `project` a 400, and the bare-id request malformed. The one-Project
cases were migrated to the new `project` field and keep their traversal, out-of-root and
no-write assertions.

The full gate passed on the integration branch: `npm run verify:full` — [verify] PASSED, all 5 steps
green, `166/166` e2e tests accounted for across three shards in 57,467 ms. No post-merge fix was
needed and no test was weakened, skipped or deleted.
