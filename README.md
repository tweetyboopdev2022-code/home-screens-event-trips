# Event Trips — a Home Screens plugin

Shows upcoming calendar events that have a location, with:

- the forecast at the destination at that time (Open-Meteo, no key needed)
- drive time from home with live traffic, and a "leave by" time (TomTom, free key)

## Install

Home Screens editor → **Plugins** → **Install from URL…** and paste:

```
https://raw.githubusercontent.com/tweetyboopdev2022-code/home-screens-event-trips/releases/download/v1.2.0/event-trips-1.2.0.tgz
```

Then add your TomTom key under the plugin's secrets (`tomtom_key`). Get one free at https://developer.tomtom.com.

## Settings

| Setting | What it does |
|---|---|
| Whose calendar | A person from Settings → Calendar → People (default: Vince) |
| Days ahead / Most trips | How far ahead and how many events |
| Extra minutes before leaving | Buffer added to the leave-by time |
| Start from | Optional address instead of home |

Events whose location is a video link (Zoom, Meet, Teams) are skipped.
