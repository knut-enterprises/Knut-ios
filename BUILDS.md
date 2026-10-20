# How the iPhone builds run (and why they cost nothing)

This repo is **public**, and GitHub does not bill Actions minutes for public repos, including Mac runners.
So the "Knut iPhone app" workflow (`.github/workflows/ios-app.yml`) is free here. Run it by hand:
Actions → Knut iPhone app → Run workflow → pick the app (`knut` or `viba`).

- It is manual-only: nothing starts it on push.
- If `macos-latest` (Apple silicon) has no free machine and the job fails with "not acquired by Runner",
  run it again with the **runner** input set to `macos-15-intel`.
- Do **not** build iPhone apps from the private `knut` or `viba` repos: Mac minutes there are billed at 10x.
  The iPhone workflow in the `knut` repo is switched off for that reason.

## Xcode Cloud (optional, not set up)
`ios/App/ci_scripts/ci_post_clone.sh` and `viba/ios/App/ci_scripts/ci_post_clone.sh` are ready for Xcode Cloud,
but Apple only lets you create an Xcode Cloud product from Xcode on a Mac, so it has not been connected.
Swappys and Virelle Studios are Expo apps: their GitHub jobs run on Linux and build on Expo's cloud Macs.

## Automatic builds
`auto-build.yml` starts a build whenever iPhone app files change on `main` (`ios/`, `viba/`, `www/`, config). Changes to the websites themselves need no build because the apps load the live sites.

## Automatic builds
`auto-build.yml` starts a build whenever iPhone app files change on `main` (`ios/`, `viba/`, `www/`, config). Changes to the websites themselves need no build because the apps load the live sites.
