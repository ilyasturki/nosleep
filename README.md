# nosleep

Keep your Linux machine awake, from GNOME Quick Settings or the terminal.

<p align="center">
  <img src="docs/quick-settings.png" width="402"
       alt="The Stay Awake and Keep Screen On toggles in GNOME Quick Settings, Stay Awake on until 13:41">
</p>

| To | Click | Or run |
| --- | --- | --- |
| Keep running with the lid closed | Stay Awake | `nosleep` |
| Same, for a while | Stay Awake's menu | `nosleep 2h` |
| Keep the screen on | Keep Screen On | `nosleep screen` |
| Stop | the toggle again | `nosleep off`, `nosleep screen off` |

Stay Awake still lets the screen lock. A top-bar icon shows what's on, and
both turn off on logout.

## Why not Caffeine?

Caffeine holds its inhibitor inside GNOME Shell. nosleep runs it as a systemd
user service, so a script can call `nosleep 2h`, the toggle lights up, and
`systemctl --user status nosleep` shows the same state.

## Install

- GNOME extension (GNOME 45 to 50): [extensions.gnome.org](https://extensions.gnome.org/extension/10230/nosleep/), or `make install` from a clone, then log out and back in and run `gnome-extensions enable nosleep@ilyasturki.com`
- CLI: put `bin/nosleep` on your `PATH`, or `nix run github:ilyasturki/nosleep`

NixOS / home-manager:

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
