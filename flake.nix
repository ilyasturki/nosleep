{
  description = "Tell the machine to stay awake — transient systemd unit inhibitor with a GNOME Quick Settings toggle and a CLI";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [
        "x86_64-linux"
        "aarch64-linux"
      ];
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        rec {
          default = nosleep;

          nosleep = pkgs.writeShellApplication {
            name = "nosleep";
            runtimeInputs = [
              pkgs.systemd
              pkgs.coreutils
              # `nosleep screen` calls gnome-session-inhibit, deliberately NOT
              # declared here: it ships only inside gnome-session, whose closure
              # is ~2 GiB. writeShellApplication prepends to PATH, so the running
              # GNOME session (which always has the binary) provides it; the
              # script errors cleanly if it is ever missing.
            ];
            text = builtins.readFile ./bin/nosleep;
          };

          extension = pkgs.stdenvNoCC.mkDerivation {
            pname = "gnome-shell-extension-nosleep";
            version = "1.0.2";
            src = ./extension;
            installPhase = ''
              runHook preInstall
              ext="$out/share/gnome-shell/extensions/nosleep@ilyasturki.com"
              mkdir -p "$ext"
              cp -r extension.js metadata.json icons "$ext/"
              runHook postInstall
            '';
            passthru.extensionUuid = "nosleep@ilyasturki.com";
          };
        }
      );
    };
}
