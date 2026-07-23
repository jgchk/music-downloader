"""Unit tests for the beets bridge's pure control flow.

The bridge imports beets only lazily inside its functions, so these tests inject a fake `beets`
module into `sys.modules` and drive the bridge directly — no real beets install, ffmpeg, or audio
files required. That keeps this tier fast and dependency-free (stdlib `unittest` under coverage.py),
while pinning the behavior the contract tier (which replays recorded JSON) can never reach: the
bridge's own Python control flow.

The load-bearing case is the `except OSError: raise` / `except Exception: continue` split in
`collect_items`. A real I/O fault (EACCES/EIO/a vanished file) must propagate so the crash surfaces
as a retryable infrastructure error; only an unreadable/unsupported *format* may be silently skipped.
A regression that reordered those handlers or widened the bare `except` would silently drop a file
beets could have read once the fault cleared — the exact class of bug this bridge change fixed.
"""

import os
import sys
import tempfile
import types
import unittest

BRIDGE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "src",
    "adapters",
    "beets",
    "bridge",
)
if BRIDGE_DIR not in sys.path:
    sys.path.insert(0, BRIDGE_DIR)

import bridge  # noqa: E402 — imported after the sys.path insert above


def _install_fake_beets(from_path):
    """Make `from beets import library` inside the bridge resolve to a stub whose
    `library.Item.from_path` delegates to `from_path` (which may return a value or raise)."""
    beets = types.ModuleType("beets")
    library = types.ModuleType("beets.library")

    class Item:
        @staticmethod
        def from_path(path):
            return from_path(path)

    library.Item = Item
    beets.library = library
    sys.modules["beets"] = beets
    sys.modules["beets.library"] = library


class CollectItemsTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        # os.walk needs a real entry to iterate; the byte content is irrelevant (from_path is faked).
        with open(os.path.join(self._dir.name, "track.flac"), "wb") as handle:
            handle.write(b"\0")
        self.addCleanup(self._dir.cleanup)

    def test_an_io_fault_reading_a_file_propagates(self):
        """An OSError from reading a file is a retryable infrastructure fault, never a skip."""

        def raise_io(_path):
            raise OSError(5, "I/O error")

        _install_fake_beets(raise_io)
        with self.assertRaises(OSError):
            bridge.collect_items(self._dir.name)

    def test_an_unreadable_format_is_skipped_not_raised(self):
        """A non-OSError (an unreadable/unsupported format) is skipped; an all-skipped directory
        surfaces the modeled `no-audio-files` refusal, not the raw exception."""

        def raise_format(_path):
            raise ValueError("not an audio file beets can read")

        _install_fake_beets(raise_format)
        with self.assertRaises(bridge.BridgeRefusal) as caught:
            bridge.collect_items(self._dir.name)
        self.assertEqual(caught.exception.kind, "no-audio-files")

    def test_readable_files_are_collected(self):
        """A file beets can read is returned as an item."""
        sentinel = object()
        _install_fake_beets(lambda _path: sentinel)
        self.assertEqual(bridge.collect_items(self._dir.name), [sentinel])

    def test_a_missing_directory_is_refused(self):
        """A path that is not a directory is a modeled refusal, before any file is read."""
        _install_fake_beets(lambda _path: object())
        with self.assertRaises(bridge.BridgeRefusal) as caught:
            bridge.collect_items(os.path.join(self._dir.name, "does-not-exist"))
        self.assertEqual(caught.exception.kind, "directory-not-found")


if __name__ == "__main__":
    unittest.main()
