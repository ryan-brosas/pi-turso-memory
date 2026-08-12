# Releasing `pi-turso-memory`

The package is discovered by the [pi.dev package catalog](https://pi.dev/packages) because
`package.json` includes the `pi-package` keyword. The catalog indexes the npm registry; there is no
separate pi.dev upload.

## One-time setup: npm trusted publishing

Configure npm's **Trusted Publisher** for this package before the next release:

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
`package.json`, installs cleanly, and runs `npm publish --provenance --access public`. The
`prepublishOnly` guard reruns the complete release check for any manual publish as well.

## Verify the release

```bash
npm view pi-turso-memory version dist-tags --json
pi -e npm:pi-turso-memory -p "List the available /tm commands."
```

The second command tries the published package without changing Pi settings. Catalog indexing can
lag the npm publication; check [pi.dev/packages](https://pi.dev/packages) after the index refresh.

## Recommended repository protections

Require the `CI / validate` status check on `main` and protect the `v*` tag pattern. This keeps the
only publishing path tied to reviewed, passing code.
