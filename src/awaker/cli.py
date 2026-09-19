"""Launch the packaged app without requiring a separate Node installation."""

import argparse
from importlib.metadata import version
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys


def app_root():
    root = Path(__file__).resolve().parent / "_app"
    if not (root / "dist" / "index.html").is_file():
        raise RuntimeError("Application assets are missing. Reinstall Awaker from a wheel or source archive.")
    return root


def state_directory():
    if os.environ.get("AWAKER_HOME"):
        return Path(os.environ["AWAKER_HOME"]).expanduser().resolve()
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "Awaker"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Awaker"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "awaker"


def setup(directory):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = directory / ".env"
    content = (
        f"AWAKER_ADMIN_TOKEN={secrets.token_hex(32)}\n"
        f"AWAKER_AGENT_TOKEN={secrets.token_hex(32)}\n"
    )
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        print(f"Existing configuration kept: {target}")
        return
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(content)
    print(f"Created private configuration: {target}")
    print("Sign in using AWAKER_ADMIN_TOKEN from that file. Keep the owner token out of agent configurations.")


def node_executable():
    try:
        from nodejs_wheel import node
    except ImportError as error:
        raise RuntimeError("Bundled runtime is missing. Reinstall Awaker with its dependencies.") from error

    result = node(["-p", "process.execPath"], return_completed_process=True, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def launch(executable, arguments, environment):
    command = [executable, *arguments]
    # Replace the launcher so service managers and Ctrl+C reach Node directly.
    if os.name != "nt":
        os.execve(executable, command, environment)
    child = subprocess.Popen(command, env=environment)
    previous = {}

    def stop(signum, frame):
        child.terminate()

    for name in ("SIGTERM", "SIGBREAK"):
        if hasattr(signal, name):
            sig = getattr(signal, name)
            previous[sig] = signal.signal(sig, stop)
    try:
        try:
            return child.wait()
        except KeyboardInterrupt:
            child.terminate()
            return child.wait(timeout=15)
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def parser():
    result = argparse.ArgumentParser(description="Run Awaker locally or as a background service.")
    result.add_argument("command", nargs="?", choices=["serve", "service", "setup", "mcp"], default="serve")
    result.add_argument("--version", action="version", version=f"Awaker {version('awaker')}")
    result.add_argument("--host", help="Bind address, default 127.0.0.1")
    result.add_argument("--port", type=int, help="Listening port, default 4173")
    result.add_argument("--public-url", help="Exact browser origin, such as https://awaker.example.com")
    result.add_argument("--data-dir", type=Path, help="Configuration and database directory")
    result.add_argument("--env-file", type=Path, help="Use a specific environment file instead of the user configuration")
    return result


def main(argv=None):
    arguments = parser().parse_args(argv)
    try:
        directory = (arguments.data_dir or state_directory()).expanduser().resolve()
        if arguments.command == "setup":
            if arguments.env_file:
                raise ValueError("Setup writes DATA_DIR/.env. Use --data-dir to choose its directory.")
            setup(directory)
            return 0
        if arguments.port is not None and not 1 <= arguments.port <= 65535:
            raise ValueError("Port must be between 1 and 65535.")
        root = app_root()
        environment = os.environ.copy()
        env_file = arguments.env_file.expanduser().resolve() if arguments.env_file else directory / ".env"
        if arguments.env_file and not env_file.is_file():
            raise ValueError(f"Environment file does not exist: {env_file}")
        if arguments.command == "service":
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            configured_tokens = all(
                environment.get(f"AWAKER_{role}_TOKEN") or environment.get(f"SUNDAY_{role}_TOKEN")
                for role in ("ADMIN", "AGENT")
            )
            if not env_file.is_file() and not configured_tokens:
                raise ValueError("Run 'awaker setup' first, or supply both tokens in the environment.")
        # The Node bootstrap applies CLI values after loading the chosen env file.
        overrides = {}
        if arguments.host is not None:
            overrides["AWAKER_HOST"] = arguments.host
        if arguments.port is not None:
            overrides["PORT"] = str(arguments.port)
        if arguments.public_url is not None:
            overrides["AWAKER_PUBLIC_URL"] = arguments.public_url
        node_args = [str(Path(__file__).with_name("launch.mjs")), arguments.command, str(root), str(directory), str(env_file), json.dumps(overrides)]
        return launch(node_executable(), node_args, environment)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"awaker: {error}", file=sys.stderr)
        return 1
