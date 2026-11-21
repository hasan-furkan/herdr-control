"""Collector regression tests. Run with python -m unittest discover -s mod/collector."""

import ast
from contextlib import closing, redirect_stdout
from datetime import datetime, timezone
from io import StringIO
import json
import os
from pathlib import Path
import runpy
import sqlite3
import stat
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import ModuleType
import unittest
from unittest.mock import patch

import collect


def varint(value):
    out = bytearray()
    while value >= 128:
        out.append((value & 127) | 128)
        value >>= 7
    out.append(value)
    return bytes(out)


def integer(field, value):
    return varint(field << 3) + varint(value)


def message(field, body):
    return varint((field << 3) | 2) + varint(len(body)) + body


def metadata(cache=True):
    tokens = integer(1, 1320) + integer(2, 2615) + integer(3, 403)
    if cache:
        tokens += integer(5, 6981)
    context = message(10, integer(1, 13432) + integer(4, 256000))
    return message(1, message(4, tokens) + message(9, context))


class CollectorTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name)
        self.cache = self.home / "cache"
        self.now = 1795197207

    def test_ssh_config_hosts_collect_only_literal_aliases(self):
        config = self.home / ".ssh" / "config"
        config.parent.mkdir(parents=True)
        config.write_text("Host *\n  HostName ignored.example\nHost windows desktop\n HostName workstation-01.tailnet.ts.net\nHost 100.64.0.8\n HostName 100.64.0.8\n", encoding="utf-8")
        self.assertEqual(collect.collect_ssh_hosts(self.home), [
            {"alias": "windows", "hostname": "workstation-01.tailnet.ts.net"},
            {"alias": "desktop", "hostname": "workstation-01.tailnet.ts.net"},
            {"alias": "100.64.0.8", "hostname": "100.64.0.8"},
        ])

    def write_json(self, relative_path, data):
        path = self.home / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")
        return path

    def test_cache_write_is_private_and_replaces_atomically(self):
        path = self.cache / "usage-cache.json"
        self.assertTrue(collect._write_json_atomic(path, {"first": 1}))
        self.assertTrue(collect._write_json_atomic(path, {"second": 2}))
        self.assertEqual(collect._read_cache(path), {"second": 2})
        self.assertEqual(list(self.cache.iterdir()), [path])
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(self.cache.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.cache.chmod(0o755)
            self.assertEqual(collect._read_cache(path), {"second": 2})
            self.assertEqual(stat.S_IMODE(self.cache.stat().st_mode), 0o700)
            with patch.object(collect.os, "geteuid", return_value=self.cache.stat().st_uid + 1):
                self.assertFalse(collect._write_json_atomic(path, {}))

    @unittest.skipIf(os.name == "nt", "symlinks may require Windows privileges")
    def test_cache_refuses_linked_directory_and_target(self):
        victim = self.write_json("elsewhere/usage-cache.json", {"keep": True})
        self.cache.symlink_to(victim.parent, target_is_directory=True)
        linked = self.cache / victim.name
        self.assertFalse(collect._write_json_atomic(linked, {}))
        self.assertIsNone(collect._read_cache(linked))
        self.cache.unlink()
        self.cache.mkdir()
        linked.symlink_to(victim)
        self.assertFalse(collect._write_json_atomic(linked, {}))
        self.assertIsNone(collect._read_cache(linked))
        self.assertTrue(linked.is_symlink())
        self.assertEqual(json.loads(victim.read_bytes()), {"keep": True})

        # The old predictable temporary filename is ignored.
        linked.unlink()
        (self.cache / (victim.name + ".tmp")).symlink_to(victim)
        self.assertTrue(collect._write_json_atomic(linked, {"safe": True}))
        self.assertEqual(json.loads(victim.read_bytes()), {"keep": True})

    @unittest.skipIf(os.name == "nt", "symlinks may require Windows privileges")
    def test_linked_agent_root_and_fixed_inputs_are_skipped(self):
        root = self.home / ".claude"
        root.mkdir()
        target = self.write_json("elsewhere/session.jsonl", {})
        (root / "projects").symlink_to(target.parent, target_is_directory=True)
        budget = collect._ScanBudget("claude", [])
        self.assertEqual(list(collect._iter_recent_files(root / "projects", ".jsonl", 0, budget)), [])
        limits = self.write_json("elsewhere/limits.json", {"at": self.now})
        (root / "limits.json").symlink_to(limits)
        self.assertIsNone(collect._fresh_limits_file(root / "limits.json", self.now, 3600))
        with self.assertRaises(OSError):
            collect._open_input(root / "projects" / target.name)

    def test_remote_profile_only_invokes_host_collectors(self):
        data = self.run_remote_profile(collect)
        self.assertEqual(
            set(data), {"version", "generated_at", "system", "ports", "docker", "network", "errors", "notes"},
        )
        self.assertEqual(data["system"], {"hostname": "peer"})
        self.assertIsNone(data["docker"])
        self.assertEqual(data["notes"], [])

    def run_remote_profile(self, collector):
        stream = StringIO()
        with patch.object(sys, "argv", ["collect.py", "--remote"]), redirect_stdout(stream), \
                patch.object(collector, "_now_iso", return_value="2026-11-20T12:00:00Z"), \
                patch.object(collector, "_get_cache_dir", return_value=self.cache), \
                patch.object(collector, "collect_system", return_value={"hostname": "peer"}), \
                patch.object(collector, "_find_tailscale", return_value="tailscale"), \
                patch.object(collector, "_run", return_value=subprocess.CompletedProcess([], 0, "{}", "")) as run, \
                patch.object(collector, "collect_ports", return_value=[]), \
                patch.object(collector, "collect_docker", return_value=None), \
                patch.object(collector, "collect_network", return_value=None), \
                patch.object(collector, "collect_tailscale", side_effect=AssertionError), \
                patch.object(collector, "collect_usage", side_effect=AssertionError), \
                patch.object(collector, "collect_limits", side_effect=AssertionError), \
                patch.object(collector, "collect_installed", side_effect=AssertionError), \
                patch.object(collector, "collect_remote", side_effect=AssertionError):
            self.assertEqual(collector.main(), 0)
        run.assert_called_once_with(["tailscale", "serve", "status", "--json"], timeout=collector.CMD_TIMEOUT)
        return json.loads(stream.getvalue())

    def test_cpu_percent_uses_counter_deltas(self):
        before = (1000, 900)
        self.assertEqual(collect._cpu_percent(before, (1100, 996)), 4.0)
        self.assertEqual(collect._cpu_percent(before, (1000, 900)), 0.0)
        self.assertEqual(collect._cpu_percent(before, (50, 10)), 0.0)
        self.assertEqual(collect._cpu_percent(before, (1100, 1005)), 0.0)
        self.assertEqual(collect._cpu_percent(before, (1100, 895)), 100.0)

    def test_used_memory_subtracts_available_bytes(self):
        gib = 1024 ** 3
        self.assertEqual(collect._used_memory(32 * gib, 24 * gib), 8 * gib)
        self.assertEqual(collect._used_memory(32 * gib, 33 * gib), 0)

    def test_proc_stat_ignores_guest_fields_and_counts_io_wait_as_idle(self):
        before = collect._parse_proc_stat("cpu 100 20 30 500 10 4 5 6 90 15\n")
        after = collect._parse_proc_stat("cpu 115 23 34 530 15 4 6 8 104 17\n")
        self.assertEqual(before, (675, 510))
        self.assertEqual(collect._cpu_percent(before, after), 41.7)
        self.assertEqual(collect._parse_proc_stat("cpu 1 2 3 4"), (10, 4))
        with self.assertRaises(ValueError):
            collect._parse_proc_stat("cpu0 1 2 3 4")

    def test_vm_stat_counts_active_wired_and_compressor_pages(self):
        report = (
            "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n"
            "Pages free: 100.\n"
            "Pages active: 200.\n"
            "Pages inactive: 300.\n"
            "Pages speculative: 400.\n"
            "Pages wired down: 500.\n"
            "Pages stored in compressor: 600.\n"
            "Pages occupied by compressor: 70.\n"
        )
        self.assertEqual(collect._parse_vm_stat(report), 770 * 16384)

    def test_command_caps_combined_output(self):
        with patch.object(collect, "MAX_COMMAND_BYTES", 64):
            result = collect._run([sys.executable, "-I", "-c", "import sys;print('ok');print('err',file=sys.stderr)"])
            self.assertEqual((result.returncode, result.stdout.strip(), result.stderr.strip()), (0, "ok", "err"))
            with self.assertRaises(collect._CommandOutputLimit):
                collect._run([sys.executable, "-I", "-c", "import os;os.write(1,b'a'*48);os.write(2,b'b'*48)"])
        with self.assertRaises(subprocess.TimeoutExpired):
            collect._run([sys.executable, "-I", "-c", "import time;time.sleep(30)"], timeout=0.2)

    def claude_line(self, tokens, timestamp="2026-11-20T12:00:00Z"):
        return json.dumps({
            "type": "assistant", "timestamp": timestamp,
            "message": {"model": "claude", "usage": {"input_tokens": tokens}},
        }).encode() + b"\n"

    def test_claude_counts_lines_beyond_the_old_cap(self):
        path = self.home / "long.jsonl"
        path.write_bytes(self.claude_line(3) * 20_001 + self.claude_line(8))
        cache, errors, notes = {}, [], []
        rows = collect._collect_jsonl_provider(
            self.home, "claude", collect._parse_claude_file, cache, 0, "", errors, notes,
        )
        self.assertEqual(sum(row["input"] for row in rows), 60_011)
        self.assertEqual(errors, [])
        self.assertEqual(notes, [])
        self.assertEqual(len(cache), 1)

    def test_usage_rebuilds_a_p6_cache_even_when_the_source_file_is_unchanged(self):
        path = self.home / ".claude" / "projects" / "old-cache.jsonl"
        path.parent.mkdir(parents=True)
        timestamp = datetime.now(timezone.utc).isoformat()
        day = collect._parse_iso_to_epoch(timestamp)[1]
        path.write_bytes(self.claude_line(3, timestamp) + self.claude_line(5, timestamp))
        st = path.stat()
        key = collect._cache_key("claude", path)
        cache_path = self.cache / "usage-cache.json"
        self.assertTrue(collect._write_json_atomic(cache_path, {"version": 2, "files": {
            key: {"size": st.st_size, "mtime_ns": st.st_mtime_ns, "rows": [
                {"date": day, "provider": "claude", "input": 3},
            ]},
        }}))
        errors = []
        with patch.object(collect.Path, "home", return_value=self.home):
            self.assertEqual(collect.collect_usage(self.cache, errors)["days"][0]["input"], 8)
        self.assertEqual(errors, [])
        self.assertEqual(collect._read_cache(cache_path)["version"], collect.USAGE_CACHE_VERSION)

    def test_usage_recovers_lines_skipped_by_the_old_byte_limit(self):
        path = self.home / ".claude" / "projects" / "large.jsonl"
        path.parent.mkdir(parents=True)
        timestamp = datetime.now(timezone.utc).isoformat()
        line = json.loads(self.claude_line(8, timestamp))
        line["attachment"] = "A" * (1024 ** 2)
        path.write_text(json.dumps(line) + "\n", encoding="utf-8")
        st = path.stat()
        key = collect._cache_key("claude", path)
        cache_path = self.cache / "usage-cache.json"
        self.assertTrue(collect._write_json_atomic(cache_path, {"version": 3, "files": {
            key: {"stamp": [st.st_size, st.st_mtime_ns], "rows": [], "skipped": 1},
        }}))
        errors, notes = [], []
        with patch.object(collect.Path, "home", return_value=self.home):
            self.assertEqual(collect.collect_usage(self.cache, errors, notes=notes)["days"][0]["input"], 8)
        self.assertEqual((errors, notes), ([], []))

    def test_claude_budget_retries_interrupted_file_and_counts_all_complete_files(self):
        first, second, third = (self.home / f"{name}.jsonl" for name in ("a", "b", "c"))
        first.write_bytes(self.claude_line(3))
        second.write_bytes(self.claude_line(5) * 2)
        third.write_bytes(self.claude_line(7) * 3)
        cache, errors, notes = {}, [], []
        log_lines = collect._ScanBudget.log_lines

        def interrupt_after_one_line(budget, path):
            lines = log_lines(budget, path)
            try:
                yield next(lines)
                budget.deadline = 0
                yield from lines
            finally:
                lines.close()

        def parse(path, cutoff_date, budget):
            if Path(path) == second:
                with patch.object(collect._ScanBudget, "log_lines", interrupt_after_one_line):
                    return collect._parse_claude_file(path, cutoff_date, budget)
            return collect._parse_claude_file(path, cutoff_date, budget)

        def run(parser):
            return collect._collect_jsonl_provider(self.home, "claude", parser, cache, 0, "", errors, notes)

        self.assertEqual(sum(row["input"] for row in run(parse)), 3)
        self.assertEqual(set(cache), {collect._cache_key("claude", first)})
        self.assertEqual(notes, ["claude: 2 files pending"])
        self.assertEqual(errors, [])

        notes.clear()
        with patch.object(collect, "_parse_claude_file", wraps=collect._parse_claude_file) as parser:
            self.assertEqual(sum(row["input"] for row in run(parser)), 34)
            self.assertEqual([Path(call.args[0]) for call in parser.call_args_list], [second, third])
        self.assertEqual(errors, [])
        self.assertEqual(notes, [])
        self.assertEqual(len(cache), 3)

        with patch.object(collect._ScanBudget, "expired", return_value=True):
            self.assertEqual(sum(row["input"] for row in run(parse)), 34)
        self.assertEqual(errors, [])
        self.assertEqual(notes, [])

    def test_jsonl_oversized_lines_are_counted_and_skipped_without_losing_following_rows(self):
        path = self.home / "test.jsonl"
        path.write_bytes(self.claude_line(3) + b"a" * 700 + b"\n" + self.claude_line(5))
        errors, notes, cache = [], [], {}
        with patch.object(collect, "MAX_LOG_LINE_BYTES", 256):
            for _ in range(2):
                notes.clear()
                rows = collect._collect_jsonl_provider(
                    self.home, "claude", collect._parse_claude_file, cache, 0, "", errors, notes,
                )
                self.assertEqual(sum(row["input"] for row in rows), 8)
                self.assertEqual(notes, ["claude: 1 oversized log line skipped"])
                self.assertEqual(errors, [])

    def test_agy_reads_more_than_the_old_database_cap(self):
        root = self.home / "agy"
        conv = root / "conversations"
        conv.mkdir(parents=True)
        for n in range(65):
            (conv / f"{n}.db").touch()
        cache, errors, notes = {}, [], []
        with patch.object(collect, "_read_agy_db", return_value=[{"input": 1}]) as read:
            rows, _ = collect._collect_antigravity_sessions(root, cache, 0, "", self.now, errors, notes)
        self.assertEqual(read.call_count, 65)
        self.assertEqual(rows, [{"input": 1, "project": ""}] * 65)
        self.assertEqual(len(cache), 65)
        self.assertEqual(errors, [])
        self.assertEqual(notes, [])

    def test_agy_skips_oversized_blob_and_retries_interrupted_db(self):
        root = self.home / "agy"
        db = root / "conversations" / "usage.db"
        db.parent.mkdir(parents=True)
        with closing(sqlite3.connect(db)) as conn:
            conn.execute("CREATE TABLE gen_metadata (data BLOB)")
            conn.executemany("INSERT INTO gen_metadata VALUES (?)", [
                (metadata(),), (bytes(1024),), (None,), (metadata(),),
            ])
            conn.commit()
        cache, errors, notes = {}, [], []
        args = (root, cache, 0, "", self.now, errors, notes)
        read_db = collect._read_agy_db

        def interrupt(path, date, budget):
            decode = collect._decode_agy_metadata

            def decode_one(blob):
                budget.deadline = 0
                return decode(blob)

            with patch.object(collect, "_decode_agy_metadata", side_effect=decode_one):
                return read_db(path, date, budget)

        with patch.object(collect, "MAX_LOG_LINE_BYTES", 256):
            with patch.object(collect, "_read_agy_db", side_effect=interrupt):
                rows, _ = collect._collect_antigravity_sessions(*args)
            self.assertEqual(rows, [])
            self.assertEqual(cache, {})
            self.assertEqual(notes, ["antigravity: 1 files pending"])
            self.assertEqual(errors, [])

            for _ in range(2):
                notes.clear()
                rows, _ = collect._collect_antigravity_sessions(*args)
                self.assertEqual(rows[0]["input"], 5230)
                self.assertEqual(notes, ["antigravity: 1 oversized SQLite record skipped"])
                self.assertEqual(errors, [])

    def test_serve_allowlist_excludes_text_paths_and_diagnostics(self):
        data = {
            "TCP": {"443": {"HTTPS": True}, "1234": {"TCPForward": "[::1]:8080"},
                    "5555": {"TCPForward": "invalid"}, "99999": {"HTTP": True}},
            "Web": {"host.ts.net:443": {"Handlers": {
                "/text": {"Text": "private response"},
                "/files": {"Path": "/private/files"},
                "/proxy": {"Proxy": "https://backend:8443/private?token=hidden"},
            }}},
            "AllowFunnel": {"host.ts.net:443": True},
        }
        errors = []
        with patch.object(collect, "_run", return_value=subprocess.CompletedProcess([], 0, json.dumps(data), "")):
            routes, funnel = collect._collect_serve("tailscale", errors)
        self.assertEqual(routes, [
            {"port": 1234, "proto": "tcp", "target": "[::1]:8080"},
            {"port": 5555, "proto": "tcp", "target": ""},
            {"port": 443, "proto": "https", "target": ""},
            {"port": 443, "proto": "https", "target": "backend:8443"},
        ])
        self.assertEqual(funnel, [443])
        with patch.object(collect, "_run", return_value=subprocess.CompletedProcess([], 1, "", "private diagnostic")):
            self.assertEqual(collect._collect_serve("tailscale", errors), ([], []))
        self.assertEqual(errors, ["tailscale serve: exited 1"])
        self.assertLessEqual(len(collect._short_err("x" * 500, RuntimeError("private diagnostic"))), 200)

    def test_bootstrap_requires_isolation_and_preserves_arguments(self):
        source = Path(collect.__file__).resolve()
        pack = runpy.run_path(str(source.parents[3] / "scripts" / "pack-collector.py"))
        build = pack["build_bootstrap"]
        boot = build(b"import sys; print(sys.argv[1])")
        result = subprocess.run([sys.executable, "-I", "-c", boot, "--remote"],
                                cwd=self.home, capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout.strip(), "--remote")
        result = subprocess.run([sys.executable, "-c", boot], cwd=self.home, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires python -I", result.stderr)
        raw = source.read_bytes()
        ast.parse(raw, feature_version=(3, 9))
        boot = build(raw)
        ast.parse(boot, feature_version=(3, 9))
        self.assertLess(len(boot), 26_000)
        result = subprocess.run([sys.executable, "-I", "-c", boot, "--help"],
                                cwd=self.home, capture_output=True, text=True, check=True)
        self.assertIn("--remote", result.stdout)

    def test_minified_source_compiles_and_preserves_remote_profile(self):
        source = Path(collect.__file__).resolve()
        pack = runpy.run_path(str(source.parents[3] / "scripts" / "pack-collector.py"))
        minified = pack["minify_source"](source.read_bytes())
        ast.parse(minified, feature_version=(3, 9))
        collector = ModuleType("minified_collect")
        exec(compile(minified, "collect.py", "exec"), vars(collector))
        self.assertIsNone(collector.__doc__)
        self.assertIsNone(collector._run.__doc__)
        self.assertEqual(self.run_remote_profile(collector), self.run_remote_profile(collect))

    def test_protobuf_fields_and_missing_cache(self):
        self.assertEqual(collect._decode_agy_metadata(metadata()), {
            "model": 1320,
            "input": 2615,
            "output": 403,
            "cache_read": 6981,
            "context_tokens": 13432,
            "context_window": 256000,
        })
        self.assertNotIn("cache_read", collect._decode_agy_metadata(metadata(cache=False)))
        self.assertEqual(collect._decode_agy_metadata(b"\x0a\xff"), {})
        broken_child = message(1, message(4, b"\x80") + message(9, message(10, integer(1, 13432))))
        self.assertEqual(collect._decode_agy_metadata(broken_child), {"context_tokens": 13432})

    def test_agy_db_uses_mtime_day_and_keeps_live_status(self):
        root = self.home / "antigravity"
        path = root / "conversations" / "recent #1.db"
        path.parent.mkdir(parents=True)
        with closing(sqlite3.connect(path)) as conn:
            conn.execute("CREATE TABLE gen_metadata (idx INTEGER, data BLOB)")
            conn.executemany("INSERT INTO gen_metadata VALUES (?, ?)", [(1, metadata()), (2, metadata(False))])
            conn.commit()
        os.utime(path, (self.now, self.now))
        cutoff_day = collect._epoch_to_local_date(self.now)
        cache = {}
        args = (root, cache, self.now - 86400, cutoff_day, self.now, [], [])
        rows, live = collect._collect_antigravity_sessions(*args)
        self.assertEqual(rows, [{
            "date": cutoff_day, "provider": "antigravity", "model": "1320",
            "input": 5230, "output": 806, "cache_read": 6981, "cache_write": 0,
            "sessions": 1, "active_s": 0, "estimated": True, "project": "",
        }])
        self.assertEqual(live[0]["provider"], "antigravity")
        with patch.object(collect, "_read_agy_db", side_effect=AssertionError("unchanged database reread")):
            self.assertEqual(collect._collect_antigravity_sessions(*args), (rows, live))
        with patch.object(collect, "_read_agy_db", side_effect=sqlite3.OperationalError("database is locked")):
            self.assertEqual(collect._collect_antigravity_sessions(root, {}, *args[2:]), ([], live))

    def test_codex_limits_use_latest_log_and_cache_before_expiration(self):
        path = self.home / ".codex" / "sessions" / "2026" / "session.jsonl"
        path.parent.mkdir(parents=True)
        reset = self.now + 3600
        windows = {"primary": {"used_percent": 13, "window_minutes": 300, "resets_at": reset},
                   "secondary": {"used_percent": "54.5", "window_minutes": 10080, "resets_at": self.now - 1}}
        record = {"payload": {"wrapped": [{"rate_limits": windows}]}}
        path.write_text('{"rate_limits": null}\n' + json.dumps(record) + '\n{"rate_limits":',
                        encoding="utf-8")
        os.utime(path, (self.now, self.now))
        self.assertEqual(collect.codex_limits(self.home, self.cache, self.now), {
            "five": {"remaining": 87.0, "resets_at": reset, "window_minutes": 300},
            "week": {"remaining": 100, "resets_at": None, "window_minutes": 10080},
            "source": "file", "read_at": self.now,
        })
        stamp = collect._read_cache(self.cache / "codex-limits.json")["newest"][0]
        self.assertRegex(stamp, r"^codex::[0-9a-f]{64}$")
        self.assertNotIn(str(path), stamp)
        with patch.object(collect, "_read_codex_limits", side_effect=AssertionError("unchanged log reread")):
            expired = collect.codex_limits(self.home, self.cache, reset + 1)
            self.assertEqual(expired["five"], {"remaining": 100, "resets_at": None, "window_minutes": 300})
        windows["primary"]["used_percent"] = 30
        path.write_text(json.dumps(record), encoding="utf-8")
        os.utime(path, (self.now + 1, self.now + 1))
        self.assertEqual(collect.codex_limits(self.home, self.cache, self.now + 1)["five"]["remaining"], 70.0)

    def test_codex_limits_classify_free_and_paid_windows_by_duration(self):
        path = self.home / ".codex" / "sessions" / "session.jsonl"
        path.parent.mkdir(parents=True)
        free = {"rate_limits": {"primary": {"used_percent": 73, "window_minutes": 43200, "resets_at": self.now + 60}, "secondary": None}}
        path.write_text(json.dumps(free) + "\n", encoding="utf-8")
        os.utime(path, (self.now, self.now))
        row = collect._read_codex_limits([(path, None, int(self.now * 1e9))], collect._ScanBudget("limits.codex", []))
        self.assertEqual(row["month"]["remaining"], 27.0)
        self.assertIsNone(row["five"])
        self.assertIsNone(row["week"])

        paid = {"rate_limits": {"primary": {"used_percent": 10, "window_minutes": 300}, "secondary": {"used_percent": 40, "window_minutes": 10080}}}
        path.write_text(json.dumps(paid) + "\n", encoding="utf-8")
        os.utime(path, (self.now + 1, self.now + 1))
        row = collect._read_codex_limits([(path, None, int((self.now + 1) * 1e9))], collect._ScanBudget("limits.codex", []))
        self.assertEqual((row["five"]["remaining"], row["week"]["remaining"]), (90.0, 60.0))

    def test_opencode_limits_use_the_newest_quota_error_and_only_emit_safe_fields(self):
        root = self.home / ".local" / "share" / "opencode" / "log"
        root.mkdir(parents=True)
        path = root / "opencode.log"
        older = 'ERROR  2026-11-19T12:00:00Z QuotaExceeded: OpenCode Go usage limit reached (weekly, resets in 3d).'
        latest = ('2026-11-20T12:00:00Z level=ERROR cause="AI.Error: OpenCode Go usage limit reached '
                  '(monthly, resets in 6d). https://example.com/workspace/private-id"')
        info = latest.replace("level=ERROR", "level=INFO").replace("monthly", "weekly")
        path.write_text(f"{older}\n{latest}\n{info}\n", encoding="utf-8")
        epoch, _ = collect._parse_iso_to_epoch("2026-11-20T12:00:00Z")
        self.assertEqual(collect.collect_limits(self.cache, [], self.home, epoch)["opencode"], {
            "reached": {"window": "monthly", "resets_at": epoch + 6 * 86400},
            "source": "log",
        })
        self.assertIsNone(collect.opencode_limits(self.home, epoch + 6 * 86400))
        path.write_text(f"{older}\n{latest.replace('monthly', 'unknown')}\n", encoding="utf-8")
        self.assertIsNone(collect.opencode_limits(self.home, epoch))
        path.write_text(info, encoding="utf-8")
        self.assertIsNone(collect.opencode_limits(self.home, epoch))
        path.unlink()
        self.assertIsNone(collect.opencode_limits(self.home, epoch))

    def test_opencode_limit_tail_is_bounded_and_parses_compound_duration(self):
        path = self.home / "opencode.log"
        line = "ERROR  2026-11-20T12:00:00+00:00 OpenCode Go usage limit reached (5-hour, resets in 1h 30m)."
        path.write_bytes(f"{line}\n{'x' * 200}\n{line}\n".encode())
        epoch, _ = collect._parse_iso_to_epoch("2026-11-20T12:00:00Z")
        self.assertEqual(collect._parse_opencode_limit(collect._newest_log_lines(path, 128), epoch), {
            "reached": {"window": "5-hour", "resets_at": epoch + 5400}, "source": "log",
        })
        self.assertIsNone(collect._parse_opencode_limit(collect._newest_log_lines(path, 40), epoch))

    def test_limits_file_staleness_and_windows_default(self):
        limits = {"five": {"remaining": 87.0, "resets_at": None}, "week": None}
        claude = self.write_json(".claude/limits-claude.json", {"at": self.now - 6 * 3600 + 1, "claude": limits})
        agy = self.write_json(".claude/limits.json", {"at": self.now - 3599, "agy": {"gemini": limits}})
        with patch.object(collect, "IS_WINDOWS", True), patch.dict(os.environ, {}, clear=True), \
                patch.object(collect, "_run", side_effect=AssertionError("unexpected agy probe")):
            data = collect.collect_limits(self.cache, [], self.home, self.now)
            self.assertEqual(data["claude"]["five"], limits["five"])
            self.assertEqual(data["antigravity"]["source"], "file")
            self.assertIsNone(data["codex"])
            self.assertEqual(collect.collect_limits(self.cache, [], self.home, self.now + 1),
                             dict.fromkeys(collect.LIMIT_PROVIDERS))
            claude.unlink()
            agy.unlink()
            self.assertEqual(collect.collect_limits(self.cache, [], self.home, self.now),
                             dict.fromkeys(collect.LIMIT_PROVIDERS))

    def test_agy_cache_ttl_constants_and_function(self):
        self.assertEqual(collect.AGY_CACHE_TTL_WINDOWS_S, 3600)
        self.assertEqual(collect.AGY_CACHE_TTL_UNIX_S, 300)
        self.assertEqual(collect.AGY_PROBE_COOLDOWN_S, 60)
        self.assertEqual(collect.agy_cache_ttl_seconds(is_windows=True), 3600)
        self.assertEqual(collect.agy_cache_ttl_seconds(is_windows=False), 300)

    def test_agy_opt_in_probe_caches_failures(self):
        with patch.object(collect, "IS_WINDOWS", True), patch.dict(os.environ, {"HERDR_CONTROL_AGY_PROBE": "1"}), \
                patch.object(collect.shutil, "which", return_value="agy"), \
                patch.object(collect, "_run", side_effect=OSError) as run:
            self.assertIsNone(collect.collect_limits(self.cache, [], self.home, self.now)["antigravity"])
            self.assertIsNone(collect.collect_limits(self.cache, [], self.home, self.now + 3599)["antigravity"])
            self.assertEqual(run.call_count, 1)
            collect.collect_limits(self.cache, [], self.home, self.now + 3600)
            self.assertEqual(run.call_count, 2)

    def test_agy_probe_cooldown_on_unix(self):
        with patch.object(collect, "IS_WINDOWS", False), \
                patch.object(collect.shutil, "which", return_value="agy"), \
                patch.object(collect, "_run", side_effect=OSError) as run:
            self.assertIsNone(collect.collect_limits(self.cache, [], self.home, self.now)["antigravity"])
            self.assertIsNone(collect.collect_limits(self.cache, [], self.home, self.now + 299)["antigravity"])
            self.assertEqual(run.call_count, 1)
            collect.collect_limits(self.cache, [], self.home, self.now + 300)
            self.assertEqual(run.call_count, 2)

    def test_agy_probe_re_probes_on_new_activity_with_rate_limit(self):
        conv_dir = self.home / ".gemini" / "antigravity-cli" / "conversations"
        conv_dir.mkdir(parents=True)
        db_file = conv_dir / "session.db"
        db_file.touch()
        os.utime(db_file, (self.now - 100, self.now - 100))

        with patch.object(collect, "IS_WINDOWS", False), \
                patch.object(collect.shutil, "which", return_value="agy"), \
                patch.object(collect, "_run", side_effect=OSError) as run:
            # 1. Initial probe at self.now (activity was at now - 100). Probe records fetched_at = self.now.
            self.assertIsNone(collect.collect_limits(self.cache, [], self.home, self.now)["antigravity"])
            self.assertEqual(run.call_count, 1)

            # 2. Idle state: no new activity, within TTL (300s) -> no probe.
            self.assertIsNone(collect.collect_limits(self.cache, [], self.home, self.now + 100)["antigravity"])
            self.assertEqual(run.call_count, 1)

            # 3. New activity occurs at now + 30 (which is newer than fetched_at = now).
            os.utime(db_file, (self.now + 30, self.now + 30))

            # But check at now + 40 (< 60s cooldown from last probe at now) -> no probe.
            self.assertIsNone(collect.collect_limits(self.cache, [], self.home, self.now + 40)["antigravity"])
            self.assertEqual(run.call_count, 1)

            # Check at now + 60 (>= 60s cooldown, activity at now+30 > fetched_at=now) -> re-probe!
            self.assertIsNone(collect.collect_limits(self.cache, [], self.home, self.now + 60)["antigravity"])
            self.assertEqual(run.call_count, 2)

    def test_agy_probe_windows_no_probe_even_with_new_activity(self):
        conv_dir = self.home / ".gemini" / "antigravity-cli" / "conversations"
        conv_dir.mkdir(parents=True)
        db_file = conv_dir / "session.db"
        db_file.touch()
        os.utime(db_file, (self.now + 10, self.now + 10))

        with patch.object(collect, "IS_WINDOWS", True), patch.dict(os.environ, {}, clear=True), \
                patch.object(collect.shutil, "which", return_value="agy"), \
                patch.object(collect, "_run", side_effect=AssertionError("probe should not run on Windows")):
            self.assertIsNone(collect.collect_limits(self.cache, [], self.home, self.now)["antigravity"])

    def test_agy_probe_parser_selects_gemini(self):
        reply = {"command": {"data": {"groups": [
            {"name": "Argon", "buckets": [{"window": "5h", "remaining_fraction": 0.1}]},
            {"name": "Gemini", "buckets": [
                {"window": "5h", "remaining_fraction": 0.87, "reset_time": "2026-11-20T18:00:00Z"},
                {"window": "weekly", "remaining_fraction": 0.46},
            ]},
        ]}}}
        result = collect._parse_agy_limits(reply, self.now)
        self.assertEqual(result["five"]["remaining"], 87.0)
        self.assertEqual(result["five"]["resets_at"], 1795197600)
        self.assertEqual(result["week"], {"remaining": 46.0, "resets_at": None})
        self.assertEqual(result["source"], "cli")
        legacy = {"response": "Gemini\tFive hour\t87%\t2026-11-20T18:00:00Z\nGemini\tWeekly\t46%"}
        self.assertEqual(collect._parse_agy_limits(legacy, self.now), result)


if __name__ == "__main__":
    unittest.main()
