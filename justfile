# Switch development commands.
# Install just: brew install just
# Usage: just <recipe>   (run `just` with no args to list all recipes)

set dotenv-load := true

# SandboxAQ-internal recipes (AWS/EKS/ECR deploy, Helm install, dev VMs).
# Optional so the public repo — which has no internal/ — still works.
import? 'internal/justfile'

# ── List available recipes ─────────────────────────────────────────────────────
default:
    @just --list

# ── Dev infrastructure ─────────────────────────────────────────────────────────
# Tuwunel self-initializes its signing key + database in its data volume on
# first boot, so no pre-start key generation is needed.
up:
    docker compose -f deploy/local/docker-compose.yml --project-directory . up -d --build

down:
    docker compose -f deploy/local/docker-compose.yml --project-directory . down

reset:
    docker compose -f deploy/local/docker-compose.yml --project-directory . down -v

# ── Run switch-core locally ────────────────────────────────────────────────────
# The Python project lives in core/; `--project core` selects that environment
# while keeping the repo root as the working directory (so paths like connectors/
# stay natural). Tool configs are passed explicitly since the repo root no longer
# holds pyproject.toml / alembic.ini.
run:
    uv run --project core python -m switch_core.main

# ── Format code with ruff ──────────────────────────────────────────────────────
# Run from the repo root so ruff's hierarchical config discovery applies the
# right config per file (core/, the connector sub-projects, and the
# root ruff.toml fallback).
format:
    uv run --project core ruff format .
    uv run --project core ruff check --fix .

# ── Check code with ruff (no changes) ─────────────────────────────────────────
check:
    uv run --project core ruff format --check .
    uv run --project core ruff check .

# ── Run mypy type checks ──────────────────────────────────────────────────────
typecheck:
    uv run --project core mypy --config-file core/pyproject.toml core/switch_core/ connectors/

# ── Run alembic migrations ─────────────────────────────────────────────────────
migrate:
    uv run --project core alembic -c core/alembic.ini upgrade head


# ── Generate a new alembic migration ──────────────────────────────────────────
migration msg:
    uv run --project core alembic -c core/alembic.ini revision --autogenerate -m "{{ msg }}"

# ── Run tests ──────────────────────────────────────────────────────────────────
test *args:
    uv run --project core pytest -c core/pyproject.toml core/tests/ {{ args }}

# ── Run integration tests (real Postgres + Tuwunel via testcontainers) ──────────
# DOCKER_HOST is auto-resolved from the active docker context in conftest, so this
# works under Docker Desktop / OrbStack / colima without extra setup.
test-integration *args:
    uv run --project core pytest -c core/pyproject.toml core/tests/integration -m integration {{ args }}

# ── Provision a multi-room engagement from a YAML preset ──────────────────────
# Logs into the gateway with the admin credentials from .env, then POSTs the
# engagement spec (a room group + rooms + links) to the engagements endpoint.
# Override the target with SWITCH_GATEWAY_URL (default
# http://localhost:${API_HOST_PORT}/gateway). See deploy/engagements/README.md.
provision-engagement file:
    #!/usr/bin/env bash
    set -euo pipefail
    base="${SWITCH_GATEWAY_URL:-http://localhost:${API_HOST_PORT:-8000}/gateway}"
    jar="$(mktemp)"
    trap 'rm -f "$jar"' EXIT
    echo "→ Logging in to $base as ${GATEWAY_ADMIN_EMAIL}"
    curl -fsS -c "$jar" -X POST "$base/auth/login" \
        -H 'Content-Type: application/json' \
        -d "{\"email\":\"${GATEWAY_ADMIN_EMAIL}\",\"password\":\"${GATEWAY_ADMIN_PASSWORD}\"}" \
        >/dev/null
    echo "→ Provisioning engagement from {{ file }}"
    curl -fsS -b "$jar" -X POST "$base/engagements/from-yaml" \
        -H 'Content-Type: application/x-yaml' \
        --data-binary "@{{ file }}"
    echo

# ── Gateway UI ─────────────────────────────────────────────────────────────────
gateway-install:
    cd gateway && npm install

gateway-dev:
    cd gateway && npm run dev

gateway-build:
    cd gateway && npm run build

# ── Standalone deployment (all-in-one Docker, no host toolchain) ──────────────
# Repo users build from source: the build override re-adds the `build:` blocks
# so images come from the working tree, not GHCR. All profiles are enabled to
# bring up the full all-in-one stack (Mattermost bridge + gateway).
standalone-up:
    docker compose -f deploy/local/standalone-docker-compose.yml -f deploy/local/standalone-docker-compose.build.yml --profile collab --profile gateway --project-directory . up -d --build

standalone-down:
    docker compose -f deploy/local/standalone-docker-compose.yml --profile collab --profile gateway --project-directory . down

standalone-reset:
    #!/usr/bin/env bash
    set -euo pipefail
    read -r -p "⚠️  This deletes ALL standalone data volumes (rooms, messages, agents, users). Continue? [y/N] " ans
    [[ "$ans" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
    docker compose -f deploy/local/standalone-docker-compose.yml --profile collab --profile gateway --project-directory . down -v
