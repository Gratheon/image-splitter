start:
	COMPOSE_PROJECT_NAME=gratheon docker compose -f docker-compose.dev.yml up -d --build
run:
	npm run dev

deploy-clean:
	ssh root@gratheon.com 'rm -rf /www/image-splitter/app/*;'

deploy-copy:
	rsync -av -e ssh restart.sh .version ./models-yolo-v3 ./app ./darknet ./config package.json package-lock.json root@gratheon.com:/www/image-splitter/

rsync -av -e ssh Dockerfile package.json package-lock.json root@gratheon.com:/www/image-splitter/
deploy-run:
	ssh root@gratheon.com 'chmod +x /www/image-splitter/restart.sh'
	ssh root@gratheon.com 'bash /www/image-splitter/restart.sh'

deploy:
	git rev-parse --short HEAD > app/.version
	# make deploy-clean
	make deploy-copy
	make deploy-run

.PHONY: deploy
