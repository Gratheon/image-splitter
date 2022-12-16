# gratheon / image-splitter
Main image processng microservice.
Uses darknet and custom trained yoloV3 model for inference

### URLs
localhost:8800

### Development
```
git clone git@github.com:Gratheon/models-yolo-v3.git

nvm use
npm install
npm install --arch=x64 --platform=linuxmusl --libc=musl sharp

```

### Detection
git clone git@github.com:AlexeyAB/darknet.git

#### Linux
```sh
#for arch linux if some libs are missing
#sudo pacman -S glibc linux-api-headers gcc-libx libevdev
cd darknet && make
```

#### Mac
./darknet.mac detector test cfg/coco.data  ../models-yolo-v3/model.cfg ../models-yolo-v3/model.weights -i 0 -thresh 0.01 -ext_output ../out/IMG_2822_1_2.JPG

-out result.json