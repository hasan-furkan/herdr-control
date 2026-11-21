#!/usr/bin/env python3
"""Herdr Control collector: gathers system, tailscale, ports, usage, limits, and installed CLIs."""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import closing
import ctypes
from ctypes import wintypes
from datetime import datetime, timedelta, timezone
import hashlib
import heapq
import ipaddress
import json
import os
from pathlib import Path
import platform
import re
import shutil
import shlex
import socket
import sqlite3
import stat
import subprocess
import sys
import tempfile
from threading import Event, Lock, Thread
import time
from urllib.parse import urlsplit


IS_WINDOWS = os.name == "nt"
IS_MACOS = sys.platform == "darwin"
IS_LINUX = sys.platform.startswith("linux")
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if IS_WINDOWS else 0

CMD_TIMEOUT = 5
MAX_COMMAND_BYTES = 4 * 1024 * 1024
MAX_LOG_LINE_BYTES = 8 * 1024 * 1024
CPU_SAMPLE_SECONDS = 0.25
CODEX_LIMIT_TAIL_BYTES = 32 * 1024 * 1024
OPENCODE_LIMIT_TAIL_BYTES = 2 * 1024 * 1024
PROVIDER_SCAN_SECONDS = {"claude": 3, "codex": 1.5, "antigravity": 1.5, "opencode": 1.5, "limits.codex": 0.5}
USAGE_CACHE_VERSION = 4
MAX_ERROR_CHARS = 200
MAX_PROBE_BYTES = 256 * 1024
DOCKER_PS_FIELDS = ("ID", "Names", "Name", "Image", "State", "Status", "Ports")
DOCKER_STATS_FIELDS = ("ID", "Container", "Name", "CPUPerc", "MemUsage", "MemPerc", "NetIO")
AGY_TIMEOUT = 20
AGY_CACHE_TTL_S = 3600
LIMIT_PROVIDERS = ("claude", "codex", "antigravity", "opencode")
RETENTION_DAYS = 31
NETWORK_RETENTION_DAYS = 62
MAX_GAP_S = 300
AGY_LIVE_WINDOW_S = 90
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

WIN_SKIP_PROCS = frozenset({"system", "svchost", "lsass", "wininit", "services", "spoolsv"})
SKIP_IFACE_PREFIXES = (
    "tailscale",
    "utun",
    "docker",
    "veth",
    "br-",
    "podman",
    "cni",
    "virbr",
    "vethernet",
)
ALLOWED_LOW_PORTS = frozenset({22, 80, 443})
TAILSCALE_V4_NET = ipaddress.ip_network("100.64.0.0/10")
TAILSCALE_V6_NET = ipaddress.ip_network("fd7a:115c:a1e0::/48")

TS_PING_RE = re.compile(r"\bin\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|s|us|µs)\b")
TIMESTAMP_RE = re.compile(r'"timestamp"\s*:\s*"([^"]+)"')
MAC_PAGE_SIZE_RE = re.compile(r"page size of (\d+) bytes")
LSOF_LISTEN_RE = re.compile(
    r"^(\S+)\s+(\d+)\s+\S+\s+\S+\s+(IPv[46])\s+\S+\s+\S+\s+TCP\s+(\S+)\s+\(LISTEN\)"
)
SS_PROC_RE = re.compile(r'\("([^"]+)",pid=(\d+)')


def _now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _run(cmd, timeout=CMD_TIMEOUT):
    """Drain both pipes concurrently, with a combined byte limit and deadline."""
    deadline = time.monotonic() + timeout
    output = (bytearray(), bytearray())
    done, lock = Event(), Lock()
    readers = 2
    failures = []

    def drain(pipe, buffer):
        nonlocal readers
        try:
            with pipe:
                while not done.is_set():
                    block = pipe.read(65536)
                    if not block:
                        break
                    with lock:
                        if len(output[0]) + len(output[1]) + len(block) > MAX_COMMAND_BYTES:
                            failures.append(_CommandOutputLimit())
                            done.set()
                            break
                        buffer.extend(block)
        except OSError as exc:
            with lock:
                failures.append(exc)
                done.set()
        finally:
            with lock:
                readers -= 1
                if not readers:
                    done.set()

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            bufsize=0, creationflags=CREATE_NO_WINDOW)
    try:
        for pipe, buffer in zip((proc.stdout, proc.stderr), output):
            Thread(target=drain, args=(pipe, buffer), daemon=True).start()
        if not done.wait(max(0, deadline - time.monotonic())):
            raise subprocess.TimeoutExpired(cmd, timeout)
        if failures:
            raise failures[0]
        returncode = proc.wait(timeout=max(0, deadline - time.monotonic()))
    finally:
        # A descendant may still hold an inherited pipe. Only its reader closes it.
        done.set()
        if proc.poll() is None:
            proc.kill()
            proc.wait()
    stdout, stderr = (buffer.decode("utf-8", "replace") for buffer in output)
    return subprocess.CompletedProcess(cmd, returncode, stdout, stderr)


class _CommandOutputLimit(subprocess.SubprocessError):
    pass


def _get_cache_dir():
    """Return the OS-appropriate cache directory for herdr-control."""
    if IS_WINDOWS:
        local_app = os.environ.get("LOCALAPPDATA")
        base = Path(local_app) if local_app else (Path.home() / "AppData" / "Local")
        return base / "herdr-control"
    return Path.home() / ".cache" / "herdr-control"


def _is_link(info):
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    )


def _checked_path(path, check_type):
    path = Path(path)
    for parent in reversed(path.parents):
        info = parent.lstat()
        if _is_link(info) or not stat.S_ISDIR(info.st_mode):
            raise OSError("unsafe parent directory")
    info = path.lstat()
    if _is_link(info) or not check_type(info.st_mode):
        raise OSError("unsafe path")
    return info


def _open_input(path):
    before = _checked_path(path, stat.S_ISREG)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    fd = os.open(path, flags | getattr(os, "O_BINARY", 0))
    try:
        after = os.fstat(fd)
        if not stat.S_ISREG(after.st_mode) or not os.path.samestat(before, after):
            raise OSError("input changed during open")
        return os.fdopen(fd, "rb")
    except BaseException:
        os.close(fd)
        raise


def _read_json_file(path, max_bytes=MAX_COMMAND_BYTES):
    try:
        with _open_input(path) as f:
            data = f.read(max_bytes + 1)
        if len(data) <= max_bytes:
            return json.loads(data)
    except (OSError, ValueError, RecursionError):
        return None


def _check_cache_dir(directory):
    info = _checked_path(directory, stat.S_ISDIR)
    if os.name != "nt":
        if info.st_uid != os.geteuid():
            raise OSError("cache directory has a different owner")
        if stat.S_IMODE(info.st_mode) != 0o700:
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                if not os.path.samestat(info, os.fstat(fd)):
                    raise OSError("cache directory changed during open")
                os.fchmod(fd, 0o700)
            finally:
                os.close(fd)
    return info


def _make_cache_dir(directory):
    try:
        _checked_path(directory, stat.S_ISDIR)
    except FileNotFoundError:
        _make_cache_dir(directory.parent)
        directory.mkdir(mode=0o700, exist_ok=True)


def _read_cache(path):
    try:
        _check_cache_dir(path.parent)
    except OSError:
        return None
    return _read_json_file(path, 16 * 1024 * 1024)


def _write_json_atomic(path, data):
    """Replace a regular cache file using an exclusive temporary file."""
    directory = path.parent
    tmp = None
    tmp_info = None
    directory_fd = None
    try:
        _make_cache_dir(directory)
        info = _check_cache_dir(directory)
        if os.name != "nt":
            directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            if not os.path.samestat(info, os.fstat(directory_fd)):
                return False
        try:
            _checked_path(path, stat.S_ISREG)
        except FileNotFoundError:
            pass
        fd, tmp = tempfile.mkstemp(dir=directory)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            tmp_info = os.fstat(f.fileno())
            json.dump(data, f, separators=(",", ":"))
        if directory_fd is None:
            current = _check_cache_dir(directory)
            if not os.path.samestat(info, current) or not os.path.samestat(tmp_info, os.lstat(tmp)):
                return False
            os.replace(tmp, path)
        else:
            name = Path(tmp).name
            if not os.path.samestat(tmp_info, os.lstat(name, dir_fd=directory_fd)):
                return False
            # Replace does not dereference the destination, even if it was swapped.
            os.replace(name, path.name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
        tmp = None
        return True
    except OSError:
        return False
    finally:
        if tmp is not None and tmp_info is not None:
            try:
                if os.path.samestat(tmp_info, os.lstat(tmp)):
                    os.unlink(tmp)
            except OSError:
                pass
        if directory_fd is not None:
            os.close(directory_fd)


def _cache_key(provider, path):
    return f"{provider}::{hashlib.sha256(os.fsencode(path)).hexdigest()}"


def _parse_iso_to_epoch(ts_str):
    """Parse an ISO-8601 timestamp string into (epoch_seconds, local_date_str)."""
    if not ts_str or not isinstance(ts_str, str):
        return None, None
    s = ts_str.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None, None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp(), dt.astimezone().date().isoformat()


def _epoch_to_local_date(epoch_s):
    return datetime.fromtimestamp(epoch_s, tz=timezone.utc).astimezone().date().isoformat()


def _parse_any_ts(val):
    """Convert epoch s/ms or ISO string to (epoch_seconds, local_date_str)."""
    if val is None:
        return None, None
    if isinstance(val, (int, float)):
        sec = float(val) / 1000.0 if val > 1e12 else float(val)
        if sec <= 0:
            return None, None
        return sec, _epoch_to_local_date(sec)
    if isinstance(val, str):
        s = val.strip()
        if s.isdigit():
            return _parse_any_ts(int(s))
        return _parse_iso_to_epoch(s)
    return None, None


def _project_from_cwd(cwd):
    """Extract the last path segment from a Windows or POSIX directory path."""
    if not cwd or not isinstance(cwd, str):
        return ""
    cleaned = cwd.strip().rstrip("/" + chr(92)).replace(chr(92), "/")
    if not cleaned:
        return ""
    return cleaned.rsplit("/", 1)[-1]


def _short_err(prefix, exc):
    if isinstance(exc, _CommandOutputLimit):
        detail = "command output limit exceeded"
    elif isinstance(exc, subprocess.TimeoutExpired):
        detail = "command timed out"
    else:
        detail = type(exc).__name__[:80]
    return f"{prefix[:MAX_ERROR_CHARS - len(detail) - 2]}: {detail}"


class _ScanExpired(Exception):
    pass


class _ScanBudget:
    def __init__(self, provider, notes):
        self.provider = provider
        self.notes = notes
        self.deadline = time.monotonic() + PROVIDER_SCAN_SECONDS[provider]
        self.skipped = 0

    def report(self, pending, record_kind):
        if pending:
            self.notes.append(f"{self.provider}: {pending} files pending")
        if self.skipped:
            plural = "" if self.skipped == 1 else "s"
            self.notes.append(f"{self.provider}: {self.skipped} oversized {record_kind}{plural} skipped")

    def expired(self):
        return time.monotonic() >= self.deadline

    def check(self):
        if self.expired():
            raise _ScanExpired

    def log_lines(self, path):
        with _open_input(path) as fh:
            while True:
                self.check()
                line = fh.readline(MAX_LOG_LINE_BYTES + 1)
                if not line:
                    break
                if len(line) > MAX_LOG_LINE_BYTES:
                    self.skipped += 1
                    while line and not line.endswith(b"\n"):
                        self.check()
                        line = fh.readline(MAX_LOG_LINE_BYTES + 1)
                    continue
                yield line.decode("utf-8", "replace")

    def sqlite_rows(self, cursor):
        for row in cursor:
            self.check()
            yield row
        self.check()


def _newest_log_lines(path, max_bytes, budget=None):
    with _open_input(path) as fh:
        start = max(0, fh.seek(0, os.SEEK_END) - max_bytes)
        if start:
            fh.seek(start - 1)
        partial = start > 0 and fh.read(1) != b"\n"
        fh.seek(start)
        data = fh.read(max_bytes)
    end = len(data)
    while end > 0:
        if budget is not None:
            budget.check()
        newline = data.rfind(b"\n", 0, end)
        if newline < 0 and partial:
            break
        if 0 < end - newline - 1 <= MAX_LOG_LINE_BYTES:
            yield data[newline + 1:end].decode("utf-8", "replace")
        end = newline


# ---------------------------------------------------------------------------
# System metrics
# ---------------------------------------------------------------------------

def _cpu_percent(before, after):
    total = after[0] - before[0]
    idle = after[1] - before[1]
    if total <= 0:
        return 0.0
    return round(max(0.0, min(100.0, 100.0 * (total - idle) / total)), 1)


def _sample_cpu_percent(read_times):
    before = read_times()
    time.sleep(CPU_SAMPLE_SECONDS)
    return _cpu_percent(before, read_times())


def _used_memory(total, available):
    return max(0, total - available)


def _read_windows_cpu_times(kernel32):
    idle, kernel, user = (wintypes.FILETIME() for _ in range(3))
    if not kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
        raise ctypes.WinError(ctypes.get_last_error())
    idle_ticks, kernel_ticks, user_ticks = (
        (t.dwHighDateTime << 32) | t.dwLowDateTime for t in (idle, kernel, user)
    )
    # GetSystemTimes includes idle time in the kernel counter.
    return kernel_ticks + user_ticks, idle_ticks


class _MemoryStatusEx(ctypes.Structure):
    _fields_ = [
        ("length", wintypes.DWORD),
        ("memory_load", wintypes.DWORD),
        ("total_phys", ctypes.c_uint64),
        ("avail_phys", ctypes.c_uint64),
        ("total_page_file", ctypes.c_uint64),
        ("avail_page_file", ctypes.c_uint64),
        ("total_virtual", ctypes.c_uint64),
        ("avail_virtual", ctypes.c_uint64),
        ("avail_extended_virtual", ctypes.c_uint64),
    ]


def _read_windows_memory(kernel32):
    memory = _MemoryStatusEx(length=ctypes.sizeof(_MemoryStatusEx))
    if not kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
        raise ctypes.WinError(ctypes.get_last_error())
    return memory.total_phys, _used_memory(memory.total_phys, memory.avail_phys)


def _collect_system_windows():
    # Take both CPU samples before launching the PowerShell metadata query.
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    cpu_pct = _sample_cpu_percent(lambda: _read_windows_cpu_times(kernel32))
    ram_total_b, ram_used_b = _read_windows_memory(kernel32)
    ps_cmd = (
        "$os = Get-CimInstance Win32_OperatingSystem; "
        "$cpu = @(Get-CimInstance Win32_Processor); "
        "$disk = Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\"; "
        "$cores = ($cpu | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum; "
        "$model = if ($cpu.Count -gt 0 -and $cpu[0].Name) { ($cpu[0].Name).Trim() } else { '' }; "
        "$diskTotal = if ($disk -and $disk.Size) { [int64]$disk.Size } else { 0 }; "
        "$diskUsed = if ($disk -and $disk.Size) { [int64]$disk.Size - [int64]$disk.FreeSpace } else { 0 }; "
        "[PSCustomObject]@{"
        "hostname=$os.CSName;"
        "os=$os.Caption;"
        "uptime_s=[int]((Get-Date) - $os.LastBootUpTime).TotalSeconds;"
        "cpu_cores=[int]$cores;"
        "cpu_model=$model;"
        "disk_used_b=$diskUsed;"
        "disk_total_b=$diskTotal"
        "} | ConvertTo-Json -Compress"
    )
    res = _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_cmd], timeout=CMD_TIMEOUT)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or f"powershell exited {res.returncode}")
    data = json.loads(res.stdout.strip())
    return {
        "hostname": data.get("hostname") or socket.gethostname(),
        "os": (data.get("os") or f"Windows {platform.release()}").strip(),
        "uptime_s": max(0, int(data.get("uptime_s") or 0)),
        "cpu_pct": cpu_pct,
        "cpu_cores": int(data.get("cpu_cores") or os.cpu_count() or 0),
        "cpu_model": (data.get("cpu_model") or "").strip(),
        "ram_used_b": ram_used_b,
        "ram_total_b": ram_total_b,
        "disk_used_b": max(0, int(data.get("disk_used_b") or 0)),
        "disk_total_b": max(0, int(data.get("disk_total_b") or 0)),
    }


