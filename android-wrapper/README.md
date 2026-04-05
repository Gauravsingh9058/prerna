# Prerna Canteen Android Wrapper

This folder contains a native Android WebView wrapper for the Prerna Canteen web app.

## What it supports

- Native Android app shell
- Runtime GPS permissions for live location tracking
- Pull to refresh
- External app handoff for WhatsApp, Maps, phone, and email links
- Back navigation inside the WebView
- Cleartext support for local Flask testing

## Open in Android Studio

1. Open the `android-wrapper` folder in Android Studio.
2. Let Gradle sync.
3. Run the `app` configuration on an emulator or Android phone.

## Set your app URL

The wrapper loads the URL from `WEB_APP_URL`.

Default:

```text
http://10.0.2.2:5000/?app_mode=android
```

That default is meant for the Android emulator while your Flask app is running on the same computer.

For a real phone, set your own hosted URL or local LAN URL in Android Studio using a Gradle property:

```text
WEB_APP_URL=https://your-domain.example/?app_mode=android
```

You can place that in:

- `android-wrapper/gradle.properties`
- or your user Gradle properties file

## Notes

- `?app_mode=android` is intentional. The website uses it to allow the Android wrapper's location flow.
- For production, use `https://`.
- If you test on a real phone against your laptop, make sure both are on the same network and your Flask server is reachable from the phone.
