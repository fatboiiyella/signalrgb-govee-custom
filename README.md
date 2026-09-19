# Govee Custom (SignalRGB Addon)

A self-contained SignalRGB **network addon** that auto-discovers Govee LAN
devices and drives them in real time over the DreamView / Razer streaming
protocol.

Built as an alternative to the stock "Govee Direct Connect" plugin. The key
difference: the render side is **send-only and always streaming** — it never
waits for a device status reply before sending color frames, and it re-arms
each device (turn-on + razer-on) on a heartbeat. That means after a SignalRGB
update or a power blip, the lights come back on their own instead of sitting
dark until you disable/re-enable them.

## Install

1. Create a **public** GitHub repo (SignalRGB clones it anonymously; private
   repos won't work) containing these three files at the root:
   - `GoveeCustom.js`
   - `GoveeCustom.qml`
   - `README.md`
2. In SignalRGB: **Devices → Addons → Add** (the field that asks for a GitHub
   repo) → paste your repo URL → allow the install.
3. **Disable or remove the stock Govee addon.** Both bind UDP port 4002 and
   will conflict.
4. Fully quit SignalRGB from the tray icon and relaunch (hot-reload doesn't
   reliably start a discovery service; a full restart does).

Devices appear under the **Devices** tab within a few seconds. Cached devices
come back instantly on later launches.

## Configure

Each device is auto-assigned a protocol and a starting zone count by its SKU
(see `SKU_PROFILES` at the top of `GoveeCustom.js`). The zone counts are
starting guesses — set each to the segment count your Govee Home app shows for
that device, then save and restart.

Confirmed device profiles included: H610A, H6062, H6061, H6143, H6076(A), H61C3.

## Troubleshooting

- **Nothing found:** confirm LAN Control is ON for each device in the Govee
  Home app, and that you refreshed its light segments there at least once.
- **Flaky discovery / VLAN:** if multicast doesn't reach your devices, reserve
  each device's IP in your router and add them to the `MANUAL_IPS` array at the
  top of `GoveeCustom.js`. They'll be unicast-scanned every poll.
- **A device renders wrong:** set its `protocol` to `3` (solid color) in
  `SKU_PROFILES` — it will sync as a single zone.
- **Logs:** open `signalrgb://view/logs` and look for `Discovered ...` and
  `Binding UDP 4002`.

## Ports used

- 4001 — discovery scan (sent to `239.255.255.250` multicast)
- 4002 — device replies (this addon binds it)
- 4003 — color / power / razer commands (sent to each device)