def _sysctl_str(key):
    res = _run(["sysctl", "-n", key], timeout=CMD_TIMEOUT)
    return res.stdout.strip() if res.returncode == 0 else ""


def _parse_vm_stat(text):
    page = MAC_PAGE_SIZE_RE.search(text)
    page_size = int(page.group(1)) if page else 4096
    used_fields = {"Pages active", "Pages wired down", "Pages occupied by compressor"}
    used_pages = 0
    for line in text.splitlines():
        key, _, value = line.partition(":")
        value = value.strip().rstrip(".")
        if key.strip() in used_fields and value.isdigit():
            used_pages += int(value)
    return used_pages * page_size


def _collect_system_macos():
    hostname = socket.gethostname()
    mac_ver = platform.mac_ver()[0]
    os_name = f"macOS {mac_ver}" if mac_ver else platform.platform()

    boottime = _sysctl_str("kern.boottime")
    m_boot = re.search(r"sec\s*=\s*(\d+)", boottime)
    uptime_s = max(0, int(time.time()) - int(m_boot.group(1))) if m_boot else 0

    cpu_model = _sysctl_str("machdep.cpu.brand_string") or _sysctl_str("hw.model")
    cores_str = _sysctl_str("hw.logicalcpu")
    cpu_cores = int(cores_str) if cores_str.isdigit() else (os.cpu_count() or 0)

    cpu_pct = 0.0
    top_res = _run(["top", "-l", "2", "-n", "0", "-s", "1"], timeout=CMD_TIMEOUT)
    if top_res.returncode == 0:
        matches = re.findall(
            r"CPU usage:\s*([0-9.]+)%\s*user,\s*([0-9.]+)%\s*sys,\s*([0-9.]+)%\s*idle",
            top_res.stdout,
        )
        # The first report covers time since boot. The second covers the sample interval.
        if len(matches) >= 2:
            idle = float(matches[1][2])
            cpu_pct = round(max(0.0, min(100.0, 100.0 - idle)), 1)

    mem_str = _sysctl_str("hw.memsize")
    ram_total_b = int(mem_str) if mem_str.isdigit() else 0
    vm_res = _run(["vm_stat"], timeout=CMD_TIMEOUT)
    ram_used_b = _parse_vm_stat(vm_res.stdout) if vm_res.returncode == 0 else 0

    disk_total_b = 0
    disk_used_b = 0
    df_res = _run(["df", "-k", os.sep], timeout=CMD_TIMEOUT)
    if df_res.returncode == 0:
        lines = df_res.stdout.strip().splitlines()
        if len(lines) >= 2:
            parts = lines[-1].split()
            if len(parts) >= 4 and parts[1].isdigit() and parts[2].isdigit():
                disk_total_b = int(parts[1]) * 1024
                disk_used_b = int(parts[2]) * 1024
    if disk_total_b == 0:
        du = shutil.disk_usage(os.sep)
        disk_total_b, disk_used_b = du.total, du.used

    return {
        "hostname": hostname,
        "os": os_name,
        "uptime_s": uptime_s,
        "cpu_pct": cpu_pct,
        "cpu_cores": cpu_cores,
        "cpu_model": cpu_model,
        "ram_used_b": ram_used_b,
        "ram_total_b": ram_total_b,
        "disk_used_b": disk_used_b,
        "disk_total_b": disk_total_b,
    }


def _linux_sys_path(*parts):
    return os.path.join(os.sep, *parts)


def _parse_proc_stat(line):
    parts = line.split()
    if len(parts) < 5 or parts[0] != "cpu":
        raise ValueError("missing aggregate CPU times")
    # Guest and guest_nice are already included in user and nice.
    values = [int(value) for value in parts[1:9]]
    return sum(values), sum(values[3:5])


def _read_proc_stat():
    with open(_linux_sys_path("proc", "stat"), "r", encoding="utf-8") as f:
        return _parse_proc_stat(f.readline())


