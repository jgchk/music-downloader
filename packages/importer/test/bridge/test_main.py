"""End-to-end drive of `main`: argument dispatch, the emitted contract document per verb, and the
refusal-to-status mapping (doomed for propose/apply, invalid for validate). Exit code is always 0
for a well-formed outcome; only unexpected crashes travel as non-zero."""

import io
import json
import os
import tempfile
import unittest

import fakes
from fakes import bridge


class MainTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.config_path = os.path.join(self._dir.name, "config.yaml")
        with open(self.config_path, "w") as handle:
            handle.write("plugins: [musicbrainz]\n")
        self.intake = os.path.join(self._dir.name, "intake")
        os.makedirs(self.intake)
        with open(os.path.join(self.intake, "01 Love Me Do.mp3"), "wb") as handle:
            handle.write(b"\0")
        self.library = os.path.join(self._dir.name, "library")
        os.makedirs(self.library)
        self._saved_claim = bridge.claim_stdout
        self._saved_channel = bridge._contract_channel
        self.channel = io.StringIO()

        def fake_claim():
            bridge._contract_channel = self.channel

        bridge.claim_stdout = fake_claim
        self.addCleanup(self._restore)

    def _restore(self):
        bridge.claim_stdout = self._saved_claim
        bridge._contract_channel = self._saved_channel

    def _emitted(self):
        return json.loads(self.channel.getvalue())

    def _standard_config(self, handle):
        handle.config = fakes.FakeConfig(
            {
                "plugins": ["musicbrainz"],
                "library": os.path.join(self.library, "library.db"),
                "directory": self.library,
            }
        )
        handle.beets.config = handle.config

    def test_propose_emits_a_proposal_document_and_returns_zero(self):
        handle = fakes.install()
        info = fakes.FakeAlbumInfo(identifier=("MusicBrainz", fakes.MBID), artist="The Beatles", album="Love Me Do")
        handle.proposal = fakes.Proposal([fakes.FakeMatch(info=info, distance=fakes.Distance(0.0))])
        code = bridge.main(["--config", self.config_path, "propose", self.intake, "--search-id", fakes.MBID])
        self.assertEqual(code, 0)
        emitted = self._emitted()
        self.assertEqual(emitted["status"], "proposal")
        self.assertEqual(emitted["candidates"][0]["album_id"], fakes.MBID)

    def test_apply_emits_an_applied_document(self):
        handle = fakes.install()
        fakes.set_plan(fakes.make_task(album=fakes.FakeAlbum(path=b"/library/x")))
        code = bridge.main(["--config", self.config_path, "apply", self.intake, "--as-is"])
        self.assertEqual(code, 0)
        self.assertEqual(self._emitted()["status"], "applied")

    def test_validate_emits_a_valid_document(self):
        handle = fakes.install()
        self._standard_config(handle)
        code = bridge.main(["--config", self.config_path, "validate"])
        self.assertEqual(code, 0)
        self.assertEqual(self._emitted()["status"], "valid")

    def test_a_business_refusal_on_propose_is_emitted_as_doomed(self):
        fakes.install()
        missing = os.path.join(self._dir.name, "never-existed")
        code = bridge.main(["--config", self.config_path, "propose", missing])
        self.assertEqual(code, 0)
        emitted = self._emitted()
        self.assertEqual(emitted["status"], "doomed")
        self.assertEqual(emitted["kind"], "directory-not-found")
        self.assertIn("never-existed", emitted["reason"])

    def test_a_business_refusal_on_validate_is_emitted_as_invalid(self):
        handle = fakes.install()
        handle.config = fakes.FakeConfig(
            {"library": os.path.join(self.library, "library.db"), "directory": os.path.join(self._dir.name, "gone")}
        )
        handle.beets.config = handle.config
        code = bridge.main(["--config", self.config_path, "validate"])
        self.assertEqual(code, 0)
        emitted = self._emitted()
        self.assertEqual(emitted["status"], "invalid")
        self.assertEqual(emitted["kind"], "library-directory-missing")


if __name__ == "__main__":
    unittest.main()
