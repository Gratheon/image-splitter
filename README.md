# gratheon / image-splitter
Main image processng microservice.
Uses darknet and custom trained yoloV3 model for inference

### URLs
localhost:8800

## Architecture

```mermaid
flowchart LR
    web-app("<a href='https://github.com/Gratheon/web-app'>web-app</a>\n:8080") --> graphql-router("<a href='https://github.com/Gratheon/graphql-router'>graphql-router</a>") --> image-splitter("<a href='https://github.com/Gratheon/image-splitter'>image-splitter</a>\n:8800") --"poll images for processing every 500ms-10s\nstore inference results"--> mysql
    graphql-router --upload--> image-splitter --"store original upload"--> aws-s3
	image-splitter --"inference"--> models-yolov5("<a href='https://github.com/Gratheon/models-yolov5'>models-yolov5</a>\n:8700")
```

### Development
```
make start
```