def _collect_system_linux():
    hostname = socket.gethostname()
    os_name = f"Linux {platform.release()}"
    try:
        with open(_linux_sys_path("etc", "os-release"), "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    os_name = line.split("=", 1)[1].strip().strip('"')
                    break
    except OSError:
        pass

    uptime_s = 0
    try:
        with open(_linux_sys_path("proc", "uptime"), "r", encoding="utf-8") as f:
            uptime_s = int(float(f.read().split()[0]))
    except (OSError, ValueError, IndexError):
        pass

    cpu_model = ""
    cpu_cores = os.cpu_count() or 0
    try:
        core_count = 0
        with open(_linux_sys_path("proc", "cpuinfo"), "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("processor"):
                    core_count += 1
                elif not cpu_model and (
                    line.startswith("model name")
                    or line.startswith("Hardware")
                    or line.startswith("Processor")
                ):
                    if ":" in line:
                        cpu_model = line.split(":", 1)[1].strip()
        if core_count > 0:
            cpu_cores = core_count
    except OSError:
        pass

    cpu_pct = 0.0
    try:
        cpu_pct = _sample_cpu_percent(_read_proc_stat)
    except (OSError, ValueError):
        pass

    ram_total_b = 0
    ram_used_b = 0
    try:
        meminfo = {}
        with open(_linux_sys_path("proc", "meminfo"), "r", encoding="utf-8") as f:
            for line in f:
                if ":" in line:
                    k, v = line.split(":", 1)
                    fields = v.split()
                    if fields and fields[0].isdigit():
                        meminfo[k] = int(fields[0]) * 1024
        ram_total_b = meminfo.get("MemTotal", 0)
        available = meminfo.get("MemAvailable")
        if available is None:
            available = sum(meminfo.get(key, 0) for key in ("MemFree", "Buffers", "Cached"))
        ram_used_b = _used_memory(ram_total_b, available)
    except (OSError, ValueError):
        pass

    disk_total_b = 0
    disk_used_b = 0
    try:
        df_res = _run(["df", "-B1", os.sep], timeout=CMD_TIMEOUT)
        if df_res.returncode == 0:
            lines = df_res.stdout.strip().splitlines()
            if len(lines) >= 2:
                parts = lines[-1].split()
                if len(parts) >= 4 and parts[1].isdigit() and parts[2].isdigit():
                    disk_total_b = int(parts[1])
                    disk_used_b = int(parts[2])
    except Exception:
        pass
    if disk_total_b == 0:
        du = shutil.disk_usage(os.sep)
        disk_total_b, disk_used_b = du.total, du.used

    return {
        "hostname": hostname,
        "os": os_name,
        "uptime_s": uptime_s,
        "cpu_pct": cpu_pct,
        "cpu_cores": cpu_cores,
        "cpu_model": cpu_model,
        "ram_used_b": ram_used_b,
        "ram_total_b": ram_total_b,
        "disk_used_b": disk_used_b,
        "disk_total_b": disk_total_b,
    }


def collect_system(errors):
    try:
        if IS_WINDOWS:
            system = _collect_system_windows()
        elif IS_MACOS:
            system = _collect_system_macos()
        else:
            system = _collect_system_linux()
        system["username"] = (
            os.environ.get("USERNAME") if IS_WINDOWS
            else os.environ.get("LOGNAME") or os.environ.get("USER")
        )
        return system
    except Exception as exc:
        errors.append(_short_err("system", exc))
        return None


# ---------------------------------------------------------------------------
# Tailscale
# ---------------------------------------------------------------------------

def _find_tailscale():
    path = shutil.which("tailscale")
    if path:
        return path
    if IS_WINDOWS:
        prog_files = os.environ.get("ProgramFiles") or os.path.join(
            os.environ.get("SystemDrive", "C:") + os.sep, "Program Files"
        )
        candidate = os.path.join(prog_files, "Tailscale", "tailscale.exe")
        if os.path.isfile(candidate):
            return candidate
    if sys.platform == "darwin":
        candidate = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
        if os.path.isfile(candidate):
            # Without a TERM (e.g. launched from Herdr.app) the bundle binary
            # tries to start the GUI instead of acting as the CLI.
            os.environ["TAILSCALE_BE_CLI"] = "1"
            return candidate
    return None


def _short_ts_name(node):
    dns = (node.get("DNSName") or "").rstrip(".")
    if dns:
        return dns.split(".", 1)[0]
    return node.get("HostName") or ""


def _ping_peer(ts_bin, ip):
    try:
        res = _run([ts_bin, "ping", "-c", "1", "--timeout", "2s", ip], timeout=CMD_TIMEOUT)
        output = (res.stdout or "") + "\n" + (res.stderr or "")
        m = TS_PING_RE.search(output)
        if not m:
            return None
        val = float(m.group(1))
        unit = m.group(2)
        if unit == "s":
            return round(val * 1000.0, 1)
        if unit in ("us", "µs"):
            return round(val / 1000.0, 1)
        return round(val, 1)
    except Exception:
        return None


def _serve_port(value):
    if isinstance(value, str) and len(value) <= 5 and value.isascii() and value.isdigit():
        port = int(value)
        if 0 < port <= 65535:
            return port
    return None


def _serve_target(value, proxy=False):
    if not isinstance(value, str) or len(value) > 2048:
        return ""
    try:
        uri = urlsplit(value if proxy else "//" + value)
        if proxy and uri.scheme not in ("http", "https", "https+insecure"):
            return ""
        port = uri.port if uri.port is not None else {"http": 80, "https": 443, "https+insecure": 443}.get(uri.scheme)
        host = uri.hostname
        if not host or not port or uri.username is not None:
            return ""
        if ":" in host:
            host = f"[{ipaddress.IPv6Address(host)}]" if "%" not in host else ""
        elif not re.fullmatch(r"[a-z0-9.-]{1,253}", host, re.ASCII):
            return ""
        return f"{host}:{port}" if host else ""
    except ValueError:
        return ""


def _serve_funnel_ports(serve_raw):
    allowed = serve_raw.get("AllowFunnel")
    if not isinstance(allowed, dict):
        return set()
    return {port for endpoint, flag in allowed.items() if flag is True and isinstance(endpoint, str) and ":" in endpoint
            for port in [_serve_port(endpoint.rsplit(":", 1)[-1])] if port is not None}


def _parse_serve_status(serve_raw):
    entries = []
    if not isinstance(serve_raw, dict):
        return entries

    web_map = serve_raw.get("Web") or {}
    web_targets_by_port = {}
    for host_port, web_cfg in web_map.items() if isinstance(web_map, dict) else ():
        if ":" not in host_port or not isinstance(web_cfg, dict):
            continue
        port = _serve_port(host_port.rsplit(":", 1)[-1])
        if port is None:
            continue
        handlers = web_cfg.get("Handlers")
        targets = web_targets_by_port.setdefault(port, set())
        if isinstance(handlers, dict):
            targets.update(_serve_target(handler.get("Proxy"), proxy=True)
                           for handler in handlers.values() if isinstance(handler, dict))

    tcp_map = serve_raw.get("TCP") or {}
    for port_str, tcp_cfg in tcp_map.items() if isinstance(tcp_map, dict) else ():
        port = _serve_port(port_str)
        if port is None or not isinstance(tcp_cfg, dict):
            continue
        if "TCPForward" in tcp_cfg:
            entries.append({"port": port, "proto": "tcp", "target": _serve_target(tcp_cfg["TCPForward"])})
        elif tcp_cfg.get("HTTPS") is True or tcp_cfg.get("HTTP") is True:
            web_targets_by_port.setdefault(port, set())

    for port, targets in web_targets_by_port.items():
        cfg = tcp_map.get(str(port)) if isinstance(tcp_map, dict) else None
        proto = "http" if isinstance(cfg, dict) and cfg.get("HTTP") is True else "https"
        entries.extend({"port": port, "proto": proto, "target": target} for target in sorted(targets or {""}))

    return entries


def _collect_serve(ts_bin, errors):
    try:
        res = _run([ts_bin, "serve", "status", "--json"], timeout=CMD_TIMEOUT)
        if res.returncode != 0:
            errors.append(f"tailscale serve: exited {res.returncode}")
        elif res.stdout.strip():
            data = json.loads(res.stdout)
            if isinstance(data, dict):
                return _parse_serve_status(data), sorted(_serve_funnel_ports(data))
    except Exception as exc:
        errors.append(_short_err("tailscale serve", exc))
    return [], []


def collect_tailscale(errors):
    ts_bin = _find_tailscale()
    if not ts_bin:
        errors.append("tailscale: command not found")
        return None
    try:
        res = _run([ts_bin, "status", "--json"], timeout=CMD_TIMEOUT)
        if res.returncode != 0:
            raise RuntimeError(res.stderr.strip() or f"status exited {res.returncode}")
        status = json.loads(res.stdout)
    except Exception as exc:
        errors.append(_short_err("tailscale", exc))
        return None

    cur_tn = status.get("CurrentTailnet") or {}
    tailnet = (
        cur_tn.get("MagicDNSSuffix")
        or status.get("MagicDNSSuffix")
        or cur_tn.get("Name")
        or ""
    )

    self_raw = status.get("Self") or {}
    self_ips = self_raw.get("TailscaleIPs") or []
    self_info = {
        "name": _short_ts_name(self_raw),
        "ip": self_ips[0] if self_ips else "",
        "os": self_raw.get("OS") or "",
    }

    peers = []
    online_ips = []
    for p in (status.get("Peer") or {}).values():
        if not isinstance(p, dict):
            continue
        if p.get("HostName") == "funnel-ingress-node" or (
            not p.get("DNSName") and not p.get("OS")
        ):
            continue
        ips = p.get("TailscaleIPs") or []
        ip = ips[0] if ips else ""
        online = bool(p.get("Online"))
        raw_seen = p.get("LastSeen") or ""
        last_seen = None
        if not online and raw_seen and not raw_seen.startswith("0001-01-01"):
            last_seen = raw_seen
        peer_obj = {
            "name": _short_ts_name(p),
            "ip": ip,
            "os": p.get("OS") or "",
            "online": online,
            "last_seen": last_seen,
            "ping_ms": None,
        }
        peers.append(peer_obj)
        if online and ip:
            online_ips.append((peer_obj, ip))

    if online_ips:
        deadline = time.monotonic() + 4.8
        with ThreadPoolExecutor(max_workers=min(8, len(online_ips))) as pool:
            future_map = {pool.submit(_ping_peer, ts_bin, ip): peer for peer, ip in online_ips}
            try:
                for fut in as_completed(future_map, timeout=max(0.2, deadline - time.monotonic())):
                    peer = future_map[fut]
                    try:
                        peer["ping_ms"] = fut.result(timeout=0)
                    except Exception:
                        pass
            except TimeoutError:
                pass

    peers.sort(key=lambda x: (not x["online"], x["name"].lower()))

    serve_entries, funnel_ports = _collect_serve(ts_bin, errors)

    return {
        "tailnet": tailnet,
        "self": self_info,
        "peers": peers,
        "serve": serve_entries,
        "funnel_ports": funnel_ports,
        "_self_ips": self_ips,
    }


# ---------------------------------------------------------------------------
# Ports
# ---------------------------------------------------------------------------

def _extract_target_port(target):
    if not target:
        return None
    m = re.search(r":(\d+)(?:/|$)", str(target).strip())
    return int(m.group(1)) if m else None


def _is_tailscale_ip(addr, known_ips):
    if addr in known_ips:
        return True
    clean = addr.split("%", 1)[0].strip("[]")
    try:
        ip_obj = ipaddress.ip_address(clean)
    except ValueError:
        return False
    if ip_obj.version == 4:
        return ip_obj in TAILSCALE_V4_NET
    return ip_obj in TAILSCALE_V6_NET


def _classify_port_access(port, addr, funnel_ports, serve_ports, ts_ips):
    if port in funnel_ports:
        return "public"
    if port in serve_ports:
        return "tailnet"
    clean = addr.split("%", 1)[0].strip("[]")
    if clean in ("0.0.0.0", "::", "*"):
        return "tailnet"
    if _is_tailscale_ip(clean, ts_ips):
        return "tailnet"
    if clean in ("127.0.0.1", "::1", "localhost") or clean.startswith("127."):
        return "local"
    return "tailnet"


def _normalize_addr(addr):
    clean = addr.strip()
    if clean.startswith("[") and clean.endswith("]"):
        clean = clean[1:-1]
    if clean.lower().startswith("::ffff:"):
        clean = clean[7:]
    if "%" in clean:
        clean = clean.split("%", 1)[0]
    return clean


def _collect_ports_windows():
    ps_cmd = (
        "$procs = @{}; "
        "Get-Process | ForEach-Object { $procs[$_.Id] = $_.ProcessName }; "
        "@(Get-NetTCPConnection -State Listen | ForEach-Object { "
        "[PSCustomObject]@{ "
        "port = [int]$_.LocalPort; "
        "addr = $_.LocalAddress; "
        "pid = [int]$_.OwningProcess; "
        "process = [string]$procs[[int]$_.OwningProcess] "
        "} }) | ConvertTo-Json -Compress"
    )
    res = _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_cmd], timeout=CMD_TIMEOUT)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or f"powershell exited {res.returncode}")
    raw_text = res.stdout.strip()
    if not raw_text:
        return []
    parsed = json.loads(raw_text)
    if isinstance(parsed, dict):
        parsed = [parsed]
    rows = []
    for item in parsed:
        proc = (item.get("process") or "").strip()
        proc_base = proc.lower()
        if proc_base.endswith(".exe"):
            proc_base = proc_base[:-4]
        if proc_base in WIN_SKIP_PROCS:
            continue
        rows.append(
            {
                "port": int(item.get("port") or 0),
                "addr": _normalize_addr(item.get("addr") or ""),
                "pid": int(item.get("pid") or 0),
                "process": proc,
                "cwd": None,
            }
        )
    return rows


