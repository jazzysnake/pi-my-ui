# The server's runtime only. The repository is bind-mounted at its host path, so nothing is copied
# in: `npm run build` on the host stays the single build step and the image never goes stale.
FROM node:26-bookworm-slim

# pi's tools shell out to these: bash for the bash tool, ripgrep for grep, git for anything a Session
# runs against a repository. The base image already carries bash; ripgrep is the one it lacks.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates git ripgrep \
	&& rm -rf /var/lib/apt/lists/*
