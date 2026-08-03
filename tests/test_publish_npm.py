"""Release guard coverage for the npm publishing helper."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "create_lexmount_app_publish_npm", ROOT / "scripts" / "publish-npm.py"
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load scripts/publish-npm.py")
PUBLISH_NPM = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PUBLISH_NPM)


class ReleaseGuardTest(unittest.TestCase):
    def test_accepts_stable_version_with_v_tag(self) -> None:
        PUBLISH_NPM.assert_release_is_publishable("0.1.0", "v0.1.0", False)

    def test_accepts_stable_version_without_v_tag(self) -> None:
        PUBLISH_NPM.assert_release_is_publishable("0.1.0", "0.1.0", False)

    def test_rejects_mismatched_tag(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "does not match package version"):
            PUBLISH_NPM.assert_release_is_publishable("0.1.0", "v0.2.0", False)

    def test_rejects_github_prerelease(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Prerelease GitHub Releases"):
            PUBLISH_NPM.assert_release_is_publishable("0.1.0", "v0.1.0", True)

    def test_rejects_prerelease_package_version_on_stable_release(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Prerelease package version"):
            PUBLISH_NPM.assert_release_is_publishable(
                "0.2.0-beta.1", "v0.2.0-beta.1", False
            )


if __name__ == "__main__":
    unittest.main()
