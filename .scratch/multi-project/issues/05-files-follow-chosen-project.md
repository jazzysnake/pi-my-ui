# 05: Files follow the chosen Project

**What to build:** Directory listing, preview and download name the chosen Project and are rooted there. The existing containment rule receives exactly one root per request: lexical rejection of absolute paths and `..`, `realpath` validation and the escape check all stay as they are. A symlink inside Project A that resolves into Project B is refused because it leaves A's root. A file request naming a Project outside the registry is refused. The folder control is disabled while no Project is chosen, and the panel follows the chosen Project rather than the open Session. The temporary multi-Project file guard from 04 is removed.

**Blocked by:** 04 (the browser has a chosen Project to scope files to).

**Status:** ready-for-agent

- [ ] Directory listing, preview and download carry the chosen Project
- [ ] The containment check is rooted at that Project for every file request
- [ ] A symlink inside Project A pointing into Project B is refused
- [ ] A request naming an unserved Project is refused
- [ ] The folder control is disabled before a Project is chosen
- [ ] The file panel follows the chosen Project, not the open Session
- [ ] No file request can read another served Project's files
- [ ] The temporary multi-Project file guard from 04 is gone
- [ ] Path-safety specs include the cross-Project symlink escape
- [ ] End-to-end specs show the file panel changing with the chosen Project
