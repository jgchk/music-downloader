"""Faithful fakes for the beets contracts the bridge depends on.

Named ``fakes.py`` (not ``test_*.py``) so unittest's ``test_*.py`` discovery never runs it as a
test module. The bridge imports beets only lazily inside its functions, so these fakes are injected
into ``sys.modules`` and the bridge is driven directly — no real beets install, ffmpeg, network, or
audio files.

The goal is faithfulness, not blind mocking: each fake models the real beets contract the bridge
relies on (confuse's nested config views, ``autotag.tag_album``'s proposal/recommendation shapes,
the ``Distance`` object, ``ImportSession``'s question hooks, the ``album_imported`` plugin-listener
flow, ``search_ids`` ID lookup). A test that fails therefore means the *bridge* is wrong, not that a
mock drifted from beets.
"""

import os
import sys
import types
from types import SimpleNamespace

_BRIDGE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "src",
    "adapters",
    "beets",
    "bridge",
)
if _BRIDGE_DIR not in sys.path:
    sys.path.insert(0, _BRIDGE_DIR)

import bridge  # noqa: E402,F401 — re-exported for tests after the sys.path insert above

# The pinned fixture release (The Beatles — "Love Me Do", 1988), so IDs read like the real ones.
MBID = "22c9f6a3-0569-4c59-b551-cb4a26b0bc3f"
BEETS_VERSION = "2.12.0"


class FakeView:
    """A minimal confuse ConfigView: nested ``view[key]`` access, ``set``, ``get`` (a plain scalar
    read), ``as_str_seq``, and ``as_filename`` (confuse's PATH resolution). Auto-vivifies children so
    ``config["import"]["quiet"].set(...)`` works exactly as the bridge's ``deep_set`` walks the
    overlay."""

    def __init__(self, value=None, filename_error=None):
        if isinstance(value, dict):
            self._scalar = None
            self._data = dict(value)
        else:
            self._scalar = value
            self._data = {}
        self._children = {}
        self._filename_error = filename_error

    def __getitem__(self, key):
        if key not in self._children:
            self._children[key] = FakeView(self._data.get(key), self._filename_error)
        return self._children[key]

    def set(self, value):
        self._scalar = value
        self._data = dict(value) if isinstance(value, dict) else {}

    def get(self):
        """The scalar value at this leaf (confuse's plain read), distinct from ``as_filename``'s
        PATH resolution."""
        return self._scalar

    def as_str_seq(self):
        return [str(item) for item in (self._scalar or [])]

    def as_filename(self):
        if self._filename_error is not None:
            raise self._filename_error
        return self._scalar


class FakeConfig(FakeView):
    """The confuse ``Configuration`` singleton beets exposes as ``beets.config``; adds ``set_file``
    (the bridge makes the user's exact file authoritative before applying the session overlay)."""

    def __init__(self, value=None, filename_error=None):
        super().__init__(value, filename_error)
        self.set_file_calls = []

    def set_file(self, path):
        self.set_file_calls.append(path)


class Distance:
    """beets' autotag ``Distance``: coerces to a float overall score, iterates ``(name, amount)``
    penalty pairs via ``items()``, and carries a per-track ``tracks`` mapping."""

    def __init__(self, value, penalties=(), tracks=None):
        self._value = value
        self._penalties = list(penalties)
        self.tracks = tracks or {}

    def __float__(self):
        return float(self._value)

    def items(self):
        return list(self._penalties)


class FakeAlbumInfo:
    """An ``autotag.AlbumInfo``: a source-tagged ``identifier`` plus the album-level fields the
    bridge serializes for the diff."""

    def __init__(
        self,
        identifier,
        artist="",
        album="",
        year=0,
        media="",
        label="",
        catalognum="",
        country="",
        albumdisambig="",
    ):
        self.identifier = identifier
        self.artist = artist
        self.album = album
        self.year = year
        self.media = media
        self.label = label
        self.catalognum = catalognum
        self.country = country
        self.albumdisambig = albumdisambig


class FakeTrackInfo:
    """An ``autotag.TrackInfo``: the candidate's proposed per-track tags."""

    def __init__(self, title="", index=0):
        self.title = title
        self.index = index


