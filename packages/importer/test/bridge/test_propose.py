"""The `propose` verb: run the matcher over a staged directory, emit candidates sorted best-first,
and surface any library incumbents the best candidate would duplicate."""

import os
import tempfile
import unittest
from types import SimpleNamespace

import fakes
from fakes import bridge


def _propose_args(directory, search_id=None, search_artist=None, search_album=None):
    return SimpleNamespace(
        directory=directory,
        search_id=search_id,
        search_artist=search_artist,
        search_album=search_album,
    )


class RunProposeTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.intake = os.path.join(self._dir.name, "intake")
        os.makedirs(self.intake)
        with open(os.path.join(self.intake, "01 Love Me Do.mp3"), "wb") as handle:
            handle.write(b"\0")

    def _candidate(self, album_id, distance, artist="The Beatles", album="Love Me Do"):
        info = fakes.FakeAlbumInfo(
            identifier=("MusicBrainz", album_id), artist=artist, album=album
        )
        item = fakes.FakeItem(path=b"/intake/01.mp3", title="Love Me Do", track=1, length=143.0)
        track = fakes.FakeTrackInfo(title="Love Me Do", index=1)
        return fakes.FakeMatch(
            info=info,
            distance=fakes.Distance(distance, penalties=[], tracks={track: 0.0}),
            mapping={item: track},
        )

    def test_a_directory_with_no_incumbent_emits_the_candidates_and_no_duplicates(self):
        handle = fakes.install()
        handle.proposal = fakes.Proposal([self._candidate(fakes.MBID, 0.0)])
        result = bridge.run_propose(handle.config, _propose_args(self.intake, search_id=fakes.MBID))
        self.assertEqual(result["status"], "proposal")
        self.assertEqual(len(result["candidates"]), 1)
        self.assertEqual(result["candidates"][0]["album_id"], fakes.MBID)
        self.assertEqual(result["duplicates"], [])
        # A --search-id pins the ID lookup passed to the matcher.
        self.assertEqual(handle.tag_calls[0]["search_ids"], [fakes.MBID])

    def test_free_search_passes_no_id_to_the_matcher(self):
        handle = fakes.install()
        handle.proposal = fakes.Proposal([self._candidate(fakes.MBID, 0.0)])
        bridge.run_propose(handle.config, _propose_args(self.intake))
        self.assertEqual(handle.tag_calls[0]["search_ids"], [])

    def test_candidates_are_ordered_best_first_by_distance(self):
        handle = fakes.install()
        far = self._candidate("far-id", 0.6, album="Basement Tape")
        near = self._candidate("near-id", 0.1)
        handle.proposal = fakes.Proposal([far, near])
        result = bridge.run_propose(handle.config, _propose_args(self.intake))
        self.assertEqual(
            [candidate["album_id"] for candidate in result["candidates"]],
            ["near-id", "far-id"],
        )

    def test_the_best_candidates_incumbents_are_reported_as_duplicates(self):
        handle = fakes.install()
        handle.lib = fakes.FakeLib(
            albums=[fakes.FakeAlbum(albumartist="The Beatles", album="Love Me Do", path=b"/library/x")]
        )
        handle.proposal = fakes.Proposal([self._candidate(fakes.MBID, 0.0)])
        result = bridge.run_propose(handle.config, _propose_args(self.intake, search_id=fakes.MBID))
        self.assertEqual(
            result["duplicates"],
            [{"artist": "The Beatles", "album": "Love Me Do", "path": "/library/x"}],
        )

    def test_no_candidates_yields_an_empty_proposal_and_no_incumbent_lookup(self):
        handle = fakes.install()
        handle.lib = fakes.FakeLib(albums=[fakes.FakeAlbum(album="anything")])
        handle.proposal = fakes.Proposal([])
        result = bridge.run_propose(handle.config, _propose_args(self.intake))
        self.assertEqual(result, {"status": "proposal", "candidates": [], "duplicates": []})
        # With no best candidate there is nothing to check the library against.
        self.assertEqual(handle.lib.album_queries, [])


if __name__ == "__main__":
    unittest.main()
