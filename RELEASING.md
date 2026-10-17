# Releasing Stepcast

Releases are built by GitHub Actions when you push a version tag. Users get an **Update available** banner the
next time they open Stepcast. It reads `latest.json` from the newest GitHub Release, and the update is
verified with the signing key below.

## One-time setup

1. Create the public repo **rene-poulsen/stepcast** on GitHub and push `main`.
2. Add one repository secret (**Settings → Secrets and variables → Actions → New repository secret**):

   | Name | Value |
   | --- | --- |
   | `TAURI_SIGNING_PRIVATE_KEY` | the full contents of `~/.tauri/stepcast.key` |

   The key has no password, so `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` isn't needed. (If you ever make a new key
   with a password, add that as a second secret with this name.)

3. Back up `~/.tauri/stepcast.key` somewhere safe, like your password manager. **If you lose it, installed copies
   can never update again.** The matching public key is already in `app/src-tauri/tauri.conf.json`.

## Every release

1. Write the release notes in `docs/releases/vX.Y.Z.md`, for example `docs/releases/v0.2.0.md`. Write them
   for users: they appear in the app's update banner and on the GitHub Release. Commit them.
2. Run:

   ```bash
   npm run release -- 0.2.0
   ```

   This bumps the version in every file (app, extension, Cargo), commits, tags `v0.2.0` and pushes.
3. Watch **Actions** on GitHub (about 15 minutes). The workflow:
   - creates a draft release with your notes
   - builds the Windows installer and the macOS universal `.dmg`, both signed for the updater
   - attaches `stepcast-extension-0.2.0.zip`, then publishes the release

That's it. Open the old version of Stepcast and you'll see **Update available · v0.2.0**.

## Versions

Use [semantic versioning](https://semver.org): `0.2.1` for fixes, `0.3.0` for new features, `1.0.0` when you
call it stable. The extension always has the same version as the app. If the extension changed, the app shows
users a "reload the extension" hint after updating.

## Optional, later

- **Chrome Web Store / Edge Add-ons:** publishing the extension there ($5 one-time for Chrome, free for Edge)
  lets users install it with one click and update it automatically, instead of using Developer mode.
- **Code signing:** an Apple Developer ID ($99/year) removes the macOS "can't be opened" step. A Windows signing
  certificate removes the SmartScreen warning. Neither is needed for the app or its updates to work.