class FakeMatch:
    """An ``autotag.AlbumMatch``: candidate info, overall/per-track distance, the file→track
    ``mapping``, and the leftover ``extra_items`` / ``extra_tracks``."""

    def __init__(self, info, distance, mapping=None, extra_items=(), extra_tracks=()):
        self.info = info
        self.distance = distance
        self.mapping = mapping or {}
        self.extra_items = list(extra_items)
        self.extra_tracks = list(extra_tracks)


class FakeItem:
    """A ``library.Item``: the file's current tags. ``path`` is bytes, as beets stores it."""

    def __init__(self, path=b"", title="", artist="", track=0, length=0.0):
        self.path = path
        self.title = title
        self.artist = artist
        self.track = track
        self.length = length
        # Written by apply_manual_tags:
        self.albumartist = ""
        self.album = ""
        self.year = 0
        self.disc = 0


class FakeAlbum:
    """A ``library.Album``: an imported/incumbent album row."""

    def __init__(self, albumartist="", album="", path=b""):
        self.albumartist = albumartist
        self.album = album
        self.path = path


class FakeLib:
    """A beets ``Library``: answers ``albums(query)`` with the configured incumbents and records the
    query it was asked (so a test can assert the duplicate lookup was built)."""

    def __init__(self, albums=()):
        self._albums = list(albums)
        self.album_queries = []

    def albums(self, query):
        self.album_queries.append(query)
        return list(self._albums)


class Proposal:
    """The third element of ``autotag.tag_album``'s return: the candidate matches."""

    def __init__(self, candidates=()):
        self.candidates = list(candidates)


DEFAULT_CONFIG_DATA = {
    "plugins": ["musicbrainz"],
    "library": "/work/beets/library.db",
    "directory": "/work/library",
}


