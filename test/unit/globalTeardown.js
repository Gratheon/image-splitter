// test/unit/globalTeardown.js
// Note: Using .js because importing TS modules directly into Jest global setup/teardown can be tricky.
// We access the compiled JS output instead.

module.exports = async () => {
  console.log('\nRunning global teardown for unit tests...');
  try {
    // Attempt to import the compiled storage module
    // Adjust path based on your actual compiled output structure (e.g., 'dist', 'build', 'app')
    const storageModule = require('../../app/models/storage');
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
    console.error('Error closing main DB connection pool:', error);
  }

  try {
    // Attempt to import the compiled logger module to close its connection
    // Adjust path based on your actual compiled output structure
     const loggerModule = require('../../app/logger/index');
     // The logger connection pool ('conn') is not exported directly.
     // If closing it is critical, the logger module would need refactoring
     // to export 'conn' or provide a dispose function.
     // For now, we'll skip closing the logger connection explicitly in teardown.
     console.log('Skipping explicit logger DB connection pool close (requires logger module refactor).');

  } catch (error) {
    console.error('Error accessing logger module during teardown:', error);
  }
  console.log('Global teardown finished.');
};
