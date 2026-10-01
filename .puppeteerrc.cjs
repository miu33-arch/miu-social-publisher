const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Store cache inside project folder so Render persists it across build and run
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};