#!/usr/bin/env python3
"""Validate and optionally publish create-lexmount-app to npm."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from shutil import which


def resolve_command(command: str) -> str:
    if path := which(command):
        return path
    if sys.platform == "win32" and (path := which(f"{command}.cmd")):
        return path
    return command


def run_step(name: str, command: list[str], cwd: Path) -> None:
    print()
    print(f"==> {name}")
    subprocess.run(command, cwd=cwd, check=True, text=True)


def load_package_metadata(root: Path) -> tuple[str, str]:
    package_json = root / "package.json"
    data = json.loads(package_json.read_text(encoding="utf-8"))
    return data["name"], data["version"]


def assert_github_release_matches_version(version: str) -> None:
    if os.environ.get("GITHUB_ACTIONS", "").lower() != "true":
        return

    release_tag = os.environ.get("GITHUB_RELEASE_TAG", "").strip()
    is_prerelease = (
        os.environ.get("GITHUB_RELEASE_PRERELEASE", "").strip().lower() == "true"
    )

    if is_prerelease:
        raise RuntimeError(
            "Prerelease GitHub Releases are not published by this workflow."
        )

    expected_tags = {version, f"v{version}"}
    if release_tag not in expected_tags:
        expected = " or ".join(sorted(expected_tags))
        raise RuntimeError(
            f"GitHub Release tag {release_tag!r} does not match package version "
            f"{version!r}; expected {expected}."
        )


def assert_version_not_published(
    root: Path, npm: str, package_name: str, version: str
) -> None:
    print()
    print("==> Checking npm version availability")
    result = subprocess.run(
        [npm, "view", f"{package_name}@{version}", "version"],
        cwd=root,
        text=True,
        capture_output=True,
    )

    if result.returncode == 0:
        raise RuntimeError(f"{package_name}@{version} is already published on npm.")

    combined = f"{result.stdout or ''}\n{result.stderr or ''}"
    if (
        "E404" in combined
        or "404" in combined
        or "not in this registry" in combined.lower()
    ):
        print(f"{package_name}@{version} is not published yet.")
        return

    raise RuntimeError(
        "Failed to check whether the npm version already exists.\n"
        f"{combined.strip()}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run npm release checks and optionally publish the package."
    )
    parser.add_argument(
        "--skip-publish",
        action="store_true",
        help="Run validation only and skip `npm publish`.",
    )
    parser.add_argument(
        "--skip-login-check",
        action="store_true",
        help="Skip `npm whoami`. Required for CI trusted publishing.",
    )
    parser.add_argument(
        "--skip-version-check",
        action="store_true",
        help="Skip checking whether the current package version is already published.",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    npm = resolve_command("npm")
    package_name, version = load_package_metadata(root)
    assert_github_release_matches_version(version)

    if not args.skip_login_check:
        run_step("Checking npm login", [npm, "whoami"], root)
    else:
        print()
        print("==> Skipping npm login check")

    if not args.skip_version_check:
        assert_version_not_published(root, npm, package_name, version)
    else:
        print()
        print("==> Skipping npm version availability check")

    run_step("Installing dependencies", [npm, "ci"], root)
    run_step("Running checks", [npm, "run", "check"], root)
    run_step("Validating package contents", [npm, "pack", "--dry-run"], root)

    if args.skip_publish:
        print()
        print("Skipped npm publish. Validation completed.")
        return 0

    run_step("Publishing package to npm", [npm, "publish"], root)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        raise SystemExit(exc.returncode)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
