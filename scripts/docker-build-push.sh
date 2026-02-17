#!/usr/bin/env bash
# Build and push image to Docker Hub (lforlinux/firefly).
# Push uses multi-platform (amd64 + arm64) so it runs on Synology NAS and Apple Silicon.
# Usage: ./scripts/docker-build-push.sh [push]
#   Without "push": build for current platform only, tag locally.
#   With "push": build for linux/amd64 + linux/arm64 and push (requires: docker login).
set -e
cd "$(dirname "$0")/.."
REPO="lforlinux/firefly"
VERSION=$(node -p "require('./package.json').version")
echo "Version: ${VERSION}"

if [ "${1:-}" = "push" ]; then
  echo "Building multi-platform (linux/amd64, linux/arm64) and pushing..."
  docker buildx build \
    --platform linux/amd64,linux/arm64 \
    -t "${REPO}:v${VERSION}" \
    -t "${REPO}:latest" \
    --push \
    .
  echo "Pushed ${REPO}:v${VERSION} and ${REPO}:latest"
else
  echo "Building for current platform only (local)..."
  docker build -t "${REPO}:v${VERSION}" -t "${REPO}:latest" .
  echo "Tagged: ${REPO}:v${VERSION} and ${REPO}:latest"
fi
