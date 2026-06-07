# Releasing

Maintainer checklist for cutting a new release of the extension. Releases are
fully automated: pushing a version tag triggers `.github/workflows/release.yml`
which builds and uploads the Chrome `.zip` and Firefox `.xpi` artifacts to a
GitHub Release.

## Prerequisites

- Push access to `main` and the ability to create tags on this repo.
- The new version number you intend to ship (e.g. `0.2.2`).

## Steps

1. **Bump the version in BOTH manifests.** They must match — the workflow
   fails the release if they disagree with each other or with the git tag.
   - `manifest.json` → `"version": "0.2.2"`
   - `manifest.firefox.json` → `"version": "0.2.2"`

2. **Commit on `main`:**

   ```sh
   git commit -am "Release v0.2.2"
   git push origin main
   ```

3. **Tag and push:**

   ```sh
   git tag v0.2.2
   git push origin v0.2.2
   ```

   Tag format must be `v<major>.<minor>.<patch>` (e.g. `v0.2.2`). The leading
   `v` is required; the workflow strips it before comparing to the manifest
   versions.

4. **Wait ~30 seconds.** The Actions workflow runs at
   <https://github.com/QinClaes/corporate-benefits-scanner-extension/actions>.
   On success it creates a release at
   <https://github.com/QinClaes/corporate-benefits-scanner-extension/releases/tag/v0.2.2>
   with both artifacts attached:
   - `benefits-notifier-chrome.zip`
   - `benefits-notifier-firefox.xpi`

5. **(Optional) Edit the auto-generated release notes** via the GitHub UI.
   The `/releases/latest/download/<filename>` URLs in `README.md` point at
   whatever the latest release is, so they'll pick up the new artifacts
   automatically.

## Troubleshooting

### Workflow failed with "Version mismatch"

The git tag, `manifest.json` `version`, and `manifest.firefox.json` `version`
must all be identical (modulo the leading `v` on the tag). Fix whichever is
wrong, commit, delete the bad tag, re-tag:

```sh
# fix the version in the manifest(s), commit, then:
git tag -d v0.2.2
git push origin :refs/tags/v0.2.2
git tag v0.2.2
git push origin v0.2.2
```

### Need to retract a bad release

Delete the GitHub release (Releases page → the release → Delete), then delete
the tag locally and remotely:

```sh
git tag -d v0.2.2
git push origin :refs/tags/v0.2.2
```

Fix whatever was wrong, then re-tag with the same version (or bump to a new
patch version, your call).

## What the workflow actually does

No build step. The workflow only:

1. Validates that the git tag and both manifest `version` fields match.
2. Zips the repo (excluding dev cruft like `.git/`, `n8n/`, `AGENTS.md`,
   `README.md`, `RELEASING.md`, `.github/`) into `benefits-notifier-chrome.zip`,
   excluding `manifest.firefox.json`.
3. Stages the same set of files in a temp directory, but excludes
   `manifest.json` and renames `manifest.firefox.json` → `manifest.json`,
   then zips that as `benefits-notifier-firefox.xpi`.
4. Creates a GitHub Release with both artifacts attached and auto-generated
   release notes.

Source files inside the artifacts are byte-identical to the repo. No
transpilation or bundling.
