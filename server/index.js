/**
 * Tower of Madness - Authoritative Server
 * 
 * This is the server entry point for Railway/hosted deployment.
 * It starts the Decentraland hammurabi authoritative server.
 * 
 * Deploy to Railway:
 * 1. Set Root Directory to /server
 * 2. Start Command: npm start
 * 3. Get your URL and update scene.json with serverUrl
 */

const { spawn } = require('child_process');

console.log('═══════════════════════════════════════════════════════');
console.log('🎮 TOWER OF MADNESS - Authoritative Server');
console.log('═══════════════════════════════════════════════════════');
console.log('Starting Decentraland Hammurabi Server...');
console.log('');

// Get port from environment (Railway sets this) or use default
const PORT = process.env.PORT || 8000;
console.log(`📡 Server will listen on port: ${PORT}`);
console.log('');

// Start the hammurabi server
const server = spawn('npx', ['@dcl/hammurabi-server@next'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    PORT: PORT.toString()
  }
});

server.on('error', (error) => {
  console.error('❌ Failed to start server:', error.message);
  process.exit(1);
});

server.on('close', (code) => {
  console.log(`Server process exited with code ${code}`);
  process.exit(code || 0);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('');
  console.log('📴 Received SIGTERM, shutting down gracefully...');
  server.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('');
  console.log('📴 Received SIGINT, shutting down gracefully...');
  server.kill('SIGINT');
});

// Keep alive heartbeat
setInterval(() => {
  // Heartbeat to keep Railway from killing the process
}, 30000);

console.log('✅ Server process started');
console.log('═══════════════════════════════════════════════════════');
