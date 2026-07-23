"""The `apply` verb: run a real ImportSession for a chosen outcome (a re-resolved candidate,
as-is, or manual tags), honoring the duplicate action, and reporting applied / skipped-duplicate /
the modeled refusals. Also the BridgeSession that answers every question beets would ask a human."""

import json
import os
import tempfile
import unittest
from types import SimpleNamespace

import fakes
from fakes import bridge


def _apply_args(directory, candidate=None, tags=None, duplicate_action="skip"):
    return SimpleNamespace(
        directory=directory, candidate=candidate, tags=tags, duplicate_action=duplicate_action
    )


def _incumbent(path=b"/library/The Beatles/Love Me Do"):
    return fakes.FakeAlbum(albumartist="The Beatles", album="Love Me Do", path=path)


def _matching_candidate(album_id=fakes.MBID):
    return fakes.FakeMatch(
        info=fakes.FakeAlbumInfo(identifier=("MusicBrainz", album_id)),
        distance=fakes.Distance(0.0),
    )


class RunApplyTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.intake = os.path.join(self._dir.name, "intake")
        os.makedirs(self.intake)
        with open(os.path.join(self.intake, "01 Love Me Do.mp3"), "wb") as handle:
            handle.write(b"\0")
        self.album = fakes.FakeAlbum(
            albumartist="The Beatles", album="Love Me Do", path=b"/library/The Beatles/Love Me Do"
        )

    def test_an_as_is_import_moves_the_album_and_reports_applied(self):
        handle = fakes.install()
        fakes.set_plan(fakes.make_task(album=self.album))
        result = bridge.run_apply(handle.config, _apply_args(self.intake))
        self.assertEqual(
            result,
            {"status": "applied", "location": "/library/The Beatles/Love Me Do", "failures": []},
        )

    def test_as_is_stubs_the_candidate_lookup_so_no_network_is_touched(self):
        """For as-is the bridge replaces the task's candidate lookup with a no-op that clears any
        candidates and sets the recommendation to none — the pipeline flows straight to ASIS."""
        handle = fakes.install()
        task = fakes.make_task(candidates=[_matching_candidate()], album=self.album)
        fakes.set_plan(task)
        bridge.run_apply(handle.config, _apply_args(self.intake))
        self.assertEqual(task.candidates, [])
        self.assertEqual(task.rec, handle.autotag.Recommendation.none)
        self.assertIsNone(task.cur_artist)
        self.assertIsNone(task.cur_album)

    def test_an_applied_album_with_no_path_reports_an_empty_location(self):
        handle = fakes.install()
        fakes.set_plan(fakes.make_task(album=fakes.FakeAlbum(path=b"")))
        result = bridge.run_apply(handle.config, _apply_args(self.intake))
        self.assertEqual(result["location"], "")

    def test_a_chosen_candidate_is_re_resolved_by_id_and_imported(self):
        handle = fakes.install()
        task = fakes.make_task(candidates=[_matching_candidate()], album=self.album)
        fakes.set_plan(task)
        args = _apply_args(self.intake, candidate=f"MusicBrainz:{fakes.MBID}")
        result = bridge.run_apply(handle.config, args)
        self.assertEqual(result["status"], "applied")
        # The candidate's album id is pinned as the deterministic ID lookup for the session.
        self.assertEqual(handle.config["import"]["search_ids"].as_str_seq(), [fakes.MBID])

    def test_a_malformed_candidate_reference_is_refused(self):
        handle = fakes.install()
        with self.assertRaises(bridge.BridgeRefusal) as caught:
            bridge.run_apply(handle.config, _apply_args(self.intake, candidate="not-a-ref"))
        self.assertEqual(caught.exception.kind, "bad-candidate-ref")

    def test_a_candidate_that_no_longer_resolves_by_id_is_refused(self):
        handle = fakes.install()
        # The task offers a different release than the one requested, so no ID match is found.
        fakes.set_plan(fakes.make_task(candidates=[_matching_candidate("some-other-id")], album=self.album))
        args = _apply_args(self.intake, candidate="MusicBrainz:00000000-0000-0000-0000-000000000000")
        with self.assertRaises(bridge.BridgeRefusal) as caught:
            bridge.run_apply(handle.config, args)
        self.assertEqual(caught.exception.kind, "candidate-not-found")
        self.assertIn("00000000-0000-0000-0000-000000000000", str(caught.exception))

    def test_a_skipped_duplicate_returns_the_incumbents_and_imports_nothing(self):
        handle = fakes.install()
        fakes.set_plan(fakes.make_task(album=self.album, duplicates=[_incumbent()]))
        result = bridge.run_apply(handle.config, _apply_args(self.intake, duplicate_action="skip"))
        self.assertEqual(
            result,
            {
                "status": "skipped-duplicate",
                "incumbents": [
                    {"artist": "The Beatles", "album": "Love Me Do", "path": "/library/The Beatles/Love Me Do"}
                ],
            },
        )

    def test_a_replace_duplicate_action_still_imports_the_album(self):
        handle = fakes.install()
        fakes.set_plan(fakes.make_task(album=self.album, duplicates=[_incumbent()]))
        result = bridge.run_apply(handle.config, _apply_args(self.intake, duplicate_action="replace"))
        self.assertEqual(result["status"], "applied")

    def test_a_keep_both_duplicate_action_still_imports_the_album(self):
        handle = fakes.install()
        fakes.set_plan(fakes.make_task(album=self.album, duplicates=[_incumbent()]))
        result = bridge.run_apply(handle.config, _apply_args(self.intake, duplicate_action="keep-both"))
        self.assertEqual(result["status"], "applied")

    def test_manual_tags_apply_writes_the_tags_and_imports_as_is(self):
        handle = fakes.install()
        item = fakes.FakeItem(path=os.path.join(self.intake, "01 Love Me Do.mp3").encode())
        fakes.set_plan(fakes.make_task(items=[item], album=self.album))
        tags = {
            "albumArtist": "The Beatles",
            "album": "Love Me Do",
            "tracks": [{"path": "01 Love Me Do.mp3", "title": "Love Me Do", "trackNumber": 1}],
        }
        result = bridge.run_apply(handle.config, _apply_args(self.intake, tags=json.dumps(tags)))
        self.assertEqual(result["status"], "applied")
        self.assertEqual(item.albumartist, "The Beatles")
        self.assertEqual(item.title, "Love Me Do")

    def test_an_import_that_moves_no_album_is_refused_as_nothing_imported(self):
        handle = fakes.install()
        fakes.set_plan()  # beets produced no importable album for the directory
        with self.assertRaises(bridge.BridgeRefusal) as caught:
            bridge.run_apply(handle.config, _apply_args(self.intake))
        self.assertEqual(caught.exception.kind, "nothing-imported")

    def test_a_post_import_pipeline_failure_after_a_move_is_recorded_not_retried(self):
        """When session.run() raises AFTER an album already moved, the outcome is still `applied`
        with the error captured in failures[] — not a plain retryable crash (design D7)."""
        handle = fakes.install()
        alpha = fakes.FakeAlbum(album="Alpha", path=b"/library/Alpha")
        beta = fakes.FakeAlbum(album="Beta", path=b"/library/Beta")

        seen = {"count": 0}

        def fail_on_second(lib, album):  # a plugin listener that raises on the 2nd album
            seen["count"] += 1
            if seen["count"] >= 2:
                raise RuntimeError("synthetic post-import failure recorded as an apply failure")

        # Registered BEFORE the bridge appends its own listener, so album 1 is recorded then album 2
        # raises before the bridge sees it.
        handle.BeetsPlugin.listeners["album_imported"] = [fail_on_second]
        fakes.set_plan(fakes.make_task(album=alpha), fakes.make_task(album=beta))
        result = bridge.run_apply(handle.config, _apply_args(self.intake))
        self.assertEqual(result["status"], "applied")
        self.assertEqual(result["location"], "/library/Alpha")
        self.assertEqual(
            result["failures"],
            [{"stage": "import-pipeline", "message": "synthetic post-import failure recorded as an apply failure"}],
        )

    def test_a_pipeline_failure_before_anything_moved_propagates_as_a_retryable_crash(self):
        handle = fakes.install()

        def fail_immediately(lib, album):
            raise RuntimeError("network fault")

        handle.BeetsPlugin.listeners["album_imported"] = [fail_immediately]
        fakes.set_plan(fakes.make_task(album=self.album))
        with self.assertRaises(RuntimeError):
            bridge.run_apply(handle.config, _apply_args(self.intake))


