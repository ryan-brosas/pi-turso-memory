# Releasing `pi-turso-memory`

The package is discovered by the [pi.dev package catalog](https://pi.dev/packages) because
`package.json` includes the `pi-package` keyword. The catalog indexes the npm registry; there is no
separate pi.dev upload. Versions `0.1.0` and `0.1.1` were published through this flow, with
GitHub-OIDC provenance verified on the registry.

## npm trusted publishing (configured)

Trusted Publisher is configured on npmjs.com for this repository (`release.yml`, action `npm publish`);
no `NPM_TOKEN` exists or is needed. Steps kept for reference if it is ever re-added:

1. Open the package's **Settings** on npmjs.com, then **Trusted Publisher**.
2. Select **GitHub Actions** and enter:
   - Organization or user: `ryan-brosas`
   - Repository: `pi-turso-memory`
   - Workflow filename: `release.yml` (filename only, including `.yml`)
   - Allowed action: **npm publish**
3. Do not configure an `NPM_TOKEN`; the workflow uses GitHub OIDC and publishes npm provenance.

The `repository.url` already exactly matches this GitHub repository, as required by npm trusted
publishing. GitHub Actions are enabled for the repository.

## Release a version

Start from a clean, up-to-date `main` after CI passes:

```bash
npm run release:check
npm version patch                 # or minor / major; commits and creates vX.Y.Z
git push origin main --follow-tags
```

Pushing the version tag triggers `.github/workflows/release.yml`. It verifies that the tag matches
`package.json`, installs cleanly, and runs `npm publish --provenance --access public --tag <derived>`.
The dist-tag is derived from the version: prereleases publish under their own tag
(`0.2.0-alpha.0` → `alpha`, `...-beta.1` → `beta`, `...-rc.2` → `rc`), everything else under
`latest`. The `prepublishOnly` guard reruns the complete release check for any manual publish as well.

## Publish an alpha

```bash
npm run release:check
npm version 0.2.0-alpha.0     # pre-release; commits and creates v0.2.0-alpha.0
git push origin main --follow-tags
# verify:
npm view pi-turso-memory dist-tags --json   # expect alpha -> 0.2.0-alpha.0, latest -> 0.1.1
```

## Verify the release

```bash
npm view pi-turso-memory version dist-tags --json
pi -e npm:pi-turso-memory -p "List the available /tm commands."
```

The second command tries the published package without changing Pi settings.

> **pi.dev catalog status:** the catalog API ([/api/packages](https://pi.dev/api/packages)) currently
> returns `API routes are reserved for future features.` — the catalog backend is not live yet.
> The package is indexed on npm with the `pi-package` keyword and will appear on
> [pi.dev/packages](https://pi.dev/packages) once pi.dev enables the catalog.

## Repository protections (applied)

Two active rulesets protect release integrity (exempting the repo admin):

- `release-tags` (tag): `refs/tags/v*` cannot be force-pushed or deleted.
- `main-protection` (branch): `main` cannot be force-pushed or deleted.

Requiring the `CI / validate` status check on `main` was deliberately **not** enabled: it would block
the direct `git push --follow-tags` release flow because the version-bump commit is pushed before
CI can run. For teams, switch releases to PRs first, then add the status check.
