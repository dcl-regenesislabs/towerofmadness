/**
 * Tower of Madness - Authoritative Server
 * 
 * This is the server entry point for Railway/hosted deployment.
 * It starts the Decentraland hammurabi authoritative server.
 * 
 * Deploy to Railway:
 * 1. Set Root Directory to / (project root, NOT /server)
 * 2. Start Command: node server/index.js
 * 3. Get your URL and update scene.json with serverUrl
 * 
 * The Hammurabi server needs access to bin/index.js (compiled scene)
 * which is in the project root.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('═══════════════════════════════════════════════════════');
console.log('🎮 TOWER OF MADNESS - Authoritative Server');
console.log('═══════════════════════════════════════════════════════');
console.log(`Node.js version: ${process.version}`);
console.log('');

// Get port from environment (Railway sets this) or use default
const PORT = process.env.PORT || 8000;
console.log(`📡 Server will listen on port: ${PORT}`);

// Get the project root directory (parent of server/)
const projectRoot = path.resolve(__dirname, '..');
console.log(`📁 Project root: ${projectRoot}`);

// Check if bin/index.js exists
const sceneCodePath = path.join(projectRoot, 'bin', 'index.js');
if (fs.existsSync(sceneCodePath)) {
  console.log(`✅ Scene code found: ${sceneCodePath}`);
} else {
  console.error(`❌ Scene code NOT found: ${sceneCodePath}`);
  console.log('Available files in project root:');
  try {
    const files = fs.readdirSync(projectRoot);
    files.forEach(f => console.log(`  - ${f}`));
    if (fs.existsSync(path.join(projectRoot, 'bin'))) {
      console.log('Files in bin/:');
      fs.readdirSync(path.join(projectRoot, 'bin')).forEach(f => console.log(`    - ${f}`));
    }
  } catch (e) {
    console.error('Could not list files:', e.message);
  }
}

console.log('');
console.log('Starting Decentraland Hammurabi Server...');
console.log('');

// Try to find hammurabi-server in node_modules first
const localHammurabi = path.join(projectRoot, 'node_modules', '@dcl', 'hammurabi-server', 'dist', 'cli.js');
const serverHammurabi = path.join(__dirname, 'node_modules', '@dcl', 'hammurabi-server', 'dist', 'cli.js');

let serverCommand, serverArgs;

if (fs.existsSync(localHammurabi)) {
  console.log('Using locally installed hammurabi-server from project root');
  serverCommand = 'node';
  serverArgs = [localHammurabi];
} else if (fs.existsSync(serverHammurabi)) {
  console.log('Using locally installed hammurabi-server from server/');
  serverCommand = 'node';
  serverArgs = [serverHammurabi];
} else {
  console.log('Using npx to run hammurabi-server');
  serverCommand = 'npx';
  // Try a specific version that might work better
  serverArgs = ['@dcl/hammurabi-server@1.0.0-20530813943.commit-a9ffd94'];
}

// Start the hammurabi server from the project root
const server = spawn(serverCommand, serverArgs, {
  stdio: 'inherit',
  shell: true,
  cwd: projectRoot,  // Run from project root so it can find bin/index.js
  env: {
    ...process.env,
    PORT: PORT.toString(),
    // Try to enable ESM compatibility
    NODE_OPTIONS: '--experimental-vm-modules'
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

console.log('✅ Server process starting...');
console.log('═══════════════════════════════════════════════════════');