def _collect_ports_macos():
    res = _run(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"], timeout=CMD_TIMEOUT)
    if res.returncode != 0 and not res.stdout.strip():
        raise RuntimeError(res.stderr.strip() or f"lsof exited {res.returncode}")
    rows = []
    pids = set()
    escaped_space = chr(92) + "x20"
    for line in res.stdout.splitlines():
        m = LSOF_LISTEN_RE.match(line.strip())
        if not m:
            continue
        proc, pid_s, ip_ver, name_col = m.groups()
        proc = proc.replace(escaped_space, " ")
        if ":" not in name_col:
            continue
        addr_part, port_part = name_col.rsplit(":", 1)
        if not port_part.isdigit():
            continue
        if addr_part == "*":
            addr_part = "::" if ip_ver == "IPv6" else "0.0.0.0"
        pid = int(pid_s)
        pids.add(pid)
        rows.append(
            {
                "port": int(port_part),
                "addr": _normalize_addr(addr_part),
                "pid": pid,
                "process": proc,
                "cwd": None,
            }
        )

    if pids:
        try:
            pid_arg = ",".join(str(p) for p in sorted(pids))
            cwd_res = _run(["lsof", "-nP", "-a", "-p", pid_arg, "-d", "cwd", "-Fn"], timeout=CMD_TIMEOUT)
            if cwd_res.returncode == 0:
                cwd_map = {}
                cur_pid = None
                for line in cwd_res.stdout.splitlines():
                    if line.startswith("p") and line[1:].isdigit():
                        cur_pid = int(line[1:])
                    elif line.startswith("n") and cur_pid is not None:
                        cwd_map[cur_pid] = line[1:]
                for row in rows:
                    if row["pid"] in cwd_map:
                        row["cwd"] = cwd_map[row["pid"]]
        except Exception:
            pass
    return rows


def _collect_ports_linux():
    res = _run(["ss", "-ltnpH"], timeout=CMD_TIMEOUT)
    if res.returncode != 0:
        res = _run(["ss", "-ltnp"], timeout=CMD_TIMEOUT)
        if res.returncode != 0:
            raise RuntimeError(res.stderr.strip() or f"ss exited {res.returncode}")
    rows = []
    for line in res.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("State"):
            continue
        parts = line.split()
        if len(parts) < 4 or parts[0] != "LISTEN":
            continue
        local_ep = parts[3]
        if ":" not in local_ep:
            continue
        addr_part, port_part = local_ep.rsplit(":", 1)
        if not port_part.isdigit():
            continue
        addr = _normalize_addr(addr_part)
        if addr == "*":
            addr = "0.0.0.0"
        proc = ""
        pid = 0
        m_proc = SS_PROC_RE.search(line)
        if m_proc:
            proc = m_proc.group(1)
            pid = int(m_proc.group(2))
        cwd = None
        if pid > 0:
            try:
                cwd = os.readlink(_linux_sys_path("proc", str(pid), "cwd"))
            except OSError:
                cwd = None
        rows.append(
            {
                "port": int(port_part),
                "addr": addr,
                "pid": pid,
                "process": proc,
                "cwd": cwd,
            }
        )
    return rows


def collect_ports(tailscale_data, errors):
    try:
        if IS_WINDOWS:
            raw_rows = _collect_ports_windows()
        elif IS_MACOS:
            raw_rows = _collect_ports_macos()
        else:
            raw_rows = _collect_ports_linux()
    except Exception as exc:
        errors.append(_short_err("ports", exc))
        return None

    funnel_ports = set()
    serve_ports = set()
    ts_ips = set()
    if isinstance(tailscale_data, dict):
        public_ports = set(tailscale_data.get("funnel_ports") or [])
        for ip in tailscale_data.get("_self_ips") or []:
            ts_ips.add(_normalize_addr(ip))
        for entry in tailscale_data.get("serve") or []:
            t_port = _extract_target_port(entry.get("target"))
            if t_port is not None:
                if entry.get("port") in public_ports:
                    funnel_ports.add(t_port)
                else:
                    serve_ports.add(t_port)

    result = []
    seen = set()
    for row in raw_rows:
        port = row["port"]
        if port <= 0 or (port < 1024 and port not in ALLOWED_LOW_PORTS):
            continue
        dedupe = (port, row["addr"], row["pid"])
        if dedupe in seen:
            continue
        seen.add(dedupe)
        result.append(
            {
                "port": port,
                "addr": row["addr"],
                "pid": row["pid"],
                "process": row["process"],
                "cwd": row["cwd"],
                "access": _classify_port_access(
                    port, row["addr"], funnel_ports, serve_ports, ts_ips
                ),
            }
        )

    result.sort(key=lambda x: (x["port"], x["addr"], x["pid"]))
    return result


# ---------------------------------------------------------------------------
# Usage (incremental cache + Claude + OpenCode + Codex)
# ---------------------------------------------------------------------------

def _iter_recent_files(root_dir, suffix, cutoff_ts, budget=None):
    """Yield (path_str, size, mtime_ns) for matching files modified since cutoff_ts."""
    def scan(directory):
        try:
            _checked_path(directory, stat.S_ISDIR)
            with os.scandir(directory) as it:
                for entry in it:
                    if budget is not None:
                        budget.check()
                    try:
                        info = entry.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    if _is_link(info):
                        continue
                    yield entry.path, info
        except OSError:
            return

    # Keep only the active branch open to bound memory for wide trees.
    stack = [scan(root_dir)]
    try:
        while stack:
            item = next(stack[-1], None)
            if item is None:
                stack.pop()
                continue
            path, info = item
            if stat.S_ISDIR(info.st_mode) and len(stack) < 64:
                stack.append(scan(path))
            elif stat.S_ISREG(info.st_mode) and path.endswith(suffix) and info.st_mtime >= cutoff_ts:
                yield path, info.st_size, info.st_mtime_ns
    finally:
        for entries in stack:
            entries.close()


def _compute_active_seconds(ts_bucket_pairs, budget):
    """Sum gaps <= MAX_GAP_S between consecutive messages and assign to each gap's bucket."""
    if len(ts_bucket_pairs) < 2:
        return {}
    ts_bucket_pairs.sort(key=lambda x: x[0])
    active_by_bucket = {}
    prev_ts = ts_bucket_pairs[0][0]
    for ts, bucket in ts_bucket_pairs[1:]:
        budget.check()
        gap = ts - prev_ts
        if 0 < gap <= MAX_GAP_S and bucket is not None:
            active_by_bucket[bucket] = active_by_bucket.get(bucket, 0.0) + gap
        prev_ts = ts
    return active_by_bucket


def _parse_claude_file(path_str, cutoff_date, budget):
    """Stream one Claude Code jsonl file line by line and return per-bucket aggregates."""
    deduped = {}
    all_timestamps = []
    last_bucket = None
    line_idx = 0

    for line in budget.log_lines(path_str):
        line_idx += 1
        if '"assistant"' not in line and '"user"' not in line:
            continue

        if '"assistant"' not in line:
            if len(line) > 16384:
                m_ts = TIMESTAMP_RE.search(line[:512]) or TIMESTAMP_RE.search(line[-512:])
                if m_ts:
                    ep, _ = _parse_iso_to_epoch(m_ts.group(1))
                    if ep is not None:
                        all_timestamps.append((ep, last_bucket))
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if obj.get("type") == "user":
                ep, _ = _parse_iso_to_epoch(obj.get("timestamp"))
                if ep is not None:
                    all_timestamps.append((ep, last_bucket))
            continue

        try:
            obj = json.loads(line)
        except ValueError:
            continue

        etype = obj.get("type")
        if etype == "user":
            ep, _ = _parse_iso_to_epoch(obj.get("timestamp"))
            if ep is not None:
                all_timestamps.append((ep, last_bucket))
            continue

        if etype != "assistant":
            continue

        ep, date_str = _parse_iso_to_epoch(obj.get("timestamp"))
        msg = obj.get("message")
        if not isinstance(msg, dict):
            if ep is not None:
                all_timestamps.append((ep, last_bucket))
            continue

        model = msg.get("model") or ""
        usage = msg.get("usage")
        project = _project_from_cwd(obj.get("cwd"))
        if date_str and model and model != "<synthetic>":
            last_bucket = (date_str, model, project)

        if ep is not None:
            all_timestamps.append((ep, last_bucket))

        if not isinstance(usage, dict) or not date_str or model == "<synthetic>":
            continue

        inp = int(usage.get("input_tokens") or 0)
        out = int(usage.get("output_tokens") or 0)
        c_read = int(usage.get("cache_read_input_tokens") or 0)
        c_write = int(usage.get("cache_creation_input_tokens") or 0)
        if inp == 0 and out == 0 and c_read == 0 and c_write == 0:
            continue

        msg_id = msg.get("id") or ""
        req_id = obj.get("requestId") or ""
        d_key = (msg_id, req_id) if (msg_id or req_id) else ("_line", line_idx)
        deduped[d_key] = (date_str, model, project, inp, out, c_read, c_write)

    if not deduped:
        return []

    buckets = {}
    date_primary = {}
    for date_str, model, project, inp, out, c_read, c_write in deduped.values():
        budget.check()
        if date_str < cutoff_date:
            continue
        bkey = (date_str, model, project)
        rec = buckets.get(bkey)
        if rec is None:
            rec = {
                "date": date_str,
                "provider": "claude",
                "model": model,
                "input": 0,
                "output": 0,
                "cache_read": 0,
                "cache_write": 0,
                "sessions": 0,
                "active_s": 0,
                "project": project,
            }
            buckets[bkey] = rec
        rec["input"] += inp
        rec["output"] += out
        rec["cache_read"] += c_read
        rec["cache_write"] += c_write
        tot = inp + out + c_read + c_write
        if date_str not in date_primary or tot > date_primary[date_str][0]:
            date_primary[date_str] = (tot, bkey)

    if not buckets:
        return []

    for _, (_, primary_bkey) in date_primary.items():
        buckets[primary_bkey]["sessions"] += 1

    active_map = _compute_active_seconds(all_timestamps, budget)
    for bkey, secs in active_map.items():
        if bkey in buckets:
            buckets[bkey]["active_s"] += int(round(secs))
        elif bkey[0] in date_primary:
            buckets[date_primary[bkey[0]][1]]["active_s"] += int(round(secs))

    return list(buckets.values())


def _parse_codex_file(path_str, cutoff_date, budget):
    """Stream one Codex session jsonl file and extract token_count events."""
    project = ""
    current_model = ""
    prev_total = None
    seen_totals = set()
    all_timestamps = []
    records = []
    last_bucket = None

    for line in budget.log_lines(path_str):
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue

        etype = obj.get("type")
        payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else obj
        ep, date_str = _parse_any_ts(obj.get("timestamp") or payload.get("timestamp"))

        if etype in ("session_meta", "turn_context"):
            if payload.get("cwd"):
                project = _project_from_cwd(payload.get("cwd"))
            if payload.get("model"):
                current_model = str(payload.get("model"))
            continue

        is_token_event = (
            (etype == "event_msg" and payload.get("type") == "token_count")
            or etype == "token_count"
        )
        if not is_token_event:
            if ep is not None and etype in ("event_msg", "response_item"):
                all_timestamps.append((ep, last_bucket))
            continue

        info = payload.get("info") if isinstance(payload.get("info"), dict) else payload
        if not isinstance(info, dict):
            continue

        model = str(
            info.get("model")
            or payload.get("model")
            or current_model
            or "codex"
        )

        total_u = info.get("total_token_usage")
        last_u = info.get("last_token_usage")

        if isinstance(total_u, dict):
            sig = (
                int(total_u.get("input_tokens") or 0),
                int(total_u.get("output_tokens") or 0),
                int(total_u.get("cached_input_tokens") or 0),
            )
            if sig in seen_totals:
                continue
            seen_totals.add(sig)
        else:
            sig = None

        if isinstance(last_u, dict):
            inp = int(last_u.get("input_tokens") or 0)
            out = int(last_u.get("output_tokens") or 0)
            c_read = int(last_u.get("cached_input_tokens") or 0)
        elif sig is not None:
            if prev_total is None:
                inp, out, c_read = sig
            else:
                inp = max(0, sig[0] - prev_total[0])
                out = max(0, sig[1] - prev_total[1])
                c_read = max(0, sig[2] - prev_total[2])
        else:
            inp = int(info.get("input_tokens") or 0)
            out = int(info.get("output_tokens") or 0)
            c_read = int(info.get("cached_input_tokens") or 0)

        if sig is not None:
            prev_total = sig

        if not date_str:
            continue
        last_bucket = (date_str, model, project)
        if ep is not None:
            all_timestamps.append((ep, last_bucket))
        if inp == 0 and out == 0 and c_read == 0:
            continue
        records.append((date_str, model, project, inp, out, c_read, 0))

    if not records:
        return []

    buckets = {}
    date_primary = {}
    for date_str, model, proj, inp, out, c_read, c_write in records:
        budget.check()
        if date_str < cutoff_date:
            continue
        bkey = (date_str, model, proj)
        rec = buckets.get(bkey)
        if rec is None:
            rec = {
                "date": date_str,
                "provider": "codex",
                "model": model,
                "input": 0,
                "output": 0,
                "cache_read": 0,
                "cache_write": 0,
                "sessions": 0,
                "active_s": 0,
                "project": proj,
            }
            buckets[bkey] = rec
        rec["input"] += inp
        rec["output"] += out
        rec["cache_read"] += c_read
        rec["cache_write"] += c_write
        tot = inp + out + c_read + c_write
        if date_str not in date_primary or tot > date_primary[date_str][0]:
            date_primary[date_str] = (tot, bkey)

    if not buckets:
        return []

    for _, (_, primary_bkey) in date_primary.items():
        buckets[primary_bkey]["sessions"] += 1

    active_map = _compute_active_seconds(all_timestamps, budget)
    for bkey, secs in active_map.items():
        if bkey in buckets:
            buckets[bkey]["active_s"] += int(round(secs))
        elif bkey[0] in date_primary:
            buckets[date_primary[bkey[0]][1]]["active_s"] += int(round(secs))

    return list(buckets.values())


def _first_present(mapping, keys):
    for k in keys:
        if k in mapping and mapping[k] is not None:
            return mapping[k]
    return None


def _sqlite_file_info(path):
    info = _checked_path(path, stat.S_ISREG)
    sidecars = {}
    for suffix in ("-wal", "-shm", "-journal"):
        try:
            sidecars[suffix] = _checked_path(path.with_name(path.name + suffix), stat.S_ISREG)
        except FileNotFoundError:
            continue
    return info, sidecars.get("-wal")


def _sqlite_projection(columns):
    # Column names originate from the explicit schema allowlists below.
    terms = []
    oversized = []
    for column in columns:
        name = f'"{column}"'
        check = f"length(CAST({name} AS BLOB)) > {MAX_LOG_LINE_BYTES}"
        terms.append(f"CASE WHEN {check} THEN NULL ELSE {name} END AS {name}")
        oversized.append(f"COALESCE({check}, 0)")
    terms.append(f'({" OR ".join(oversized)}) AS "_oversized"')
    return ", ".join(terms)


def _cached_usage_file(cache, key, stamp, budget, read):
    cached = cache.get(key)
    if isinstance(cached, dict) and cached.get("stamp") == stamp and isinstance(cached.get("rows"), list):
        budget.skipped += cached.get("skipped", 0)
        return cached["rows"]

    cache.pop(key, None)
    budget.check()
    before = budget.skipped
    try:
        rows = read()
        budget.check()
    except Exception:
        budget.skipped = before
        raise
    if rows is None:
        budget.skipped = before
        return []
    cache[key] = {"stamp": stamp, "rows": rows, "skipped": budget.skipped - before}
    return rows


def _sqlite_stamp(info, wal):
    return [info.st_size, info.st_mtime_ns, wal.st_size if wal else 0, wal.st_mtime_ns if wal else 0]


def _collect_opencode_rows(db_path, cache, cutoff_ts, cutoff_date, errors, notes):
    budget = _ScanBudget("opencode", notes)
    try:
        st_db, st_wal = _sqlite_file_info(db_path)
    except OSError:
        return []

    try:
        rows = _cached_usage_file(cache, _cache_key("sqlite", db_path), _sqlite_stamp(st_db, st_wal), budget,
                                  lambda: _read_opencode_db(db_path, cutoff_ts, cutoff_date, budget, errors))
    except _ScanExpired:
        budget.report(1, "SQLite record")
        return []
    budget.report(0, "SQLite record")
    return [r for r in rows if r.get("date", "") >= cutoff_date]


def _read_opencode_db(db_path, cutoff_ts, cutoff_date, budget, errors):
    """Inspect a read-only OpenCode SQLite snapshot and extract per-message token usage."""

    uri = db_path.as_uri() + "?mode=ro"
    conn = None
    session_timestamps = {}
    msg_records = []
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=min(2.0, max(0, budget.deadline - time.monotonic())))
        conn.set_progress_handler(budget.expired, 1000)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("BEGIN")

        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row["name"] for row in budget.sqlite_rows(cur)}

        msg_table = next((t for t in ("message", "messages", "session_message") if t in tables), None)
        if not msg_table:
            errors.append("opencode: unknown message table")
            return None

        cur.execute(f'PRAGMA table_info("{msg_table}")')
        msg_cols = [row["name"] for row in budget.sqlite_rows(cur)]

        sess_table = next((t for t in ("session", "sessions", "session_v2") if t in tables), None)
        project_paths = {}
        for pt in ("project", "projects", "project_directory", "worktree", "workspace"):
            if pt not in tables:
                continue
            cur.execute(f'PRAGMA table_info("{pt}")')
            p_cols = [r["name"] for r in budget.sqlite_rows(cur)]
            p_id_col = next((c for c in ("project_id", "id", "worktree_id") if c in p_cols), None)
            p_path_col = next(
                (c for c in ("worktree", "path", "directory", "root", "name") if c in p_cols),
                None,
            )
            if p_id_col and p_path_col:
                projection = _sqlite_projection((p_id_col, p_path_col))
                cur.execute(f'SELECT {projection} FROM "{pt}"')
                for r in budget.sqlite_rows(cur):
                    if r["_oversized"]:
                        budget.skipped += 1
                        continue
                    if r[0] and r[1] and str(r[0]) not in project_paths:
                        project_paths[str(r[0])] = str(r[1])

        session_dirs = {}
        if sess_table:
            cur.execute(f'PRAGMA table_info("{sess_table}")')
            s_cols = [r["name"] for r in budget.sqlite_rows(cur)]
            s_id_col = next((c for c in ("id", "session_id") if c in s_cols), None)
            s_dir_col = next(
                (c for c in ("directory", "cwd", "path", "worktree") if c in s_cols),
                None,
            )
            s_proj_col = next((c for c in ("project_id", "project", "worktree_id") if c in s_cols), None)
            s_data_col = next((c for c in ("data", "metadata", "info", "payload") if c in s_cols), None)
            if s_id_col:
                sel_cols = [s_id_col]
                for c in (s_dir_col, s_proj_col, s_data_col):
                    if c and c not in sel_cols:
                        sel_cols.append(c)
                projection = _sqlite_projection(sel_cols)
                cur.execute(f'SELECT {projection} FROM "{sess_table}"')
                for r in budget.sqlite_rows(cur):
                    if r["_oversized"]:
                        budget.skipped += 1
                        continue
                    d = dict(r)
                    sid = str(d[s_id_col])
                    s_dir = d.get(s_dir_col) if s_dir_col else None
                    if not s_dir and s_data_col and isinstance(d.get(s_data_col), str):
                        try:
                            s_json = json.loads(d[s_data_col])
                            if isinstance(s_json, dict):
                                s_dir = _first_present(s_json, ("directory", "cwd", "path", "worktree"))
                        except ValueError:
                            pass
                    if not s_dir and s_proj_col and d.get(s_proj_col):
                        s_dir = project_paths.get(str(d[s_proj_col]))
                    if s_dir:
                        session_dirs[sid] = str(s_dir)

        json_col = next(
            (c for c in ("data", "metadata", "info", "json", "payload", "body", "content") if c in msg_cols),
            None,
        )
        ts_col = next(
            (c for c in ("time_created", "created_at", "timestamp", "time_updated", "updated_at") if c in msg_cols),
            None,
        )
        sess_col = next((c for c in ("session_id", "session") if c in msg_cols), None)

        has_direct_tokens = any(
            c in msg_cols for c in ("tokens_input", "input_tokens", "tokens")
        )
        if not json_col and not has_direct_tokens:
            errors.append("opencode: unknown message columns")
            return None

        where_clause = ""
        params = ()
        if ts_col:
            cur.execute(f'SELECT CASE WHEN typeof("{ts_col}") IN (\'integer\', \'real\') '
                        f'THEN "{ts_col}" END FROM "{msg_table}" WHERE "{ts_col}" IS NOT NULL LIMIT 1')
            sample = cur.fetchone()
            if sample is not None:
                sv = sample[0]
                if isinstance(sv, (int, float)):
                    cutoff_val = int(cutoff_ts * 1000) if sv > 1e12 else int(cutoff_ts)
                    where_clause = f'WHERE "{ts_col}" >= ?'
                    params = (cutoff_val,)

        allowed = (json_col, ts_col, sess_col, "role", "model_id", "model", "cwd", "directory", "path", "tokens",
                   "tokens_input", "input_tokens", "tokens_output", "output_tokens", "tokens_cache_read",
                   "cache_read_input_tokens", "tokens_cache_write", "cache_creation_input_tokens")
        projection = _sqlite_projection(dict.fromkeys(c for c in allowed if c in msg_cols))
        cur.execute(f'SELECT {projection} FROM "{msg_table}" {where_clause}', params)

        recognized_any = False

        for row in budget.sqlite_rows(cur):
            if row["_oversized"]:
                budget.skipped += 1
                continue
            d = dict(row)
            payload = {}
            if json_col and isinstance(d.get(json_col), str):
                try:
                    parsed = json.loads(d[json_col])
                    if isinstance(parsed, dict):
                        payload = parsed
                        recognized_any = True
                except ValueError:
                    pass

            role = d.get("role") or payload.get("role") or ""
            sid = str(d.get(sess_col) or payload.get("sessionID") or payload.get("session_id") or "")

            raw_ts = d.get(ts_col) if ts_col else None
            if raw_ts is None:
                t_obj = payload.get("time")
                if isinstance(t_obj, dict):
                    raw_ts = _first_present(t_obj, ("created", "completed", "updated"))
                else:
                    raw_ts = _first_present(payload, ("time_created", "createdAt", "timestamp"))
            ep, date_str = _parse_any_ts(raw_ts)
            if ep is not None and ep < cutoff_ts:
                continue

            model_raw = _first_present(d, ("model_id", "model")) or _first_present(
                payload, ("modelID", "model_id", "model")
            )
            if isinstance(model_raw, dict):
                model = str(_first_present(model_raw, ("modelID", "model_id", "id", "name")) or "")
            else:
                model = str(model_raw or "")

            path_obj = payload.get("path") if isinstance(payload.get("path"), dict) else {}
            cwd = (
                _first_present(path_obj, ("cwd", "root"))
                or _first_present(d, ("cwd", "directory", "path"))
                or session_dirs.get(sid, "")
            )
            project = _project_from_cwd(cwd)

            if ep is not None and sid:
                b_hint = (date_str, model, project) if (date_str and model) else None
                session_timestamps.setdefault(sid, []).append((ep, b_hint))

            tokens = payload.get("tokens") if isinstance(payload.get("tokens"), dict) else None
            if tokens is None and isinstance(d.get("tokens"), str):
                try:
                    t_parsed = json.loads(d["tokens"])
                    if isinstance(t_parsed, dict):
                        tokens = t_parsed
                except ValueError:
                    pass
            if tokens is None and isinstance(payload.get("usage"), dict):
                tokens = payload["usage"]

            if tokens is not None:
                recognized_any = True
                inp = int(_first_present(tokens, ("input", "input_tokens")) or 0)
                out = int(_first_present(tokens, ("output", "output_tokens")) or 0)
                cache_obj = tokens.get("cache") if isinstance(tokens.get("cache"), dict) else {}
                c_read = int(
                    _first_present(cache_obj, ("read", "cache_read"))
                    or _first_present(tokens, ("cache_read", "cache_read_input_tokens"))
                    or 0
                )
                c_write = int(
                    _first_present(cache_obj, ("write", "cache_write"))
                    or _first_present(tokens, ("cache_write", "cache_creation_input_tokens"))
                    or 0
                )
            elif has_direct_tokens:
                recognized_any = True
                inp = int(_first_present(d, ("tokens_input", "input_tokens")) or 0)
                out = int(_first_present(d, ("tokens_output", "output_tokens")) or 0)
                c_read = int(_first_present(d, ("tokens_cache_read", "cache_read_input_tokens")) or 0)
                c_write = int(_first_present(d, ("tokens_cache_write", "cache_creation_input_tokens")) or 0)
            else:
                continue

            if role and role != "assistant":
                continue
            if not date_str or not model:
                continue
            if inp == 0 and out == 0 and c_read == 0 and c_write == 0:
                continue

            msg_records.append((sid, date_str, model, project, inp, out, c_read, c_write))

        if not recognized_any and not msg_records and not budget.skipped:
            cur.execute(f'SELECT 1 FROM "{msg_table}" LIMIT 1')
            if cur.fetchone() is not None:
                errors.append("opencode: unknown schema (could not extract token fields)")
                return None

    except sqlite3.Error as exc:
        budget.check()
        errors.append(_short_err("opencode", exc))
        return None
    finally:
        if conn is not None:
            try:
                conn.close()
            except sqlite3.Error:
                pass

    buckets = {}
    session_date_primary = {}
    for sid, date_str, model, project, inp, out, c_read, c_write in msg_records:
        budget.check()
        if date_str < cutoff_date:
            continue
        bkey = (date_str, model, project)
        rec = buckets.get(bkey)
        if rec is None:
            rec = {
                "date": date_str,
                "provider": "opencode",
                "model": model,
                "input": 0,
                "output": 0,
                "cache_read": 0,
                "cache_write": 0,
                "sessions": 0,
                "active_s": 0,
                "project": project,
            }
            buckets[bkey] = rec
        rec["input"] += inp
        rec["output"] += out
        rec["cache_read"] += c_read
        rec["cache_write"] += c_write
        tot = inp + out + c_read + c_write
        sd_key = (sid or "_anon", date_str)
        if sd_key not in session_date_primary or tot > session_date_primary[sd_key][0]:
            session_date_primary[sd_key] = (tot, bkey)

    for _, (_, primary_bkey) in session_date_primary.items():
        buckets[primary_bkey]["sessions"] += 1

    for sid, pairs in session_timestamps.items():
        pairs.sort(key=lambda x: x[0])
        resolved = []
        last_b = None
        for ep, b in pairs:
            budget.check()
            if b is not None:
                last_b = b
            resolved.append((ep, last_b))
        active_map = _compute_active_seconds(resolved, budget)
        for bkey, secs in active_map.items():
            if bkey in buckets:
                buckets[bkey]["active_s"] += int(round(secs))
            else:
                sd_key = (sid, bkey[0])
                if sd_key in session_date_primary:
                    buckets[session_date_primary[sd_key][1]]["active_s"] += int(round(secs))

    return list(buckets.values())


