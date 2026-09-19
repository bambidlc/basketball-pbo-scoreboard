# Live Stats performance verification — September 19, 2026

The schedule no longer downloads full-size club logos, unused team images, or
player avatars as part of JSON data. Club logos use lazy 96 × 96 thumbnails with
a five-minute browser cache. Club metadata is reused for five minutes per client.

Read-only measurements against the production API, using the changed client:

| Request set | Before removing full-size club logos | After |
| --- | ---: | ---: |
| Season schedule (265 games, four API requests) | 11,147,525 bytes | 156,274 bytes |
| Observed schedule duration on this connection | 2,464 ms | 1,158 ms |

The schedule JSON reduction is 98.6%. These are payload and individual-run
measurements, not a promise of latency on every connection. Thumbnail downloads
are separate and occur as visible logos need them. The warm roster measurements
were approximately 1.5–1.6 seconds; actual Odoo latency varies.

The production server now compresses text assets and keeps compressed copies in
memory. The measured main JavaScript response shrank from 565,518 to 161,333 bytes
with gzip. Hashed bundles retain immutable caching; API data remains uncached.

The API client allows two independent reads, coalesces identical reads, and keeps
mutations ordered in their own lane. It no longer imposes a default 750 ms pause
on every call. Reads time out after 12 seconds, writes after 20 seconds. Rate
limits still apply shared backoff. A lost mutation response is not blindly
retried by the transport; the durable outbox verifies/reconciles saved identities.

Roster saves skip unchanged players, look up attendance once per game, and write
only changed attendance. Save returns to scoring after the snapshot enters the
device outbox, while server verification continues. Removing an existing player
marks them absent for this game and permits restoration without deleting their
permanent record or historical statistics.

Validation completed:

- Build and connection, player-sync, game-resolution, scoring, and schedule suites.
- Delayed synthetic API (300 ms per request): edit, remove, restore, save, clock,
  and event-first scoring; no changes to real Odoo game/player records.
- Eight viewports: 768×1024, 820×1180, 1024×600, 1024×768, 1180×820,
  1366×768, 1440×900, and 1920×1080. Clock, ten starters, and four shot buttons
  visible without page overflow. Pro-mode shot clock also checked.
- Plain/gzip/disabled-gzip responses and immutable asset caching.

Hosting still matters: `render.yaml` specifies a Free instance. If the deployed
service uses that plan, Render shuts it down after 15 idle minutes and waking it
can take about one minute. App optimizations cannot remove that hosting delay.
No paid plan change was made. See https://render.com/docs/free#spinning-down-on-idle.
