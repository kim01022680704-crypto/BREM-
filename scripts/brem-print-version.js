const fs = require('fs');
const path = require('path');

const scriptPath = path.join(__dirname, 'baemin-session-local-server.js');
const text = fs.readFileSync(scriptPath, 'utf8');
const match = text.match(/SERVER_VERSION\s*=\s*'([^']+)'/);
process.stdout.write(match ? match[1] : '');