def _collect_jsonl_provider(root_dir, prefix, parser_fn, cache, cutoff_ts, cutoff_date, errors, notes):
    budget = _ScanBudget(prefix, notes)
    live_keys = set()
    rows = []
    pending = 0
    # Inventory stays cheap after the parse deadline and keeps the pending count exact.
    files = sorted(_iter_recent_files(root_dir, ".jsonl", cutoff_ts), key=lambda item: item[1])
    for path_str, size, mtime_ns in files:
        cache_key = _cache_key(prefix, path_str)
        live_keys.add(cache_key)
        try:
            file_rows = _cached_usage_file(cache, cache_key, [size, mtime_ns], budget,
                                          lambda: parser_fn(path_str, cutoff_date, budget))
        except _ScanExpired:
            pending += 1
            continue
        except Exception as exc:
            errors.append(_short_err(prefix, exc))
            continue
        for r in file_rows:
            if r.get("date", "") >= cutoff_date:
                rows.append(r)

    _prune_usage_cache(cache, prefix, live_keys)
    budget.report(pending, "log line")

    return rows


def _prune_usage_cache(cache, provider, live_keys):
    prefix = f"{provider}::"
    for key in list(cache):
        if key.startswith(prefix) and key not in live_keys:
            del cache[key]


def _looks_like_path(s):
    return isinstance(s, str) and ("/" in s or chr(92) in s) and not UUID_RE.match(s.strip())


def _load_agy_folder_map(last_conv_path):
    """Map conversation UUID -> workspace folder from cache/last_conversations.json."""
    raw = _read_json_file(last_conv_path)
    mapping = {}
    if raw is None:
        return mapping

    def record(conv_id, folder):
        if isinstance(conv_id, str) and isinstance(folder, str):
            cid = conv_id.strip()
            fld = folder.strip()
            if UUID_RE.match(cid) and fld and cid not in mapping:
                mapping[cid] = fld

    def walk(node):
        if isinstance(node, dict):
            # Direct object with both id and folder fields
            cid = _first_present(node, ("conversation_id", "conversationId", "id", "last_conversation_id"))
            fld = _first_present(node, ("workspace", "folder", "cwd", "path", "root"))
            if isinstance(cid, str) and isinstance(fld, str):
                record(cid, fld)
            for k, v in node.items():
                if isinstance(v, str):
                    if _looks_like_path(k) and UUID_RE.match(v.strip()):
                        record(v, k)
                    elif UUID_RE.match(k.strip()) and _looks_like_path(v):
                        record(k, v)
                elif isinstance(v, dict):
                    sub_id = _first_present(v, ("conversation_id", "conversationId", "id", "last_conversation_id"))
                    sub_fld = _first_present(v, ("workspace", "folder", "cwd", "path", "root"))
                    if _looks_like_path(k) and isinstance(sub_id, str):
                        record(sub_id, k)
                    elif UUID_RE.match(k.strip()) and isinstance(sub_fld, str):
                        record(k, sub_fld)
                    else:
                        walk(v)
                elif isinstance(v, list):
                    walk(v)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(raw)
    return mapping


def _decode_agy_metadata(blob):
    """Read inferred, undocumented token and context fields from Antigravity metadata."""
    paths = {
        (1, 4, 1): "model",
        (1, 4, 2): "input",
        (1, 4, 3): "output",
        (1, 4, 5): "cache_read",
        (1, 9, 10, 1): "context_tokens",
        (1, 9, 10, 4): "context_window",
    }
    prefixes = {path[:i] for path in paths for i in range(1, len(path))}
    values = {}

    def varint(data, pos):
        value = 0
        for shift in range(0, 70, 7):
            byte = data[pos]
            pos += 1
            if shift == 63 and byte > 1:
                break
            value |= (byte & 127) << shift
            if byte < 128:
                return value, pos
        raise ValueError("invalid varint")

    def walk(data, prefix):
        pos = 0
        while pos < len(data):
            try:
                tag, pos = varint(data, pos)
                field, wire = divmod(tag, 8)
                if not field:
                    return
                path = prefix + (field,)
                if wire == 0:
                    value, pos = varint(data, pos)
                    if path in paths:
                        values[paths[path]] = value
                elif wire == 2:
                    length, pos = varint(data, pos)
                    end = pos + length
                    if end > len(data):
                        return
                    if path in prefixes:
                        walk(data[pos:end], path)
                    pos = end
                elif wire in (1, 5):
                    # Skip fixed-width fields without decoding them.
                    pos += 8 if wire == 1 else 4
                else:
                    return
            except (IndexError, ValueError):
                return

    if isinstance(blob, bytes):
        walk(memoryview(blob), ())
    return values


