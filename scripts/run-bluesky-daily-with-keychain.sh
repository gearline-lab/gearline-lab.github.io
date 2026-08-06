#!/bin/zsh
set -euo pipefail

# The password is read by macOS Keychain only for this process and is never
# written to a file, terminal output, Git, or a shell history entry.
export BSKY_IDENTIFIER="gearline-lab.bsky.social"
export BSKY_APP_PASSWORD="$(security find-generic-password -a "$BSKY_IDENTIFIER" -s "gearline-lab-bluesky-app-password" -w)"
export BSKY_SERVICE="https://bsky.social"

exec node scripts/bluesky-daily.mjs "$@"
