UUID = nosleep@ilyasturki.com

# Plain zip instead of `gnome-extensions pack`: same artifact (metadata.json
# at the zip root), and pack segfaults on some builds (seen on GNOME 50.1)
pack:
	mkdir -p dist
	rm -f dist/$(UUID).shell-extension.zip
	cd extension && zip -qr ../dist/$(UUID).shell-extension.zip extension.js metadata.json icons

install: pack
	gnome-extensions install --force dist/$(UUID).shell-extension.zip

.PHONY: pack install
