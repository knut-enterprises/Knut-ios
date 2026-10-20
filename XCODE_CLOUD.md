# iPhone builds on Xcode Cloud (free: 25 compute hours a month with the Apple Developer Program)

Two apps live in this repo, each with its own Xcode project and `ci_scripts/ci_post_clone.sh`:

| App | Xcode project | Bundle ID |
|---|---|---|
| Knut | `ios/App/App.xcworkspace` | `au.com.knut.app` |
| VIBA | `viba/ios/App/App.xcworkspace` | `guru.viba.app` |

One workflow per app in App Store Connect → the app → Xcode Cloud:
- Start condition: **Manual** only (keeps the free hours for builds that matter).
- Environment: latest Xcode, latest macOS.
- Action: **Archive – iOS**, scheme `App`, distribution **App Store Connect**.
- Post-action: **TestFlight (Internal Testing)** so the build appears in TestFlight on its own.

Build numbers: `ci_post_clone.sh` sets the build number to `1000 + CI_BUILD_NUMBER`, always above earlier uploads.
The GitHub "Knut iPhone app" workflow is manual-only now; it burns paid Mac minutes.
