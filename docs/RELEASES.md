# Releases & rollback

Version is defined in **`package.json`** (`version`). Git tags use the same number with a `v` prefix (e.g. `v0.0.8`). Docker images are tagged as `lforlinux/firefly:v0.0.8` and `lforlinux/firefly:latest`.

- **Changelog (what changed):** [CHANGELOG.md](../CHANGELOG.md)  
- **This file:** version reference and how to rollback.

---

## Version reference

| Version | Git tag   | Notes |
|--------|-----------|--------|
| 0.0.8  | `v0.0.8`  | Current (see [CHANGELOG.md](../CHANGELOG.md)) |

After each release, add a row here and ensure the tag exists: `git tag v0.0.8 && git push origin v0.0.8`.

---

## Rollback

### 1. Local / source (git)

To run an older version from source:

```bash
# List existing tags
git tag -l

# Checkout the version you want (creates detached HEAD)
git checkout v0.0.8

# Or create a branch from that tag to work on it
git checkout -b hotfix-0.0.8 v0.0.8
```

Then install and run as usual:

```bash
npm install
npm run dev
# and optionally: npm run server
```

To go back to the latest development version:

```bash
git checkout main
```

---

### 2. Docker

To run a specific image version (e.g. after a bad deploy):

```bash
# Stop current container (if running)
docker stop firefly
docker rm firefly

# Run a specific version (replace with the version you need)
docker pull lforlinux/firefly:v0.0.8
docker run -d -p 8080:80 --name firefly --restart unless-stopped lforlinux/firefly:v0.0.8
```

To roll back to the previous release, use that release’s tag (e.g. `v0.0.7`) instead of `v0.0.8`. Available tags are on [Docker Hub](https://hub.docker.com/r/lforlinux/firefly/tags) or via `docker pull lforlinux/firefly:v0.0.7` (will fail if the tag doesn’t exist).

---

### 3. Static hosting (Vercel, Netlify, S3, etc.)

- **If you deploy from Git:** point the branch or tag to the previous release (e.g. `v0.0.7`) or redeploy the last good commit.
- **If you deploy from `dist/`:** keep a copy of the last good `dist/` (or rebuild from the tag: `git checkout v0.0.8 && npm ci && npm run build`) and re-upload that.

---

## Releasing a new version

1. Bump `version` in **`package.json`** (e.g. `0.0.8` → `0.0.9`).
2. Update **CHANGELOG.md**: move items from `[Unreleased]` into `[0.0.9]` and add the release date.
3. Update **docs/RELEASES.md**: add the new version to the version reference table.
4. Commit and push, then create and push the tag:
   ```bash
   git add package.json CHANGELOG.md docs/RELEASES.md
   git commit -m "Release v0.0.9"
   git push
   git tag v0.0.9
   git push origin v0.0.9
   ```
5. For Docker: run `./scripts/docker-build-push.sh push` so the new image tag is available.
