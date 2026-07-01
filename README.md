# nosleep

Tell the machine to stay awake.

A GNOME Quick Settings toggle and a CLI that block suspend and lid-switch
sleep, plus a second toggle that keeps the screen on. Each is backed by a
transient systemd user unit that *is* the state, so the controls can never
desync from it — and because the CLI and sleep toggle share one unit, they
can never disagree about whether the machine may sleep.

<p align="center">
  <img src="docs/quick-settings.png" width="380"
       alt="The Stay Awake toggle active in GNOME Quick Settings, with the indicator in the top bar">
</p>

## Why another Caffeine?

State. Most keep-awake tools hold the inhibitor inside their own process or
track it in settings, and the two drift apart: a stale toggle, a lost
inhibitor after a shell restart, a lock that outlives the session.

nosleep keeps no state at all. Turning it on creates a transient systemd
user unit (`nosleep.service`) that holds a `systemd-inhibit` block lock on
sleep and lid-close. The unit **is** the state:

- The toggles and indicator mirror their units over D-Bus, so they cannot
  desync, even across `gnome-shell` restarts.
- The unit dies on logout/reboot, so normal sleep behavior always comes
  back on its own.
- Anything can inspect or stop it: `systemctl --user status nosleep`.
- The CLI and the extension are interchangeable: either can stop what the
  other started, and the toggle lights up when a script enables it.

**Scope.** *Stay Awake* blocks *sleep* (suspend and lid-close), not *idle* —
it keeps the machine running through a download or a long job, but the screen
may still blank and lock. *Keep Screen On* also blocks GNOME idle, so the
screen never blanks or locks: a presentation mode. Use either, or both —
block sleep but let the screen lock for security, or keep everything awake.
Both work from the Quick Settings toggles and the CLI (`nosleep` and
`nosleep screen`).

## CLI

```
nosleep                # toggle stay-awake (blocks suspend + lid)
nosleep 2h             # stay awake for 2 hours (also: 90m, 45s, 1d)
nosleep on             # stay awake until turned off
nosleep off
nosleep status

nosleep screen         # toggle keep-screen-on (blocks GNOME idle)
nosleep screen on      # keep the screen on until turned off
nosleep screen 45m     # keep the screen on for 45 minutes
nosleep screen off
nosleep screen status
```

Requires `bash` and systemd; `nosleep screen` also needs
`gnome-session-inhibit`, which any GNOME session already provides. Install by
dropping `bin/nosleep` on your `PATH`, or on Nix:

```
nix run github:ilyasturki/nosleep
```

## GNOME extension

Two Quick Settings toggles — "Stay Awake" (blocks suspend and lid-switch
sleep) and "Keep Screen On" (blocks GNOME idle so the screen never blanks) —
with a top-bar indicator while either is active. Both stay on the lock
screen, so you can confirm or flip stay-awake without unlocking. Supports
GNOME Shell 45 to 50.

- From [extensions.gnome.org](https://extensions.gnome.org/extension/10230/nosleep/)
- Manual: `make install`, then re-log and enable with
  `gnome-extensions enable nosleep@ilyasturki.com`

### NixOS / home-manager

```nix
inputs.nosleep.url = "github:ilyasturki/nosleep";
```

```nix
home.packages = [
  inputs.nosleep.packages.${system}.default    # CLI
  inputs.nosleep.packages.${system}.extension  # GNOME extension
];
```

## Credits

The coffee-cup icon is from the [Caffeine GNOME Shell extension](https://github.com/eonpatapon/gnome-shell-extension-caffeine)
by eonpatapon, reused under GPL-2.0.

## License

GPL-2.0-or-later