def _read_agy_db(path, date_str, budget):
    by_model = {}
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=0)) as conn:
        conn.set_progress_handler(budget.expired, 1000)
        try:
            cursor = conn.execute(
                "SELECT CASE WHEN length(data) <= ?1 THEN data END, length(data) > ?1 FROM gen_metadata",
                (MAX_LOG_LINE_BYTES,),
            )
            for blob, oversized in budget.sqlite_rows(cursor):
                if oversized:
                    budget.skipped += 1
                    continue
                if not isinstance(blob, bytes):
                    continue
                values = _decode_agy_metadata(blob)
                input_tokens = values.get("input", 0)
                output_tokens = values.get("output", 0)
                cache_read = values.get("cache_read", 0)
                if not (input_tokens or output_tokens or cache_read):
                    continue
                model = str(values.get("model", ""))
                row = by_model.setdefault(model, {
                    "date": date_str,
                    "provider": "antigravity",
                    "model": model,
                    "input": 0,
                    "output": 0,
                    "cache_read": 0,
                    "cache_write": 0,
                    "sessions": 0,
                    "active_s": 0,
                    "estimated": True,
                })
                row["input"] += input_tokens
                row["output"] += output_tokens
                row["cache_read"] += cache_read
        except sqlite3.Error:
            budget.check()
            raise

    if by_model:
        # A conversation with several models still counts as one session.
        primary = max(by_model.values(), key=lambda row: row["input"] + row["output"] + row["cache_read"])
        primary["sessions"] = 1
    return list(by_model.values())


def _collect_antigravity_sessions(agy_root, cache, cutoff_ts, cutoff_date, now, errors, notes):
    """Read Antigravity token estimates and keep the file-time live signal."""
    budget = _ScanBudget("antigravity", notes)
    conv_dir = agy_root / "conversations"
    folder_map = _load_agy_folder_map(agy_root / "cache" / "last_conversations.json")
    rows = []
    live = []
    live_keys = set()
    files = []
    pending = 0

    try:
        _checked_path(conv_dir, stat.S_ISDIR)
        with os.scandir(conv_dir) as it:
            for entry in it:
                if not entry.name.endswith(".db"):
                    continue
                try:
                    st = entry.stat(follow_symlinks=False)
                except OSError:
                    continue
                if _is_link(st) or not stat.S_ISREG(st.st_mode):
                    continue

                mtime = st.st_mtime
                folder = folder_map.get(entry.name[:-3])
                if (now - mtime) <= AGY_LIVE_WINDOW_S:
                    birth = getattr(st, "st_birthtime", None)
                    if birth is None:
                        birth = st.st_ctime if IS_WINDOWS else min(st.st_ctime, mtime)
                    since_iso = datetime.fromtimestamp(birth, tz=timezone.utc).astimezone().isoformat(timespec="seconds")
                    live_item = {"provider": "antigravity", "since": since_iso}
                    if folder:
                        live_item["folder"] = folder
                    live.append((birth, live_item))

                if mtime >= cutoff_ts:
                    files.append((st.st_size, Path(entry.path), folder))
    except FileNotFoundError:
        pass
    except OSError as exc:
        errors.append(_short_err("antigravity", exc))

    for _, path, folder in sorted(files, key=lambda item: item[0]):
        key = _cache_key("antigravity", path)
        live_keys.add(key)
        try:
            st, wal = _sqlite_file_info(path)
        except OSError:
            continue

        # Metadata rows have no timestamp, so assign them to the file's local mtime day.
        date_str = _epoch_to_local_date(st.st_mtime)
        if date_str < cutoff_date:
            continue
        try:
            file_rows = _cached_usage_file(cache, key, _sqlite_stamp(st, wal) + [date_str], budget,
                                          lambda: _read_agy_db(path, date_str, budget))
        except _ScanExpired:
            pending += 1
            continue
        except sqlite3.Error:
            # Locked, incomplete, and older databases without this table are retried next run.
            continue
        project = _project_from_cwd(folder)
        rows.extend(dict(row, project=project) for row in file_rows)

    _prune_usage_cache(cache, "antigravity", live_keys)
    budget.report(pending, "SQLite record")
    live.sort(key=lambda x: x[0], reverse=True)
    return rows, [item for _, item in live]


def collect_usage(cache_dir, errors, live_out=None, *, notes=None):
    notes = [] if notes is None else notes
    try:
        cache_path = cache_dir / "usage-cache.json"
        raw_cache = _read_cache(cache_path)
        cache_files = raw_cache.get("files", {}) if isinstance(raw_cache, dict) and raw_cache.get("version") == USAGE_CACHE_VERSION else {}
        if not isinstance(cache_files, dict):
            cache_files = {}

        now = time.time()
        cutoff_ts = now - RETENTION_DAYS * 86400
        cutoff_date = (
            datetime.now(timezone.utc).astimezone().date() - timedelta(days=RETENTION_DAYS - 1)
        ).isoformat()

        all_rows = []
        home = Path.home()

        all_rows.extend(
            _collect_jsonl_provider(
                home / ".claude" / "projects",
                "claude",
                _parse_claude_file,
                cache_files,
                cutoff_ts,
                cutoff_date,
                errors,
                notes,
            )
        )
        all_rows.extend(
            _collect_opencode_rows(
                home / ".local" / "share" / "opencode" / "opencode.db",
                cache_files,
                cutoff_ts,
                cutoff_date,
                errors,
                notes,
            )
        )
        all_rows.extend(
            _collect_jsonl_provider(
                home / ".codex" / "sessions",
                "codex",
                _parse_codex_file,
                cache_files,
                cutoff_ts,
                cutoff_date,
                errors,
                notes,
            )
        )
        agy_rows, agy_live = _collect_antigravity_sessions(
            home / ".gemini" / "antigravity-cli",
            cache_files,
            cutoff_ts,
            cutoff_date,
            now,
            errors,
            notes,
        )
        all_rows.extend(agy_rows)
        if isinstance(live_out, list):
            live_out.extend(agy_live)

        _write_json_atomic(cache_path, {"version": USAGE_CACHE_VERSION, "files": cache_files})

        merged = {}
        for r in all_rows:
            d = r.get("date") or ""
            if d < cutoff_date:
                continue
            key = (d, r.get("provider") or "", r.get("model") or "", r.get("project") or "")
            agg = merged.get(key)
            if agg is None:
                agg = {
                    "date": key[0],
                    "provider": key[1],
                    "model": key[2],
                    "input": 0,
                    "output": 0,
                    "cache_read": 0,
                    "cache_write": 0,
                    "sessions": 0,
                    "active_s": 0,
                    "project": key[3],
                }
                merged[key] = agg
            agg["input"] += int(r.get("input") or 0)
            agg["output"] += int(r.get("output") or 0)
            agg["cache_read"] += int(r.get("cache_read") or 0)
            agg["cache_write"] += int(r.get("cache_write") or 0)
            agg["sessions"] += int(r.get("sessions") or 0)
            agg["active_s"] += int(r.get("active_s") or 0)
            if r.get("estimated"):
                agg["estimated"] = True

        days = sorted(
            merged.values(),
            key=lambda x: (x["date"], x["provider"], x["model"], x["project"]),
        )
        return {"days": days}
    except Exception as exc:
        errors.append(_short_err("usage", exc))
        return None


# ---------------------------------------------------------------------------
# Limits & Installed
# ---------------------------------------------------------------------------

def _number(value):
    return type(value) in (int, float) and -sys.float_info.max <= value <= sys.float_info.max


def _limit_window(remaining, reset):
    if not _number(remaining):
        return None
    return {
        "remaining": round(max(0, min(100, remaining)), 1),
        "resets_at": reset if _number(reset) and reset > 0 else None,
    }


def _limit_record(windows, read_at, source="file"):
    if not isinstance(windows, dict):
        return None
    out = {}
    for name, window in windows.items():
        if not isinstance(window, dict):
            continue
        parsed = _limit_window(window.get("remaining"), window.get("resets_at"))
        if parsed:
            if _number(window.get("window_minutes")):
                parsed["window_minutes"] = window["window_minutes"]
            out[name] = parsed
    if not any(out.values()):
        return None
    out.setdefault("five", None)
    out.setdefault("week", None)
    return dict(out, source=source, read_at=read_at)


def _fresh_limits_file(path, now, ttl):
    data = _read_json_file(path)
    at = data.get("at") if isinstance(data, dict) else None
    return data if _number(at) and 0 <= now - at < ttl else None


def _find_rate_limits(value):
    if isinstance(value, dict):
        limits = value.get("rate_limits")
        if isinstance(limits, dict):
            return limits
        value = value.values()
    elif not isinstance(value, list):
        return None
    for child in value:
        found = _find_rate_limits(child)
        if found is not None:
            return found
    return None


def _read_codex_limits(files, budget):
    for path, _, mtime_ns in files:
        try:
            for line in _newest_log_lines(path, CODEX_LIMIT_TAIL_BYTES, budget):
                if '"rate_limits"' not in line:
                    continue
                try:
                    limits = _find_rate_limits(json.loads(line))
                except (ValueError, RecursionError):
                    continue
                if limits is None:
                    continue
                windows = {}
                for key in ("primary", "secondary"):
                    window = limits.get(key)
                    if not isinstance(window, dict):
                        continue
                    try:
                        minutes = int(window.get("window_minutes"))
                    except (TypeError, ValueError, OverflowError):
                        continue
                    if minutes < 1:
                        continue
                    name = ("five" if abs(minutes - 300) <= 30 else
                            "week" if abs(minutes - 10080) <= 360 else
                            "month" if abs(minutes - 43200) <= 1440 else f"window_{minutes}")
                    try:
                        used = float(window.get("used_percent", 0))
                    except (TypeError, ValueError, OverflowError):
                        continue
                    parsed = _limit_window(100 - used, window.get("resets_at"))
                    if parsed:
                        parsed["window_minutes"] = minutes
                        windows[name] = parsed
                record = _limit_record(windows, mtime_ns / 1e9)
                if record:
                    return record
        except OSError:
            continue
    return None


CODEX_LIMITS_CACHE_VERSION = 2


def codex_limits(home, cache_dir, now=None, notes=None):
    now = time.time() if now is None else now
    root = home / ".codex" / "sessions"
    budget = _ScanBudget("limits.codex", [] if notes is None else notes)
    try:
        files = heapq.nlargest(5, _iter_recent_files(root, ".jsonl", 0, budget), key=lambda item: item[2])
    except _ScanExpired:
        budget.notes.append("limits.codex: scan time limit reached")
        return None
    path = cache_dir / "codex-limits.json"
    cached = _read_cache(path)
    if not files:
        if isinstance(cached, dict) and "newest" in cached:
            _write_json_atomic(path, {})
        return None
    newest_file, size, mtime_ns = files[0]
    newest = [_cache_key("codex", newest_file), size, mtime_ns]
    if isinstance(cached, dict) and cached.get("version") == CODEX_LIMITS_CACHE_VERSION and cached.get("newest") == newest:
        data = cached.get("data")
    else:
        try:
            data = _read_codex_limits(files, budget)
        except _ScanExpired:
            budget.notes.append("limits.codex: scan time limit reached")
            return None
        _write_json_atomic(path, {"version": CODEX_LIMITS_CACHE_VERSION, "newest": newest, "data": data})

    # Apply expiration on every run, including when the session log has not changed.
    if data:
        for name, window in list(data.items()):
            if not isinstance(window, dict):
                continue
            reset = window.get("resets_at")
            if reset is not None and reset < now:
                expired = _limit_window(100, None)
                if _number(window.get("window_minutes")):
                    expired["window_minutes"] = window["window_minutes"]
                data[name] = expired
    return data


OPENCODE_QUOTA_RE = re.compile(r"\bOpenCode Go usage limit reached\b", re.IGNORECASE)
OPENCODE_ERROR_RE = re.compile(r"^ERROR\s|(?:^|\s)level=ERROR\b|\bQuotaExceeded\b", re.IGNORECASE)
OPENCODE_RESET_RE = re.compile(r"\s*\(\s*(5-hour|weekly|monthly)\s*,\s*resets in\s+([^)]+)\)", re.IGNORECASE)
LOG_TIMESTAMP_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?")
DURATION_PART_RE = re.compile(
    r"\s*(\d{1,4})\s*(weeks?|days?|hours?|minutes?|seconds?|[wdhms])", re.IGNORECASE
)
DURATION_SECONDS = {"w": 604800, "d": 86400, "h": 3600, "m": 60, "s": 1}


