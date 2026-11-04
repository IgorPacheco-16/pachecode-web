"""Validate the exact static payload allowed in the public Pages artifact."""

from __future__ import annotations

import argparse
from pathlib import Path


FORBIDDEN_SUFFIXES = {
    ".7z", ".crt", ".der", ".env", ".gz", ".key", ".p12", ".pem", ".pfx",
    ".rar", ".tar", ".zip",
}
PRIVATE_MARKERS = (
    b"-----BEGIN PRIVATE KEY-----",
    b"-----BEGIN RSA PRIVATE KEY-----",
    b"-----BEGIN EC PRIVATE KEY-----",
    b"-----BEGIN OPENSSH PRIVATE KEY-----",
)
EXPECTED_FILES = {
    "app.js",
    "icons/pachecode-192.png",
    "icons/pachecode-512.png",
    "icons/pachecode.svg",
    "index.html",
    "manifest.webmanifest",
    "protocol.js",
    "styles.css",
    "sw.js",
    "vendor/jsQR.js",
    "vendor/LICENSE-jsQR.txt",
    "vendor/LICENSE-pako.txt",
    "vendor/pako.min.js",
}


def validate(root: Path) -> list[str]:
    errors: list[str] = []
    if not root.is_dir():
        return [f"diretorio de publicacao inexistente: {root}"]

    found_files: set[str] = set()
    for path in root.rglob("*"):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            errors.append(f"link simbolico nao permitido: {relative}")
            continue
        if not path.is_file():
            continue
        found_files.add(relative)
        if relative not in EXPECTED_FILES:
            errors.append(f"arquivo nao previsto na publicacao: {relative}")
            continue
        if path.suffix.lower() in FORBIDDEN_SUFFIXES or path.name.lower().startswith(".env"):
            errors.append(f"tipo de arquivo nao permitido: {relative}")
            continue
        data = path.read_bytes()
        if any(marker in data for marker in PRIVATE_MARKERS):
            errors.append(f"chave privada detectada: {relative}")
    for relative in sorted(EXPECTED_FILES - found_files):
        errors.append(f"arquivo obrigatorio ausente: {relative}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    errors = validate(args.directory)
    if errors:
        print("Artefato do Pages rejeitado:")
        print("\n".join(f"- {error}" for error in errors))
        return 1
    print(f"Artefato do Pages validado: {args.directory}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