class ApplyManualTagsTest(unittest.TestCase):
    def test_manual_tags_overwrite_album_and_matched_track_fields(self):
        matched = fakes.FakeItem(path=b"/intake/01 A.mp3", title="old", track=0)
        unmatched = fakes.FakeItem(path=b"/intake/02 B.mp3", title="keep-me", track=9)
        task = SimpleNamespace(items=[matched, unmatched])
        tags = {
            "albumArtist": "New Artist",
            "album": "New Album",
            "year": 1999,
            "tracks": [
                {
                    "path": "/somewhere/01 A.mp3",
                    "title": "Track One",
                    "trackNumber": 1,
                    "artist": "Featured",
                    "discNumber": 2,
                }
            ],
        }
        bridge.apply_manual_tags(task, tags)
        self.assertEqual(matched.albumartist, "New Artist")
        self.assertEqual(matched.album, "New Album")
        self.assertEqual(matched.year, 1999)
        self.assertEqual(matched.title, "Track One")
        self.assertEqual(matched.track, 1)
        self.assertEqual(matched.artist, "Featured")
        self.assertEqual(matched.disc, 2)
        # A file with no corresponding track keeps its existing title/track.
        self.assertEqual(unmatched.title, "keep-me")
        self.assertEqual(unmatched.track, 9)

    def test_manual_tags_omit_optional_fields_when_absent(self):
        item = fakes.FakeItem(path=b"/intake/01 A.mp3", artist="original", track=0)
        item.year = 0
        item.disc = 0
        task = SimpleNamespace(items=[item])
        tags = {
            "albumArtist": "New Artist",
            "album": "New Album",
            "tracks": [{"path": "01 A.mp3", "title": "Track One", "trackNumber": 1}],
        }
        bridge.apply_manual_tags(task, tags)
        self.assertEqual(item.title, "Track One")
        self.assertEqual(item.year, 0)  # no year in tags -> untouched
        self.assertEqual(item.artist, "original")  # no track artist -> untouched
        self.assertEqual(item.disc, 0)  # no discNumber -> untouched


class BridgeSessionAnswersTest(unittest.TestCase):
    """The session must never pause or defer to a human: it declines resume and answers as-is to any
    per-item question."""

    def _session(self):
        handle = fakes.install()
        choice = {"mode": "as-is", "duplicate_action": "skip"}
        return handle, bridge.make_session(handle.importer, handle.lib, "/intake", choice)

    def test_the_session_never_resumes_a_previous_run(self):
        _handle, session = self._session()
        self.assertFalse(session.should_resume("/intake"))

    def test_the_session_answers_as_is_to_an_individual_item_question(self):
        handle, session = self._session()
        self.assertIs(session.choose_item(object()), handle.Action.ASIS)


if __name__ == "__main__":
    unittest.main()
