"""Install the single built wheel using the current Python interpreter."""

from pathlib import Path
import subprocess
import sys

wheels = list(Path("release/python").glob("*.whl"))
if len(wheels) != 1:
    raise SystemExit("Expected exactly one wheel in release/python. Remove old build artifacts first.")
subprocess.run([sys.executable, "-m", "pip", "install", "--only-binary=nodejs-wheel-binaries", str(wheels[0])], check=True)
