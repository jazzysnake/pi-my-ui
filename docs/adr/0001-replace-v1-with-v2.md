# Replace v1 with v2 in this repo

Status: accepted

v2 is built fresh in `pi-my-ui-2`; `pi-my-ui` (v1) is frozen read-only and used only as an oracle of behaviour. We rejected healing v1 in place: the seam changes (where the store's input and pi's boundary sit) have to happen inside a 1,662-line store that about 40k lines of tests are built on, so every change would fight the tests built on top of it. Cost accepted: v1's unit tests are deleted rather than ported, and v2 must re-earn parity.
