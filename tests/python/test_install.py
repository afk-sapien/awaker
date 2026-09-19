"""Exercise an installed wheel, including bundled assets and the bundled runtime."""

from contextlib import contextmanager
import http.client
from importlib.metadata import version
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest

from awaker.cli import app_root


class InstalledApplicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="awaker-wheel-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.environment = {
            key: value for key, value in os.environ.items()
            if not key.startswith(("AWAKER_", "SUNDAY_", "NTFY_")) and key not in ("PORT", "SLEEPER_USERNAME", "NODE_OPTIONS")
        }
        self.environment["AWAKER_HOME"] = str(self.directory / "state")
        # The launcher must work without any system Node executable on PATH.
        self.environment["PATH"] = str(self.directory)

    def run_cli(self, *arguments, **kwargs):
        return subprocess.run(
            [sys.executable, "-m", "awaker", *arguments], cwd=self.directory,
            env=self.environment, capture_output=True, text=True, timeout=30, **kwargs,
        )

    @contextmanager
    def server(self, mode="serve", extra=()):
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        log = tempfile.TemporaryFile(mode="w+")
        options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {}
        process = subprocess.Popen(
            [sys.executable, "-m", "awaker", mode, "--port", str(port), *extra],
            cwd=self.directory, env=self.environment, stdout=log, stderr=log, **options,
        )
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    log.seek(0)
                    self.fail(f"Launcher exited with {process.returncode}: {log.read()}")
                try:
                    self.request(port, "/")
                    break
                except OSError:
                    time.sleep(0.05)
            else:
                self.fail("Launcher did not become ready")
            yield port
        finally:
            if process.poll() is None:
                if os.name == "nt":
                    process.send_signal(signal.CTRL_BREAK_EVENT)
                else:
                    process.terminate()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                    self.fail("Launcher did not stop on signal")
            log.close()

    def request(self, port, path, method="GET", headers=None, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_version_and_console_entry_point(self):
        result = self.run_cli("--version")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), f"Awaker {version('awaker')}")
        from importlib.metadata import distribution
        self.assertTrue(any(entry.name == "awaker" for entry in distribution("awaker").entry_points))

    def test_bundled_assets_include_all_javascript_imports(self):
        root = app_root()
        self.assertEqual(json.loads((root / "package.json").read_text())["version"], version("awaker"))
        import re
        for source in [*root.glob("dist/*.js"), *root.glob("server/*.js")]:
            for relative in re.findall(r"(?:from\s*|import\s*)['\"](\.[^'\"]+)['\"]", source.read_text(encoding="utf-8")):
                self.assertTrue((source.parent / relative.split("?")[0]).resolve().is_file(), f"Missing import {relative} in {source.name}")

    def test_dashboard_runs_outside_checkout_without_system_node(self):
        # An unrelated working-directory env file must not affect an installed app.
        (self.directory / ".env").write_text("AWAKER_HOST=not-a-host\n")
        with self.server() as port:
            status, headers, body = self.request(port, "/")
            self.assertEqual(status, 200)
            self.assertIn(b"Awaker", body)
            self.assertIn("script-src 'self'", headers["Content-Security-Policy"])
            for path in ("/app.js", "/boot.js", "/themes.js", "/styles.css", "/favicon.svg", "/integrations.html"):
                self.assertEqual(self.request(port, path)[0], 200, path)
            self.assertEqual(self.request(port, "/package.json")[0], 404)
            self.assertEqual(self.request(port, "/", headers={"Host": "evil.example"})[0], 403)
        self.assertFalse((self.directory / "state").exists())

    def test_setup_is_private_and_preserves_existing_tokens(self):
        result = self.run_cli("setup")
        self.assertEqual(result.returncode, 0, result.stderr)
        target = self.directory / "state" / ".env"
        before = target.read_bytes()
        values = dict(line.split("=", 1) for line in before.decode().splitlines())
        self.assertNotEqual(values["AWAKER_ADMIN_TOKEN"], values["AWAKER_AGENT_TOKEN"])
        self.assertEqual(len(values["AWAKER_ADMIN_TOKEN"]), 64)
        self.assertNotIn(values["AWAKER_ADMIN_TOKEN"], result.stdout)
        if os.name != "nt":
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.run_cli("setup").returncode, 0)
        self.assertEqual(target.read_bytes(), before)

    def test_service_persists_state_outside_package(self):
        self.assertEqual(self.run_cli("setup").returncode, 0)
        values = dict(line.split("=", 1) for line in (self.directory / "state" / ".env").read_text().splitlines())
        headers = {"Authorization": f"Bearer {values['AWAKER_ADMIN_TOKEN']}", "Content-Type": "application/json"}
        with self.server("service") as port:
            self.assertEqual(self.request(port, "/api/v1/settings")[0], 401)
            self.assertEqual(self.request(port, "/api/v1/settings", "PUT", headers, json.dumps({"timezone": "UTC"}))[0], 200)
            self.assertEqual(self.request(port, "/healthz")[0], 200)
        with self.server("service") as port:
            settings = json.loads(self.request(port, "/api/v1/settings", headers=headers)[2])
            self.assertEqual(settings["settings"]["timezone"], "UTC")
        self.assertTrue((self.directory / "state" / "awaker.sqlite").is_file())
        self.assertFalse((app_root() / "data").exists())

    def test_explicit_environment_file_and_external_database(self):
        custom = self.directory / "custom.env"
        database = self.directory / "custom.sqlite"
        custom.write_text(f"SUNDAY_ADMIN_TOKEN={'a' * 40}\nSUNDAY_AGENT_TOKEN={'b' * 40}\nAWAKER_DB={database.as_posix()}\n")
        with self.server("service", ("--env-file", str(custom))) as port:
            self.assertEqual(self.request(port, "/healthz")[0], 200)
        self.assertTrue(database.is_file())

    def test_mcp_has_clean_protocol_output(self):
        self.environment["AWAKER_AGENT_TOKEN"] = "a" * 40
        message = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-11-25", "clientInfo": {"name": "test", "version": "1"}, "capabilities": {}}}
        result = self.run_cli("mcp", input=json.dumps(message) + "\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["result"]["serverInfo"]["name"], "awaker")

    def test_configuration_errors_are_actionable(self):
        self.assertIn("setup", self.run_cli("service").stderr)
        self.assertEqual(self.run_cli("--port", "65536").returncode, 1)
        self.assertIn("does not exist", self.run_cli("--env-file", "missing.env").stderr)


if __name__ == "__main__":
    unittest.main()
