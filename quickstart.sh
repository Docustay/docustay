#!/bin/sh
# Runs the real quickstart in ./docustay (the self-host package lives in that folder).
set -eu
cd "$(dirname "$0")/docustay"
exec sh ./quickstart.sh "$@"