def install(config_data=None, filename_error=None):
    """Inject a fresh, fully-wired fake ``beets`` package into ``sys.modules`` and return a handle.

    Fresh classes/modules every call means no state leaks between tests (the ``BeetsPlugin``
    listener registry, the ``ImportTask.lookup_candidates`` class stub, the session ``plan``).
    """
    handle = SimpleNamespace()
    handle.config = FakeConfig(
        DEFAULT_CONFIG_DATA if config_data is None else config_data, filename_error
    )
    handle.lib = FakeLib()
    handle.proposal = Proposal()
    handle.tag_calls = []
    handle.from_path = lambda path: FakeItem(path=path)

    # ---- beets.library ----
    library_mod = types.ModuleType("beets.library")

    class Item:
        @staticmethod
        def from_path(path):
            return handle.from_path(path)

    library_mod.Item = Item
    library_mod.Album = FakeAlbum

    # ---- beets.plugins ----
    plugins_mod = types.ModuleType("beets.plugins")
    plugins_mod.load_plugins_calls = []
    # Snapshots of an overlay-forced config leaf (`import.resume`, which SESSION_OVERLAY forces to
    # False) taken AT each load_plugins() call, so a test can pin that the overlay was already
    # applied when plugins loaded — the ordering the bridge documents (a reorder that loaded plugins
    # first would snapshot the pre-overlay value instead).
    plugins_mod.overlay_at_load = []
    plugins_mod.sent = []

    class BeetsPlugin:
        listeners = {"album_imported": []}

    def load_plugins():
        plugins_mod.load_plugins_calls.append(True)
        plugins_mod.overlay_at_load.append(handle.config["import"]["resume"].get())

    def send(event, **kwargs):
        plugins_mod.sent.append((event, kwargs))
        return []

    plugins_mod.BeetsPlugin = BeetsPlugin
    plugins_mod.load_plugins = load_plugins
    plugins_mod.send = send
    handle.BeetsPlugin = BeetsPlugin
    handle.plugins = plugins_mod

    # ---- beets.ui ----
    ui_mod = types.ModuleType("beets.ui")
    ui_mod.opened = []

    def _open_library(config):
        ui_mod.opened.append(config)
        return handle.lib

    ui_mod._open_library = _open_library

    # ---- beets.autotag ----
    autotag_mod = types.ModuleType("beets.autotag")

    class Recommendation:
        none = "none"

    def tag_album(items, search_artist=None, search_name=None, search_ids=None):
        handle.tag_calls.append(
            {
                "items": items,
                "search_artist": search_artist,
                "search_name": search_name,
                "search_ids": search_ids,
            }
        )
        return (None, None, handle.proposal)

    autotag_mod.Recommendation = Recommendation
    autotag_mod.tag_album = tag_album
    handle.autotag = autotag_mod

    # ---- beets.dbcore.query ----
    dbcore_mod = types.ModuleType("beets.dbcore")
    query_mod = types.ModuleType("beets.dbcore.query")

    class MatchQuery:
        def __init__(self, field, value):
            self.field = field
            self.value = value

    class AndQuery:
        def __init__(self, subqueries):
            self.subqueries = subqueries

    query_mod.MatchQuery = MatchQuery
    query_mod.AndQuery = AndQuery
    dbcore_mod.query = query_mod
    handle.MatchQuery = MatchQuery
    handle.AndQuery = AndQuery

    # ---- beets.importer ----
    importer_mod = types.ModuleType("beets.importer")

    class Action:
        ASIS = SimpleNamespace(name="Action.ASIS")
        SKIP = SimpleNamespace(name="Action.SKIP")

    class DuplicateAction:
        REMOVE = SimpleNamespace(name="DuplicateAction.REMOVE")
        KEEP = SimpleNamespace(name="DuplicateAction.KEEP")
        SKIP = SimpleNamespace(name="DuplicateAction.SKIP")

    class ImportTask:
        """A beets ``ImportTask`` for one album. ``lookup_candidates`` is the seam the bridge stubs
        for as-is/manual imports; by default the test pre-populates ``candidates`` directly (as a
        real matcher lookup would)."""

        def __init__(self, items=(), candidates=(), album=None, duplicates=()):
            self.items = list(items)
            self.candidates = list(candidates)
            self.album = album
            self.duplicates = list(duplicates)
            self.cur_artist = "unset"
            self.cur_album = "unset"
            self.rec = "unset"

        def lookup_candidates(self, search_ids):
            return None

    class ImportSession:
        """beets' ``ImportSession``. Its ``run()`` plays the configured tasks through the very
        question hooks the bridge overrides — ``lookup_candidates``, ``choose_match``,
        ``get_duplicate_action`` — and fires the ``album_imported`` event to every registered
        plugin listener, exactly as beets' pipeline does. So the bridge's own answers (not a
        fabricated flag) drive the post-run branch state."""

        plan = []

        def __init__(self, lib, loghandler, paths, query):
            self.lib = lib
            self.loghandler = loghandler
            self.paths = paths
            self.query = query

        def run(self):
            for task in list(type(self).plan):
                task.lookup_candidates([])
                choice = self.choose_match(task)
                if choice is Action.SKIP:
                    continue
                if task.duplicates:
                    if self.get_duplicate_action(task, task.duplicates) is DuplicateAction.SKIP:
                        continue
                for listener in list(BeetsPlugin.listeners.get("album_imported", [])):
                    listener(self.lib, task.album)

    importer_mod.Action = Action
    importer_mod.DuplicateAction = DuplicateAction
    importer_mod.ImportTask = ImportTask
    importer_mod.ImportSession = ImportSession
    handle.importer = importer_mod
    handle.Action = Action
    handle.DuplicateAction = DuplicateAction
    handle.ImportTask = ImportTask
    handle.ImportSession = ImportSession

    # ---- beets (package root) ----
    beets_mod = types.ModuleType("beets")
    beets_mod.__version__ = BEETS_VERSION
    beets_mod.config = handle.config
    beets_mod.plugins = plugins_mod
    beets_mod.library = library_mod
    beets_mod.ui = ui_mod
    beets_mod.autotag = autotag_mod
    beets_mod.dbcore = dbcore_mod
    beets_mod.importer = importer_mod
    handle.beets = beets_mod

    for name, module in {
        "beets": beets_mod,
        "beets.library": library_mod,
        "beets.plugins": plugins_mod,
        "beets.ui": ui_mod,
        "beets.autotag": autotag_mod,
        "beets.dbcore": dbcore_mod,
        "beets.dbcore.query": query_mod,
        "beets.importer": importer_mod,
    }.items():
        sys.modules[name] = module

    return handle


def make_task(items=(), candidates=(), album=None, duplicates=()):
    """Convenience task builder that resolves the currently-installed fake ``ImportTask`` (so the
    bridge's class-level ``lookup_candidates`` stub takes effect on it)."""
    return sys.modules["beets.importer"].ImportTask(
        items=items, candidates=candidates, album=album, duplicates=duplicates
    )


def set_plan(*tasks):
    """Set the tasks the installed session's ``run()`` will play."""
    sys.modules["beets.importer"].ImportSession.plan = list(tasks)
