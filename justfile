start:
	mkdir -p tmp
	rm -rf ./app
	COMPOSE_PROJECT_NAME=gratheon docker compose -f docker-compose.dev.yml up --build
stop:
	COMPOSE_PROJECT_NAME=gratheon docker compose -f docker-compose.dev.yml down
run:
	npm run dev

test-integration:
	COMPOSE_PROJECT_NAME=gratheon-test docker compose -f docker-compose.test.yml down
	rm -rf ./app
	source $HOME/.nvm/nvm.sh && nvm use && npm i && npm run build
	COMPOSE_PROJECT_NAME=gratheon-test docker compose -f docker-compose.test.yml up -d
	sleep 10
	npm run test:integration

test-integration-ci:
	# Ensure clean environment: stop, remove containers, and remove the mysql volume
	COMPOSE_PROJECT_NAME=gratheon-test docker compose -f docker-compose.test.yml down --volumes
	rm -rf ./app
	npm i && npm run build
	# Start fresh, forcing a rebuild to include latest code changes
	COMPOSE_PROJECT_NAME=gratheon-test docker compose -f docker-compose.test.yml up -d --build
	# Wait for the image-splitter health check endpoint to be ready (increased timeout)
	# Run the wait script and capture its exit code. Dump logs on failure.
	@if ! ./scripts/wait-for-service.sh http://localhost:8800/healthz 120 2; then \
	  echo "Wait script failed. Dumping logs..."; \
	  COMPOSE_PROJECT_NAME=gratheon-test docker compose -f docker-compose.test.yml logs; \
	  exit 1; \
	fi
	# Ensure test runner also uses testing config
	@ENV_ID=testing npm run test:integration
