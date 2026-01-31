# Migration Guide: Using @gratheon/log-lib in image-splitter

## Prerequisites

After publishing `@gratheon/log-lib` to npm, follow these steps to integrate it into image-splitter.

## Step 1: Install the library

```bash
cd /Users/artjom/git/image-splitter
npm install @gratheon/log-lib
```

## Step 2: Replace the logger implementation

The new logger file has been created at: `src/logger/index-new.ts`

### Option A: Quick replacement (recommended)
```bash
# Backup the old logger
mv src/logger/index.ts src/logger/index-old.ts

# Use the new logger
mv src/logger/index-new.ts src/logger/index.ts

# Rebuild
npm run build
```

### Option B: Manual update
Replace the content of `src/logger/index.ts` with:

```typescript
import { createLogger, LoggerConfig } from '@gratheon/log-lib';
import config from "../config/index";

const loggerConfig: LoggerConfig = {
  mysql: {
    host: config.mysql.host,
    port: Number(config.mysql.port),
    user: config.mysql.user,
    password: config.mysql.password,
    database: 'logs'
  }
};

const { logger, fastifyLogger } = createLogger(loggerConfig);

export { logger, fastifyLogger };
```

## Step 3: Update package.json

Remove these dependencies (now provided by @gratheon/log-lib):
- No changes needed! The library already includes its dependencies.

Optional: Remove if you're not using them elsewhere:
```bash
# Only if not used elsewhere in the project
npm uninstall fast-safe-stringify
```

## Step 4: Test the changes

```bash
# Rebuild
npm run build

# Run tests
npm run test:unit
npm run test:integration

# Try running the app
npm run dev
```

## Step 5: Verify logging works

Check that:
1. Console output shows colored logs
2. Logs are being saved to the MySQL `logs` database
3. All existing logger calls still work:
   - `logger.info()`
   - `logger.error()`
   - `logger.warn()`
   - `logger.debug()`
   - `logger.errorEnriched()`

## Rollback (if needed)

If something goes wrong:
```bash
mv src/logger/index-old.ts src/logger/index.ts
npm run build
```

## Benefits of the migration

✅ Centralized logging library shared across multiple projects  
✅ Better maintainability - one place to update logging logic  
✅ Type-safe with full TypeScript support  
✅ Same API - no changes to existing logger calls needed  
✅ Can update logging features across all services by updating one package  

## Next Steps

Once verified working in image-splitter, you can:
1. Use the same library in other services (swarm-api, telemetry-api, etc.)
2. Delete the old logger implementation: `rm src/logger/index-old.ts`
3. Update other Gratheon services to use `@gratheon/log-lib`
