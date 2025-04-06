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
    # Attempt to dump logs from the expected docker-compose setup
    if command -v docker-compose &> /dev/null; then
        echo "Dumping logs (best effort based on common project name):"
        COMPOSE_PROJECT_NAME=gratheon-test docker-compose -f ../docker-compose.test.yml logs || echo "Failed to get logs."
    elif command -v docker &> /dev/null && docker ps -q --filter "name=gratheon-test" &> /dev/null; then
         echo "Dumping logs (best effort based on common project name):"
         docker compose -p gratheon-test -f ../docker-compose.test.yml logs || echo "Failed to get logs."
    fi
    exit 1
  fi
  sleep "$INTERVAL"
done

echo "Service $URL is ready."
exit 0
