start:
	mkdir -p tmp
	source $(HOME)/.nvm/nvm.sh && nvm use && npm i && npm run build
	COMPOSE_PROJECT_NAME=gratheon docker compose -f docker-compose.dev.yml up --build
stop:
	COMPOSE_PROJECT_NAME=gratheon docker compose -f docker-compose.dev.yml down
run:
	npm run dev
test:
	npm run test
	
deploy-clean:
	ssh root@gratheon.com 'rm -rf /www/image-splitter/app/*;'

deploy-copy:
	rsync -av -e ssh ./migrations docker-compose.yml Dockerfile package.json package-lock.json restart.sh .version ./src root@gratheon.com:/www/image-splitter/

deploy-run:
	ssh root@gratheon.com 'chmod +x /www/image-splitter/restart.sh'
	ssh root@gratheon.com 'bash /www/image-splitter/restart.sh'

deploy:
	git rev-parse --short HEAD > .version
	# make deploy-clean
	make deploy-copy
	make deploy-run