def _parse_opencode_limit(lines, now):
    """Read newest-first log lines and report an active, recognized reset window."""
    for line in lines:
        quota = OPENCODE_QUOTA_RE.search(line)
        if not quota or not OPENCODE_ERROR_RE.search(line):
            continue
        reset = OPENCODE_RESET_RE.match(line, quota.end())
        timestamp = LOG_TIMESTAMP_RE.search(line, 0, quota.start())
        if not reset or not timestamp:
            return None
        try:
            epoch, _ = _parse_iso_to_epoch(timestamp[0])
        except (OSError, OverflowError, ValueError):
            return None
        if epoch is None:
            return None

        window, duration = reset.groups()
        duration = duration.strip()
        if len(duration) > 80:
            return None
        seconds = 0
        pos = 0
        while pos < len(duration):
            part = DURATION_PART_RE.match(duration, pos)
            if not part:
                return None
            seconds += int(part[1]) * DURATION_SECONDS[part[2][0].lower()]
            pos = part.end()
        resets_at = epoch + seconds
        if seconds and resets_at > now:
            return {"reached": {"window": window.lower(), "resets_at": resets_at}, "source": "log"}
        return None
    return None


def opencode_limits(home, now):
    path = home / ".local" / "share" / "opencode" / "log" / "opencode.log"
    try:
        return _parse_opencode_limit(_newest_log_lines(path, OPENCODE_LIMIT_TAIL_BYTES), now)
    except OSError:
        return None


def _parse_agy_limits(payload, read_at):
    """Normalize the Gemini buckets from the JSON or tab-delimited /usage reply."""
    if not isinstance(payload, dict):
        return None
    windows = {}

    def record(name, remaining, reset):
        name = str(name).strip().lower()
        if name in ("5h", "5 h", "5-hour") or "five hour" in name or "five-hour" in name:
            key = "five"
        elif name == "week" or "weekly" in name:
            key = "week"
        else:
            return
        try:
            reset, _ = _parse_any_ts(reset)
        except (OverflowError, OSError, ValueError):
            reset = None
        window = _limit_window(remaining, reset)
        if window and (key not in windows or window["remaining"] < windows[key]["remaining"]):
            windows[key] = window

    command = payload.get("command")
    data = command.get("data") if isinstance(command, dict) else None
    groups = data.get("groups") if isinstance(data, dict) else None
    if isinstance(groups, list):
        for group in groups:
            if not isinstance(group, dict) or "gemini" not in str(group.get("name", "")).lower():
                continue
            buckets = group.get("buckets")
            if not isinstance(buckets, list):
                continue
            for bucket in buckets:
                fraction = bucket.get("remaining_fraction") if isinstance(bucket, dict) else None
                if _number(fraction):
                    record(bucket.get("window"), fraction * 100, bucket.get("reset_time"))
    response = payload.get("response")
    if not windows and isinstance(response, str):
        for line in response.strip().splitlines():
            parts = line.split("\t")
            if len(parts) < 3 or "gemini" not in parts[0].lower():
                continue
            pct = re.search(r"(\d+(?:\.\d+)?)\s*%", parts[2])
            if pct:
                record(parts[1], float(pct[1]), parts[3].strip() if len(parts) > 3 else None)
    return _limit_record(windows, read_at, source="cli")


def _probe_agy_limits(cache_dir, now, errors):
    path = cache_dir / "antigravity-quota.json"
    cached = _read_cache(path)
    fetched_at = cached.get("fetched_at") if isinstance(cached, dict) else None
    if _number(fetched_at) and 0 <= now - fetched_at < AGY_CACHE_TTL_S:
        if "limits" in cached:
            return cached["limits"]
        return _parse_agy_limits(cached.get("data"), fetched_at)
    if IS_WINDOWS and os.environ.get("HERDR_CONTROL_AGY_PROBE") != "1":
        return None
    agy_bin = shutil.which("agy")
    if not agy_bin:
        return None

    # Start the cooldown before calling the CLI, even when the probe fails.
    _write_json_atomic(path, {"fetched_at": now, "limits": None})
    try:
        res = _run([agy_bin, "-p", "/usage", "--output-format", "json"], timeout=AGY_TIMEOUT)
        if res.returncode != 0:
            errors.append(f"limits.antigravity: agy exited {res.returncode}")
            return None
        limits = _parse_agy_limits(json.loads(res.stdout), now)
        _write_json_atomic(path, {"fetched_at": now, "limits": limits})
        return limits
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        errors.append(f"limits.antigravity: {type(exc).__name__}")
        return None


def collect_limits(cache_dir, errors, home=None, now=None, *, notes=None):
    home = Path.home() if home is None else home
    now = time.time() if now is None else now
    claude_dir = home / ".claude"
    claude = _fresh_limits_file(claude_dir / "limits-claude.json", now, 6 * 3600)
    agy = _fresh_limits_file(claude_dir / "limits.json", now, 3600)
    if agy is None:
        antigravity = _probe_agy_limits(cache_dir, now, errors)
    else:
        groups = agy.get("agy")
        antigravity = _limit_record(groups.get("gemini"), agy["at"]) if isinstance(groups, dict) else None
    return {
        "claude": _limit_record(claude.get("claude"), claude["at"]) if claude else None,
        "codex": codex_limits(home, cache_dir, now, notes),
        "antigravity": antigravity,
        "opencode": opencode_limits(home, now),
    }


def collect_installed(errors, home=None):
    cmds = ("claude", "opencode", "codex", "agy", "pi", "gemini")
    base_home = Path.home() if home is None else Path(home)
    search_path = os.pathsep.join(
        p for p in (os.environ.get("PATH", ""), str(base_home / ".opencode" / "bin"), str(base_home / ".local" / "bin")) if p
    )
    try:
        return {cmd: shutil.which(cmd, path=search_path) is not None for cmd in cmds}
    except Exception as exc:
        errors.append(_short_err("installed", exc))
        return None


def collect_ssh_hosts(home=None):
    """Read simple SSH Host/HostName pairs without expanding wildcards."""
    path = (Path.home() if home is None else Path(home)) / ".ssh" / "config"
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    aliases, hostname = [], None
    out = []
    def flush():
        if hostname:
            out.extend({"alias": alias, "hostname": hostname} for alias in aliases)
    for line in lines:
        try:
            parts = shlex.split(line, comments=True)
        except ValueError:
            continue
        if len(parts) < 2:
            continue
        key, value = parts[0].lower(), parts[1]
        if key == "host":
            flush()
            aliases = [item for item in parts[1:] if not any(c in item for c in "*?!")]
            hostname = None
        elif key == "hostname" and aliases:
            hostname = value
    flush()
    return out[:1000]


# ---------------------------------------------------------------------------
# Network traffic
# ---------------------------------------------------------------------------

def _should_skip_iface(name):
    s = (name or "").strip().lower()
    if not s:
        return True
    if s == "lo" or s == "loopback" or s.startswith("loopback ") or (s.startswith("lo") and s[2:].isdigit()):
        return True
    return any(s.startswith(pfx) for pfx in SKIP_IFACE_PREFIXES)


def _date_dict_to_str(d_obj):
    if not isinstance(d_obj, dict):
        return None
    y = d_obj.get("year")
    m = d_obj.get("month")
    d = d_obj.get("day")
    if isinstance(y, int) and isinstance(m, int) and isinstance(d, int) and y > 0 and 1 <= m <= 12 and 1 <= d <= 31:
        return f"{y:04d}-{m:02d}-{d:02d}"
    return None


def _date_str_to_iso(date_str):
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d").astimezone()
        return dt.isoformat(timespec="seconds")
    except ValueError:
        return _now_iso()


def _collect_network_vnstat(vnstat_bin, cutoff_date):
    res = _run([vnstat_bin, "--json", "d"], timeout=CMD_TIMEOUT)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or f"vnstat exited {res.returncode}")
    data = json.loads(res.stdout)
    ver_raw = str(data.get("jsonversion") or "1").split(".", 1)[0]
    json_ver = int(ver_raw) if ver_raw.isdigit() else 1
    mult = 1 if json_ver >= 2 else 1024

    ifaces = []
    days_map = {}
    earliest_created = None
    earliest_day = None

    for iface in data.get("interfaces") or []:
        if not isinstance(iface, dict):
            continue
        name = (iface.get("name") or iface.get("id") or "").strip()
        if _should_skip_iface(name):
            continue
        ifaces.append(name)

        created_obj = iface.get("created")
        if isinstance(created_obj, dict):
            c_str = _date_dict_to_str(created_obj.get("date") if isinstance(created_obj.get("date"), dict) else created_obj)
            if c_str and (earliest_created is None or c_str < earliest_created):
                earliest_created = c_str

        traffic = iface.get("traffic") or {}
        day_list = traffic.get("day") if isinstance(traffic.get("day"), list) else traffic.get("days")
        if not isinstance(day_list, list):
            continue
        for entry in day_list:
            if not isinstance(entry, dict):
                continue
            d_str = _date_dict_to_str(entry.get("date"))
            if not d_str:
                continue
            if earliest_day is None or d_str < earliest_day:
                earliest_day = d_str
            if d_str < cutoff_date:
                continue
            rx_b = max(0, int(entry.get("rx") or 0) * mult)
            tx_b = max(0, int(entry.get("tx") or 0) * mult)
            rec = days_map.get(d_str)
            if rec is None:
                days_map[d_str] = {"rx_b": rx_b, "tx_b": tx_b}
            else:
                rec["rx_b"] += rx_b
                rec["tx_b"] += tx_b

    if not ifaces:
        raise RuntimeError("vnstat returned no interfaces")

    since_date = earliest_created or earliest_day
    since_iso = _date_str_to_iso(since_date) if since_date else _now_iso()
    days = [
        {"date": d, "rx_b": v["rx_b"], "tx_b": v["tx_b"]}
        for d, v in sorted(days_map.items())
    ]
    return {
        "source": "vnstat",
        "ifaces": sorted(set(ifaces)),
        "days": days,
        "since": since_iso,
        "resets": 0,
    }


def _read_iface_counters_linux():
    counters = {}
    with open(_linux_sys_path("proc", "net", "dev"), "r", encoding="utf-8") as f:
        for line in f:
            if ":" not in line:
                continue
            iface_raw, rest = line.split(":", 1)
            name = iface_raw.strip()
            if _should_skip_iface(name):
                continue
            cols = rest.split()
            if len(cols) < 9:
                continue
            if not (cols[0].isdigit() and cols[8].isdigit()):
                continue
            counters[name] = (int(cols[0]), int(cols[8]))
    return counters


def _read_iface_counters_macos():
    res = _run(["netstat", "-ib"], timeout=CMD_TIMEOUT)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or f"netstat exited {res.returncode}")

    lines = res.stdout.splitlines()
    tail_cols = None
    ib_idx = None
    ob_idx = None
    counters = {}
    seen_link = set()

    for line in lines:
        parts = line.split()
        if not parts:
            continue
        if tail_cols is None:
            if parts[0] == "Name" and "Ipkts" in parts and "Ibytes" in parts and "Obytes" in parts:
                tail_cols = parts[parts.index("Ipkts"):]
                ib_idx = tail_cols.index("Ibytes")
                ob_idx = tail_cols.index("Obytes")
            continue
        if len(parts) < 3 + len(tail_cols):
            continue
        name = parts[0]
        if not name.startswith("en") or _should_skip_iface(name):
            continue
        tail = parts[-len(tail_cols):]
        ib_s, ob_s = tail[ib_idx], tail[ob_idx]
        if not (ib_s.isdigit() and ob_s.isdigit()):
            continue
        is_link = parts[2].startswith("<Link#")
        if name not in seen_link:
            if is_link:
                counters[name] = (int(ib_s), int(ob_s))
                seen_link.add(name)
            elif name not in counters:
                counters[name] = (int(ib_s), int(ob_s))
    return counters


def _read_iface_counters_windows():
    ps_cmd = (
        "@(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | "
        "Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes) | "
        "ConvertTo-Json -Compress"
    )
    res = _run(
        ["powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps_cmd],
        timeout=CMD_TIMEOUT,
    )
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or f"powershell exited {res.returncode}")
    raw_text = res.stdout.strip()
    if not raw_text:
        return {}
    parsed = json.loads(raw_text)
    if isinstance(parsed, dict):
        parsed = [parsed]
    counters = {}
    for item in parsed:
        if not isinstance(item, dict):
            continue
        name = (item.get("Name") or "").strip()
        if _should_skip_iface(name):
            continue
        rx_b = max(0, int(item.get("ReceivedBytes") or 0))
        tx_b = max(0, int(item.get("SentBytes") or 0))
        counters[name] = (rx_b, tx_b)
    return counters


