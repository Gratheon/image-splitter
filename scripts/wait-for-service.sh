#!/bin/sh

# Usage: wait-for-service.sh <url> <timeout_seconds> <interval_seconds>

URL=$1
TIMEOUT=$2
INTERVAL=$3

echo "Waiting for service at $URL..."
elapsed=0

while ! curl --fail --silent --output /dev/null "$URL"; do
  elapsed=$(expr $elapsed + $INTERVAL)
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    echo "Service $URL did not become ready within $TIMEOUT seconds."
    # Attempt to dump logs from the expected docker compose setup
    echo "Attempting to dump logs (best effort based on common project name 'gratheon-test'):"
    if command -v docker &> /dev/null && docker compose version &> /dev/null; then
         # Try Docker Compose v2 first
         docker compose -p gratheon-test -f docker-compose.test.yml logs || echo "Failed to get logs using 'docker compose'."
    elif command -v docker-compose &> /dev/null; then
        # Fallback to Docker Compose v1
        COMPOSE_PROJECT_NAME=gratheon-test docker-compose -f docker-compose.test.yml logs || echo "Failed to get logs using 'docker-compose'."
    else
        echo "Neither 'docker compose' nor 'docker-compose' command found."
    fi
    exit 1
  fi
  sleep "$INTERVAL"
done

echo "Service $URL is ready."
exit 0
