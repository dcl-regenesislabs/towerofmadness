// CommonJS wrapper to load ESM BabylonJS
const { createRequire } = require('module');
const path = require('path');

// This will be called instead of require('@babylonjs/core')
let BABYLON = null;

async function loadBabylon() {
  if (BABYLON) return BABYLON;
  BABYLON = await import('@babylonjs/core');
  return BABYLON;
}

module.exports = { loadBabylon };
