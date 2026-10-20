#!/bin/sh
# Xcode Cloud: runs on Apple's Macs after the repo is cloned and before Xcode resolves the project.
# Installs the web-side dependencies the Capacitor iPhone app needs, generates Pods, and sets a
# build number that is always higher than any earlier upload (GitHub builds used numbers under 1000).
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"   # the folder holding package.json for this app
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1
if ! command -v node >/dev/null 2>&1; then
  brew install node@20
  brew link --overwrite --force node@20
fi
if ! command -v pod >/dev/null 2>&1; then
  brew install cocoapods
fi
cd "$ROOT"
npm ci
npx cap sync ios
if [ -n "${CI_BUILD_NUMBER:-}" ]; then
  N=$((1000 + CI_BUILD_NUMBER))
  sed -i '' "s/CURRENT_PROJECT_VERSION = [0-9]*;/CURRENT_PROJECT_VERSION = $N;/g" ios/App/App.xcodeproj/project.pbxproj
  echo "Build number set to $N"
fi
