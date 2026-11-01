// Startup file for hosts whose loader requires a CommonJS entry point, such as cPanel's
// "Setup Node.js App" (Phusion Passenger) on Namecheap. The app itself is an ES module;
// this file only loads it. Locally, `node src/server.js` (or start.cmd) works as before.
import('./src/server.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
