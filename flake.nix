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
            ];
            text = builtins.readFile ./bin/nosleep;
          };

          extension = pkgs.stdenvNoCC.mkDerivation {
            pname = "gnome-shell-extension-nosleep";
            version = "1.0.1";
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
