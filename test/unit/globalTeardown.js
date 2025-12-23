// test/unit/globalTeardown.js
// Note: Using .js because importing TS modules directly into Jest global setup/teardown can be tricky.
// We access the compiled JS output instead.

module.exports = async () => {
  console.log('\nRunning global teardown for unit tests...');

  const fs = require('fs');
  const path = require('path');

  const storageModulePath = path.resolve(__dirname, '../../app/models/storage.js');
  const loggerModulePath = path.resolve(__dirname, '../../app/logger/index.js');

  if (!fs.existsSync(storageModulePath)) {
    console.log('Compiled storage module not found. Run "npm run build" to compile TypeScript first.');
    console.log('Skipping DB connection pool cleanup.');
  } else {
    try {
      const storageModule = require(storageModulePath);
      if (storageModule && typeof storageModule.storage === 'function') {
        const db = storageModule.storage();
        if (db && typeof db.dispose === 'function') {
          console.log('Closing main DB connection pool...');
          await db.dispose();
          console.log('Main DB connection pool closed.');
        } else {
          console.log('Main DB connection pool not found or not initialized.');
        }
      } else {
        console.log('Storage module or storage function not found.');
      }
    } catch (error) {
      console.error('Error closing main DB connection pool:', error.message);
    }
  }

  if (!fs.existsSync(loggerModulePath)) {
    console.log('Compiled logger module not found.');
    console.log('Skipping logger DB connection pool cleanup.');
  } else {
    console.log('Skipping explicit logger DB connection pool close (requires logger module refactor).');
  }

  console.log('Global teardown finished.');
};