def collect_network(cache_dir, errors):
    today_date = datetime.now(timezone.utc).astimezone().date()
    today_str = today_date.isoformat()
    cutoff_date = (today_date - timedelta(days=NETWORK_RETENTION_DAYS - 1)).isoformat()

    if IS_LINUX:
        vnstat_bin = shutil.which("vnstat")
        if vnstat_bin:
            try:
                return _collect_network_vnstat(vnstat_bin, cutoff_date)
            except Exception:
                pass

    try:
        if IS_WINDOWS:
            current = _read_iface_counters_windows()
        elif IS_MACOS:
            current = _read_iface_counters_macos()
        else:
            current = _read_iface_counters_linux()
    except Exception as exc:
        errors.append(_short_err("network", exc))
        return None

    cache_path = cache_dir / "network-cache.json"
    raw_cache = _read_cache(cache_path)
    now_iso = _now_iso()

    if (
        not isinstance(raw_cache, dict)
        or not isinstance(raw_cache.get("last"), dict)
    ):
        since = now_iso
        resets = 0
        last = {k: {"rx_b": rx, "tx_b": tx} for k, (rx, tx) in current.items()}
        days_map = {today_str: {"rx_b": 0, "tx_b": 0}}
    else:
        since = raw_cache.get("since") or now_iso
        resets = int(raw_cache.get("resets") or 0)
        prev_last = raw_cache.get("last") or {}
        raw_days = raw_cache.get("days") if isinstance(raw_cache.get("days"), dict) else {}

        days_map = {}
        for d_str, vals in raw_days.items():
            if isinstance(d_str, str) and d_str >= cutoff_date and isinstance(vals, dict):
                days_map[d_str] = {
                    "rx_b": max(0, int(vals.get("rx_b") or 0)),
                    "tx_b": max(0, int(vals.get("tx_b") or 0)),
                }
        if today_str not in days_map:
            days_map[today_str] = {"rx_b": 0, "tx_b": 0}

        new_last = {}
        for k, v in prev_last.items():
            if isinstance(k, str) and isinstance(v, dict) and not _should_skip_iface(k):
                new_last[k] = {
                    "rx_b": max(0, int(v.get("rx_b") or 0)),
                    "tx_b": max(0, int(v.get("tx_b") or 0)),
                }

        for iface, (rx, tx) in current.items():
            old = prev_last.get(iface)
            if isinstance(old, dict):
                old_rx = max(0, int(old.get("rx_b") or 0))
                old_tx = max(0, int(old.get("tx_b") or 0))
                if rx < old_rx or tx < old_tx:
                    resets += 1
                d_rx = rx if rx < old_rx else (rx - old_rx)
                d_tx = tx if tx < old_tx else (tx - old_tx)
                days_map[today_str]["rx_b"] += d_rx
                days_map[today_str]["tx_b"] += d_tx
            new_last[iface] = {"rx_b": rx, "tx_b": tx}

        last = new_last

    _write_json_atomic(
        cache_path,
        {
            "version": 1,
            "since": since,
            "resets": resets,
            "last": last,
            "days": days_map,
        },
    )

    days = [
        {"date": d, "rx_b": v["rx_b"], "tx_b": v["tx_b"]}
        for d, v in sorted(days_map.items())
    ]
    return {
        "source": "counters",
        "ifaces": sorted(current.keys()),
        "days": days,
        "since": since,
        "resets": resets,
    }


# ---------------------------------------------------------------------------
# Remote machines (via hc machine ls / hc exec)
# ---------------------------------------------------------------------------

REMOTE_SHELL_SCRIPT = (
    "ss -tlnpH 2>/dev/null || ss -tlnH 2>&1; "
    "rc_ss=$?; echo ''; echo '===HC_SS_RC:'\"$rc_ss\"'==='; "
    "echo '===HC_PS==='; "
    "docker ps --format '{{json .}}' 2>&1; "
    "rc_ps=$?; echo ''; echo '===HC_PS_RC:'\"$rc_ps\"'==='; "
    "echo '===HC_STATS==='; "
    "if [ \"$rc_ps\" -eq 0 ]; then "
    "docker stats --no-stream --format '{{json .}}' 2>&1; rc_st=$?; "
    "else rc_st=\"$rc_ps\"; fi; "
    "echo ''; echo '===HC_STATS_RC:'\"$rc_st\"'==='"
)


def _find_hc():
    path = shutil.which("hc")
    if path:
        return path
    if IS_WINDOWS:
        local_app = os.environ.get("LOCALAPPDATA") or os.path.join(
            os.path.expanduser("~"), "AppData", "Local"
        )
        candidate = os.path.join(local_app, "Programs", "herdr-core", "hc.exe")
        if os.path.isfile(candidate):
            return candidate
    else:
        # GUI-launched apps on macOS get a minimal PATH without ~/.local/bin.
        candidate = os.path.join(os.path.expanduser("~"), ".local", "bin", "hc")
        if os.path.isfile(candidate):
            return candidate
    return None


def _parse_rc_marker(line, prefix):
    if line.startswith(prefix) and line.endswith("==="):
        val = line[len(prefix):-3].strip()
        if val.lstrip("-").isdigit():
            return int(val)
    return None


def _parse_remote_exec_output(stdout):
    section = "ss"
    buckets = {"ss": [], "docker_ps": [], "docker_stats": []}
    rcs = {"ss": None, "docker_ps": None, "docker_stats": None}

    for raw_line in (stdout or "").splitlines():
        line = raw_line.strip("\r")
        if line == "===HC_PS===":
            section = "docker_ps"
            continue
        if line == "===HC_STATS===":
            section = "docker_stats"
            continue
        rc = _parse_rc_marker(line, "===HC_SS_RC:")
        if rc is not None:
            rcs["ss"] = rc
            continue
        rc = _parse_rc_marker(line, "===HC_PS_RC:")
        if rc is not None:
            rcs["docker_ps"] = rc
            continue
        rc = _parse_rc_marker(line, "===HC_STATS_RC:")
        if rc is not None:
            rcs["docker_stats"] = rc
            continue
        buckets[section].append(line)

    ss_rows = []
    ss_bytes = 0
    for line in buckets["ss"]:
        parts = line.split(maxsplit=5)
        if len(parts) < 5 or parts[0] != "LISTEN" or not (parts[1].isdigit() and parts[2].isdigit()):
            continue
        addr, sep, port = parts[3].rpartition(":")
        if not sep or _serve_port(port) is None or not re.fullmatch(r"[a-zA-Z0-9_.:%*\[\]-]{1,200}", addr):
            continue
        row = f"LISTEN 0 0 {addr}:{port} *:*"
        match = SS_PROC_RE.search(parts[5]) if len(parts) > 5 else None
        if match and re.fullmatch(r"[\w .+-]{1,128}", match[1]):
            row += f' users:(("{match[1]}",pid={match[2][:12]}))'
        ss_bytes += len(row.encode("utf-8")) + 1
        if ss_bytes > MAX_PROBE_BYTES:
            break
        ss_rows.append(row)
    notes = []
    ps = _clean_docker_output(buckets["docker_ps"], DOCKER_PS_FIELDS, notes) if rcs["docker_ps"] == 0 else ""
    stats = _clean_docker_output(buckets["docker_stats"], DOCKER_STATS_FIELDS, notes) if rcs["docker_stats"] == 0 else ""
    return {
        "ss": "\n".join(ss_rows),
        "ss_rc": rcs["ss"],
        "docker_ps": ps,
        "docker_ps_rc": rcs["docker_ps"],
        "docker_stats": stats,
        "docker_stats_rc": rcs["docker_stats"],
        "error": None,
    }


def _collect_one_remote(hc_bin, name):
    cmd = [hc_bin, "exec", "--on", name, "--", "sh", "-c", REMOTE_SHELL_SCRIPT]
    res = _run(cmd, timeout=CMD_TIMEOUT)
    if res.returncode != 0:
        if "cannot start sh" in res.stderr:
            return None
        if not (res.stdout or "").strip():
            raise RuntimeError(f"hc exec exited {res.returncode}")
    return _parse_remote_exec_output(res.stdout)


def collect_remote(errors):
    hc_bin = _find_hc()
    if not hc_bin:
        errors.append("remote: hc command not found")
        return None
    try:
        res = _run([hc_bin, "machine", "ls", "--json"], timeout=CMD_TIMEOUT)
        if res.returncode != 0:
            errors.append(f"remote: hc machine ls exited {res.returncode}")
            return None
        raw = json.loads(res.stdout or "{}")
    except Exception as exc:
        errors.append(_short_err("remote", exc))
        return None

    machines = raw.get("machines") if isinstance(raw, dict) else None
    if not isinstance(machines, list):
        return {}

    targets = []
    for m in machines:
        if not isinstance(m, dict):
            continue
        name = (m.get("name") or "").strip()
        if not name or m.get("temporary"):
            continue
        if m.get("state") == "connected":
            targets.append(name)

    if not targets:
        return {}

    out = {}
    with ThreadPoolExecutor(max_workers=min(4, len(targets))) as pool:
        future_map = {pool.submit(_collect_one_remote, hc_bin, name): name for name in targets}
        for fut in as_completed(future_map):
            name = future_map[fut]
            try:
                result = fut.result()
                if result is not None:
                    out[name] = result
            except Exception as exc:
                errors.append(_short_err("remote probe", exc))
                out[name] = {
                    "ss": "",
                    "ss_rc": None,
                    "docker_ps": "",
                    "docker_ps_rc": None,
                    "docker_stats": "",
                    "docker_stats_rc": None,
                    "error": _short_err("unreachable", exc),
                }
    return out


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _clean_docker_output(lines, fields, notes):
    records = []
    size = 0
    for line in lines:
        try:
            raw = json.loads(line)
        except (ValueError, RecursionError):
            continue
        if not isinstance(raw, dict) or not any(isinstance(raw.get(k), str) and raw[k]
                                                  for k in ("ID", "Name", "Names", "Container")):
            continue
        row = {key: raw[key][:4096] for key in fields if isinstance(raw.get(key), str)}
        encoded = json.dumps(row, separators=(",", ":"))
        size += len(encoded) + 1
        if size > MAX_PROBE_BYTES:
            notes.append("docker: record output limit reached; results may be partial")
            break
        records.append(encoded)
    return "\n".join(records)


def collect_docker(errors, notes):
    docker_bin = shutil.which("docker")
    if not docker_bin:
        errors.append("docker: command not found")
        return None
    result = {}
    for action, args, fields in (("ps", [], DOCKER_PS_FIELDS),
                                 ("stats", ["--no-stream"], DOCKER_STATS_FIELDS)):
        key = f"docker_{action}"
        try:
            res = _run([docker_bin, action, *args, "--format", "{{json .}}"])
        except (OSError, subprocess.SubprocessError) as exc:
            errors.append(_short_err(f"docker {action}", exc))
            return result or None
        result[key + "_rc"] = res.returncode
        if res.returncode != 0:
            errors.append(f"docker {action}: exited {res.returncode}")
            break
        result[key] = _clean_docker_output(iter(res.stdout.splitlines()), fields, notes)
        if action == "ps" and not result[key]:
            break
    return result


def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    parser = argparse.ArgumentParser(description="Herdr Control system and agent collector")
    parser.add_argument("--light", action="store_true", help="Collect only system, ports, and network")
    parser.add_argument("--remote", action="store_true", help="Collect host metrics for a Herdr peer")
    args = parser.parse_args()

    errors, notes = [], []
    cache_dir = _get_cache_dir()

    system_data = collect_system(errors)

    if args.remote:
        ts_bin = _find_tailscale()
        serve, funnel_ports = _collect_serve(ts_bin, errors) if ts_bin else ([], [])
        out = {
            "version": 1,
            "generated_at": _now_iso(),
            "system": system_data,
            "ports": collect_ports({"serve": serve, "funnel_ports": funnel_ports}, errors),
            "docker": collect_docker(errors, notes),
            "network": collect_network(cache_dir, errors),
            "errors": errors,
            "notes": notes,
        }
        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        return 0

    if args.light:
        ports_data = collect_ports(None, errors)
        network_data = collect_network(cache_dir, errors)
        out = {
            "version": 1,
            "generated_at": _now_iso(),
            "system": system_data,
            "tailscale": None,
            "ports": ports_data,
            "usage": None,
            "live": [],
            "network": network_data,
            "limits": dict.fromkeys(LIMIT_PROVIDERS),
            "installed": None,
            "remote": None,
            "errors": errors,
            "notes": notes,
        }
        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        return 0

    tailscale_raw = collect_tailscale(errors)
    ports_data = collect_ports(tailscale_raw, errors)
    if isinstance(tailscale_raw, dict):
        tailscale_raw.pop("_self_ips", None)

    live_data = []
    usage_data = collect_usage(cache_dir, errors, live_out=live_data, notes=notes)
    network_data = collect_network(cache_dir, errors)
    limits_data = collect_limits(cache_dir, errors, notes=notes)
    installed_data = collect_installed(errors)
    remote_data = collect_remote(errors)

    out = {
        "version": 1,
        "generated_at": _now_iso(),
        "system": system_data,
        "tailscale": tailscale_raw,
        "ssh_hosts": collect_ssh_hosts(),
        "ports": ports_data,
        "usage": usage_data,
        "live": live_data,
        "network": network_data,
        "limits": limits_data,
        "installed": installed_data,
        "remote": remote_data,
        "errors": errors,
        "notes": notes,
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
