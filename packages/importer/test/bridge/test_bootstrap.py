"""The bridge's startup plumbing: the private contract channel, config bootstrap, and the
session-overlay merge that guarantees non-interactivity and a MusicBrainz candidate source."""

import json
import os
import sys
import tempfile
import unittest

import fakes
from fakes import bridge


class ContractChannelTest(unittest.TestCase):
    """``claim_stdout`` must reserve a private duplicate of real stdout for the one JSON document and
    divert fd 1 (everything beets and its subprocesses print) to stderr, so nothing corrupts the
    contract channel."""

    def test_claim_stdout_reserves_the_original_stdout_and_diverts_fd_1_to_stderr(self):
        original_channel = bridge._contract_channel
        saved_stdout = sys.stdout
        saved_fd1 = os.dup(1)
        tmp_path = tempfile.mkstemp()[1]
        try:
            capture_fd = os.open(tmp_path, os.O_WRONLY)
            os.dup2(capture_fd, 1)  # fd 1 now points at the capture file
            os.close(capture_fd)

            bridge.claim_stdout()
            # The private channel is a dup of fd 1 taken before it was repointed, so it still
            # reaches the capture file; fd 1 itself now aliases stderr.
            bridge.emit({"status": "ping"})

            self.assertIs(sys.stdout, sys.stderr)
        finally:
            os.dup2(saved_fd1, 1)
            os.close(saved_fd1)
            sys.stdout = saved_stdout
            if bridge._contract_channel is not None and bridge._contract_channel is not original_channel:
                bridge._contract_channel.close()
            bridge._contract_channel = original_channel

        with open(tmp_path) as handle:
            written = handle.read()
        os.unlink(tmp_path)
        self.assertEqual(json.loads(written), {"status": "ping"})

    def test_emit_writes_one_newline_terminated_json_document(self):
        import io

        original_channel = bridge._contract_channel
        channel = io.StringIO()
        bridge._contract_channel = channel
        try:
            bridge.emit({"status": "valid", "kind": "x"})
        finally:
            bridge._contract_channel = original_channel
        self.assertEqual(channel.getvalue(), '{"status": "valid", "kind": "x"}\n')


class BootstrapTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.config_path = os.path.join(self._dir.name, "config.yaml")
        with open(self.config_path, "w") as handle:
            handle.write("directory: /x\n")

    def test_a_missing_config_file_is_refused_before_any_beets_work(self):
        fakes.install()
        missing = os.path.join(self._dir.name, "does-not-exist.yaml")
        with self.assertRaises(bridge.BridgeRefusal) as caught:
            bridge.bootstrap(missing)
        self.assertEqual(caught.exception.kind, "config-not-found")

    def test_bootstrap_points_beetsdir_at_the_config_directory(self):
        fakes.install()
        saved = os.environ.get("BEETSDIR")

        def restore():
            if saved is None:
                os.environ.pop("BEETSDIR", None)
            else:
                os.environ["BEETSDIR"] = saved

        self.addCleanup(restore)
        bridge.bootstrap(self.config_path)
        self.assertEqual(os.environ["BEETSDIR"], self._dir.name)

    def test_bootstrap_makes_the_users_exact_file_authoritative(self):
        handle = fakes.install()
        bridge.bootstrap(self.config_path)
        self.assertEqual(handle.config.set_file_calls, [os.path.abspath(self.config_path)])

    def test_the_musicbrainz_candidate_source_is_injected_when_the_plugin_list_omits_it(self):
        """A plugin list written for an older beets carried no `musicbrainz` plugin; the bridge
        injects it into the effective list so a candidate source always loads."""
        handle = fakes.install(config_data={"plugins": ["chroma"]})
        config = bridge.bootstrap(self.config_path)
        self.assertEqual(config["plugins"].as_str_seq(), ["chroma", "musicbrainz"])

    def test_the_musicbrainz_source_is_not_duplicated_when_already_present(self):
        handle = fakes.install(config_data={"plugins": ["musicbrainz", "chroma"]})
        config = bridge.bootstrap(self.config_path)
        self.assertEqual(config["plugins"].as_str_seq(), ["musicbrainz", "chroma"])

    def test_bootstrap_applies_the_session_overlay_before_loading_plugins(self):
        """The overlay must win over the user's file, which requires it to be applied BEFORE
        load_plugins() so plugins see the merged view. The load_plugins fake snapshots an
        overlay-forced leaf (`import.resume`, forced to False) at call time; that the snapshot shows
        the forced value proves the overlay was already visible when plugins loaded — a reorder or a
        dropped `deep_set(config, …)` would leave the pre-overlay value here instead."""
        handle = fakes.install()
        bridge.bootstrap(self.config_path)
        self.assertEqual(handle.plugins.load_plugins_calls, [True])
        self.assertEqual(handle.plugins.overlay_at_load, [False])
        self.assertIn("pluginload", [event for event, _ in handle.plugins.sent])


class DeepSetTest(unittest.TestCase):
    """The overlay merge recurses into nested sections and force-sets each leaf, so the forced
    session keys (never interactive/resuming/incremental) win over the user's file."""

    def test_deep_set_recurses_into_sections_and_sets_scalar_leaves(self):
        view = fakes.FakeView(
            {"import": {"resume": True}, "threaded": True}
        )
        bridge.deep_set(view, {"import": {"resume": False}, "threaded": False})
        self.assertEqual(view["import"]["resume"].get(), False)
        self.assertEqual(view["threaded"].get(), False)


if __name__ == "__main__":
    unittest.main()
