"""The `validate` verb: parse the user's config, check the library database and directory, and
report the effective merged session view — the startup gate."""

import os
import tempfile
import unittest

import fakes
from fakes import bridge


class RunValidateTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.library = os.path.join(self._dir.name, "library")
        self.beets_dir = os.path.join(self._dir.name, "beets")
        os.makedirs(self.library)
        os.makedirs(self.beets_dir)
        self.db_path = os.path.join(self.beets_dir, "library.db")

    def test_a_well_formed_config_reports_the_effective_session_view(self):
        handle = fakes.install(
            config_data={
                "plugins": ["musicbrainz"],
                "library": self.db_path,
                "directory": self.library,
            }
        )
        result = bridge.run_validate(handle.config)
        self.assertEqual(
            result,
            {
                "status": "valid",
                "beets_version": fakes.BEETS_VERSION,
                "library_database": self.db_path,
                "library_directory": self.library,
                "plugins": ["musicbrainz"],
                "overlay": bridge.SESSION_OVERLAY,
            },
        )

    def test_a_database_named_without_a_directory_resolves_against_the_current_directory(self):
        """A bare `library.db` (no parent in the path) is checked against '.', which exists — so a
        directory-less database name still validates."""
        handle = fakes.install(
            config_data={"plugins": [], "library": "library.db", "directory": self.library}
        )
        result = bridge.run_validate(handle.config)
        self.assertEqual(result["status"], "valid")

    def test_an_unusable_config_is_reported_as_invalid(self):
        handle = fakes.install(
            config_data={"library": self.db_path, "directory": self.library},
            filename_error=RuntimeError("bad template"),
        )
        with self.assertRaises(bridge.BridgeRefusal) as caught:
            bridge.run_validate(handle.config)
        self.assertEqual(caught.exception.kind, "config-invalid")

    def test_a_missing_library_directory_is_reported_as_invalid(self):
        handle = fakes.install(
            config_data={
                "library": self.db_path,
                "directory": os.path.join(self._dir.name, "nonexistent"),
            }
        )
        with self.assertRaises(bridge.BridgeRefusal) as caught:
            bridge.run_validate(handle.config)
        self.assertEqual(caught.exception.kind, "library-directory-missing")

    def test_a_missing_database_directory_is_reported_as_invalid(self):
        handle = fakes.install(
            config_data={
                "library": os.path.join(self._dir.name, "gone", "library.db"),
                "directory": self.library,
            }
        )
        with self.assertRaises(bridge.BridgeRefusal) as caught:
            bridge.run_validate(handle.config)
        self.assertEqual(caught.exception.kind, "library-db-missing")


if __name__ == "__main__":
    unittest.main()
