# Fix Varroa Image Memory Limit Issue

## Problem
When uploading varroa bottom images in production, the service crashes with:
```
Error: maxMemoryUsageInMB limit exceeded by at least 23MB
    at Function.requestMemoryAllocation (/app/node_modules/jpeg-js/lib/decoder.js:1071:13)
```

This happens when Jimp (which uses jpeg-js) tries to decode large JPEG images with default 512MB memory limit.

## Root Cause
- Codebase was using both Jimp and Sharp for image processing
- Jimp has jpeg-js dependency with 512MB default memory limit
- Sharp is more modern, faster, and memory-efficient
- No good reason to use both libraries

## Plan
- [x] Investigate current code flow
- [x] Identify all Jimp usage
- [x] Replace Jimp with Sharp for all operations:
  - [x] cutImage - use sharp().extract() instead of Jimp.crop()
  - [x] resizeImages - use sharp().resize() instead of Jimp.resize()
  - [x] getImageDimensions - remove Jimp fallback, Sharp is reliable
- [x] Remove Jimp dependency from package.json
- [x] Build and verify compilation
- [ ] Test in dev environment
- [ ] Deploy to production
- [ ] Verify fix with large varroa image

## Solution
Replaced Jimp with Sharp throughout the codebase:
1. `cutImage()` - now uses `sharp().extract()` for cropping
2. `resizeImages()` - now uses `sharp().resize()` with proper quality settings
3. `getImageDimensions()` - removed Jimp fallback, Sharp handles all cases
4. Removed jpeg-config.js workaround file
5. Removed jimp from package.json dependencies

Sharp advantages:
- Native libvips bindings (faster)
- Better memory management
- No arbitrary memory limits like jpeg-js
- Better maintained and more widely used
- Already used in the codebase for preprocessing

## Changed Files
- `/Users/artjom/git/image-splitter/src/models/image.ts` - replaced all Jimp usage with Sharp
- `/Users/artjom/git/image-splitter/package.json` - removed jimp dependency
- `/Users/artjom/git/image-splitter/src/config/jpeg-config.js` - deleted (no longer needed)

