"""Point docker-py at the active docker context when DOCKER_HOST is unset.

testcontainers' docker-py defaults to `/var/run/docker.sock`, which does not
exist under OrbStack, colima, or some Docker Desktop setups. Without this every
testcontainers fixture fails at setup with a bare `FileNotFoundError`, which
reads as "the test suite is broken" rather than "the socket is somewhere else"
— and it is a lot of failures at once, because it hits every store test.

Resolving the endpoint from `docker context inspect` makes the suite run
regardless of provider, with no per-machine environment setup.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess


def ensure_docker_host() -> None:
    if os.environ.get("DOCKER_HOST") or os.path.exists("/var/run/docker.sock"):
        return
    docker = shutil.which("docker")
    if docker is None:
        return
    try:
        out = subprocess.run(
            [docker, "context", "inspect"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        host = json.loads(out.stdout)[0]["Endpoints"]["docker"]["Host"]
    except (subprocess.SubprocessError, ValueError, KeyError, IndexError):
        return
    if host:
        os.environ["DOCKER_HOST"] = host
