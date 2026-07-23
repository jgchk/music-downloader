"""The pure serializers that shape the JSON a review reads: per-track diffs, penalties, album
fields, and incumbent lookup. These freeze the headline contract the change added."""

import os
import unittest

import fakes
from fakes import bridge


class IdentifierOfTest(unittest.TestCase):
    def test_a_populated_identifier_is_returned_as_source_and_string_id(self):
        info = fakes.FakeAlbumInfo(identifier=("MusicBrainz", fakes.MBID))
        self.assertEqual(bridge.identifier_of(info), ("MusicBrainz", fakes.MBID))

    def test_a_missing_source_or_id_becomes_empty_strings_never_none(self):
        info = fakes.FakeAlbumInfo(identifier=(None, None))
        self.assertEqual(bridge.identifier_of(info), ("", ""))


class SerializeTrackTest(unittest.TestCase):
    def test_a_mapped_track_carries_proposed_tags_current_tags_and_distance(self):
        item = fakes.FakeItem(
            path=b"/intake/01 Love Me Do.mp3",
            title="Love Me Do",
            artist="The Beatles",
            track=1,
            length=143.07265306122449,
        )
        track = fakes.FakeTrackInfo(title="Love Me Do", index=1)
        result = bridge.serialize_track(item, track, 0.0)
        self.assertEqual(
            result,
            {
                "path": "/intake/01 Love Me Do.mp3",
                "title": "Love Me Do",
                "index": 1,
                "current": {
                    "title": "Love Me Do",
                    "artist": "The Beatles",
                    "track": 1,
                    "length": 143.07265306122449,
                },
                "distance": 0.0,
            },
        )

    def test_an_unreadable_duration_is_omitted_never_recorded_as_a_false_zero(self):
        item = fakes.FakeItem(path=b"/intake/02.mp3", title="", artist="", track=0, length=0)
        result = bridge.serialize_track(item, fakes.FakeTrackInfo(), 0.5)
        self.assertNotIn("length", result["current"])


class SerializeMatchTest(unittest.TestCase):
    def test_a_match_serializes_tracks_penalties_extras_and_album_fields(self):
        item = fakes.FakeItem(
            path=b"/intake/01 Luv Me Do.mp3",
            title="Luv Me Do",
            artist="The Beatles",
            track=1,
            length=143.0,
        )
        track = fakes.FakeTrackInfo(title="Love Me Do", index=1)
        extra_item = fakes.FakeItem(path=b"/intake/99 Bonus.mp3", title="Bonus Beatz", track=9)
        extra_track = fakes.FakeTrackInfo(title="P.S. I Love You", index=2)
        info = fakes.FakeAlbumInfo(
            identifier=("MusicBrainz", fakes.MBID),
            artist="The Beatles",
            album="Love Me Do",
            year=1988,
            media="8cm CD",
            label="Parlophone",
            catalognum="CD3R 4949",
            country="XE",
            albumdisambig="mini CD",
        )
        distance = fakes.Distance(
            0.073,
            penalties=[("unmatched_tracks", 0.051), ("tracks", 0.021)],
            tracks={track: 0.125},
        )
        match = fakes.FakeMatch(
            info=info,
            distance=distance,
            mapping={item: track},
            extra_items=[extra_item],
            extra_tracks=[extra_track],
        )
        result = bridge.serialize_match(match)
        self.assertEqual(result["data_source"], "MusicBrainz")
        self.assertEqual(result["album_id"], fakes.MBID)
        self.assertEqual(result["distance"], 0.073)
        self.assertEqual(
            result["penalties"],
            [
                {"name": "unmatched_tracks", "amount": 0.051},
                {"name": "tracks", "amount": 0.021},
            ],
        )
        self.assertEqual(result["tracks"][0]["title"], "Love Me Do")
        self.assertEqual(result["tracks"][0]["distance"], 0.125)
        self.assertEqual(
            result["extra_items"],
            [{"path": "/intake/99 Bonus.mp3", "title": "Bonus Beatz", "track": 9}],
        )
        self.assertEqual(result["extra_tracks"], [{"title": "P.S. I Love You", "index": 2}])
        self.assertEqual(
            result["album_fields"],
            {
                "year": 1988,
                "media": "8cm CD",
                "label": "Parlophone",
                "catalognum": "CD3R 4949",
                "country": "XE",
                "albumdisambig": "mini CD",
            },
        )

    def test_a_perfect_match_has_empty_penalties_and_extras(self):
        item = fakes.FakeItem(path=b"/intake/01.mp3", title="Love Me Do", track=1, length=143.0)
        track = fakes.FakeTrackInfo(title="Love Me Do", index=1)
        info = fakes.FakeAlbumInfo(identifier=("MusicBrainz", fakes.MBID), artist="The Beatles", album="Love Me Do")
        match = fakes.FakeMatch(
            info=info,
            distance=fakes.Distance(0.0, penalties=[], tracks={track: 0.0}),
            mapping={item: track},
        )
        result = bridge.serialize_match(match)
        self.assertEqual(result["penalties"], [])
        self.assertEqual(result["extra_items"], [])
        self.assertEqual(result["extra_tracks"], [])


class SerializeAlbumTest(unittest.TestCase):
    def test_an_album_with_a_path_is_decoded(self):
        album = fakes.FakeAlbum(albumartist="The Beatles", album="Love Me Do", path=b"/library/The Beatles/Love Me Do")
        self.assertEqual(
            bridge.serialize_album(album),
            {"artist": "The Beatles", "album": "Love Me Do", "path": "/library/The Beatles/Love Me Do"},
        )

    def test_an_album_without_a_path_serializes_an_empty_path(self):
        album = fakes.FakeAlbum(albumartist="The Beatles", album="Love Me Do", path=b"")
        self.assertEqual(bridge.serialize_album(album)["path"], "")


class FindIncumbentsTest(unittest.TestCase):
    def test_incumbents_are_the_library_albums_matching_the_candidate_artist_and_album(self):
        fakes.install()
        lib = fakes.FakeLib(
            albums=[fakes.FakeAlbum(albumartist="The Beatles", album="Love Me Do", path=b"/library/x")]
        )
        result = bridge.find_incumbents(lib, "The Beatles", "Love Me Do")
        self.assertEqual(result, [{"artist": "The Beatles", "album": "Love Me Do", "path": "/library/x"}])
        # The lookup is an AND of exact artist+album matches.
        query = lib.album_queries[0]
        self.assertEqual(len(query.subqueries), 2)
        self.assertEqual({q.field for q in query.subqueries}, {"albumartist", "album"})

    def test_no_matching_library_album_yields_no_incumbents(self):
        fakes.install()
        self.assertEqual(bridge.find_incumbents(fakes.FakeLib(albums=[]), "X", "Y"), [])


if __name__ == "__main__":
    unittest.main()
