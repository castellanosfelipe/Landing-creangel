#!/usr/bin/env python3
"""Generate nginx's HTTP redirect map from the canonical route configuration."""

import argparse
import json
from pathlib import Path
import re
import sys


REPOSITORY = Path(__file__).resolve().parents[2]
SAFE_PATH = re.compile(r"/[A-Za-z0-9._~%/+\-]*\Z")


def redirect_entries(config):
    routes = set(config["routes"])
    aliases = config["redirects"]["pages"]
    entries = {}
    for source, target in aliases.items():
        if not SAFE_PATH.fullmatch(source) or not SAFE_PATH.fullmatch(target):
            raise ValueError(f"Redirect paths must be local paths without query strings: {source!r}")
        if source == "/" or not source.endswith("/"):
            raise ValueError(f"A legacy page alias must end with '/': {source!r}")
        if source in routes or source.rstrip("/") in routes:
            raise ValueError(f"A canonical page cannot be redirected: {source!r}")
        if target not in routes or target in aliases:
            raise ValueError(f"Redirect target must be a final canonical page: {target!r}")
        for variant in (source, source[:-1]):
            if variant in entries and entries[variant] != target:
                raise ValueError(f"Conflicting redirect for {variant!r}")
            entries[variant] = target
    # nginx string keys are case-insensitive, so reject ambiguous map keys.
    if len({key.casefold() for key in entries}) != len(entries):
        raise ValueError("Redirect source paths differ only by letter case")
    return dict(sorted(entries.items()))


def render(config):
    entries = redirect_entries(config)
    longest = max((len(key.encode("utf-8")) for key in entries), default=0)
    bucket_size = 64
    while bucket_size < longest + 32:
        bucket_size *= 2
    lines = [
        "# Generated from .pages/config.json by ops/seo/generate-redirects.py.",
        "# Regenerate after editing redirects.pages; do not edit this map by hand.",
        f"# {len(config['redirects']['pages'])} aliases; {len(entries)} exact URI variants.",
        f"map_hash_bucket_size {bucket_size};",
        "map $uri $legacy_target {",
        '    default "";',
    ]
    lines.extend(f'    "{source}" "{target}";' for source, target in entries.items())
    lines.append("}")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=REPOSITORY / ".pages/config.json")
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("nginx-redirects.conf"))
    parser.add_argument("--check", action="store_true", help="Fail if the saved map differs from the configuration")
    args = parser.parse_args()
    try:
        config = json.loads(args.config.read_text(encoding="utf-8"))
        generated = render(config)
        if args.check:
            if not args.output.is_file() or args.output.read_text(encoding="utf-8") != generated:
                raise ValueError("Saved nginx redirect map is outdated; run ops/seo/generate-redirects.py")
        else:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(generated, encoding="utf-8", newline="\n")
        print(f"{'Verified' if args.check else 'Generated'} {len(redirect_entries(config))} HTTP redirect variants")
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Redirect map error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
