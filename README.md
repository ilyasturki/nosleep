# nosleep

Tell the machine to stay awake.

A GNOME Quick Settings toggle and a CLI that block suspend and lid-switch
sleep — both driving the same transient systemd user unit, so they can never
disagree about whether the machine is allowed to sleep.

## Why another Caffeine?

State. Most keep-awake tools hold the inhibitor inside their own process or
track it in settings, and the two can drift apart — a stale toggle, a lost
inhibitor after a shell restart, a lock that outlives the session.

nosleep keeps no state at all. Turning it on creates a transient systemd
user unit (`nosleep.service`) that holds a `systemd-inhibit` block lock on
sleep and lid-close. The unit **is** the state:

- The toggle and indicator just mirror the real unit over D-Bus — they
  cannot desync, even across `gnome-shell` restarts.
- The unit dies on logout/reboot, so normal sleep behavior always comes
  back on its own.
- Anything can inspect or stop it: `systemctl --user status nosleep`.
- The CLI and the extension are interchangeable — either can stop what the
  other started, and the toggle lights up when a script enables it.

**Scope:** this blocks *sleep*, not *idle* — the screen may still blank and
lock. It keeps the machine running through a download or a long job; it is
not a presentation mode.

## CLI

```
nosleep            # toggle
nosleep 2h         # stay awake for 2 hours (also: 90m, 45s, 1d)
nosleep on         # stay awake until turned off
nosleep off
nosleep status
```

Requires only `bash` and systemd. Install by dropping `bin/nosleep` on your
`PATH`, or on Nix:

```
nix run github:ilyasturki/nosleep
```

## GNOME extension

A Quick Settings toggle ("Stay Awake") with a top-bar indicator while
active. The toggle and indicator stay on the lock screen, so you can
confirm or flip stay-awake without unlocking. Supports GNOME Shell 45–50.

- From extensions.gnome.org: *pending review*
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

## License

GPL-2.0-or-later
