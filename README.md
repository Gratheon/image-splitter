# gratheon / image-splitter
Processes uploaded beehive frame to detect various objects.
This is more of an orchestrator.
It splits frame into multiple sections for better detection results (thus the name).
In production its upload traffic is not going via graphql-router as federated graphql is not capable of forwarding binary uploads (yet?). Results are stored in mysql and forwarded to redis.

### URLs
- Dev: http://localhost:8800
- Prod: https://image.gratheon.com/graphql


## Architecture

```mermaid
flowchart LR
    web-app("<a href='https://github.com/Gratheon/web-app'>web-app</a>\n:8080") --> graphql-router("<a href='https://github.com/Gratheon/graphql-router'>graphql-router</a>") --> image-splitter("<a href='https://github.com/Gratheon/image-splitter'>image-splitter</a>\n:8800") --"poll images for processing every 500ms-10s\nstore inference results"--> mysql
    graphql-router --upload--> image-splitter --"store original upload, download for inference"--> aws-s3
	image-splitter --"detect bees"--> models-bee-detector("<a href='https://github.com/Gratheon/models-bee-detector'>models-bee-detector</a>\n:8700")
	image-splitter --"detect frame cells"--> models-frame-resources("<a href='https://github.com/Gratheon/models-frame-resources'>models-frame-resources</a>\n:8540")
	image-splitter --"detect queen cups"--> clarifai("<a href='https://clarifai.com'>clarifai</a>")

	image-splitter --"event {uid}.frame_side.{frame_side_id}.bees_partially_detected"--> redis
    image-splitter --"event {uid}.frame_side.{frame_side_id}.frame_resources_detected"--> redis
    image-splitter --"event {uid}.frame_side.{frame_side_id}.queen_cups_detected"--> redis
```

### Development
```
make start
```
