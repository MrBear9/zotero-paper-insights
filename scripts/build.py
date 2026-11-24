"""Build the installable Zotero XPI with Python's standard library."""

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def main():
    root = Path(__file__).resolve().parents[1]
    addon = root / "addon"
    manifest = json.loads((addon / "manifest.json").read_text(encoding="utf-8"))
    destination = root / "dist" / f"zotero-paper-insights-{manifest['version']}.xpi"
    destination.parent.mkdir(exist_ok=True)
    with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
        for path in sorted(addon.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(addon).as_posix())
        archive.write(root / "LICENSE", "LICENSE")
    print(destination)


if __name__ == "__main__":
    main()

