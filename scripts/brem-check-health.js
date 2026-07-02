const http = require('http');

const localVersion = String(process.argv[2] || '').trim();
const port = Number(process.env.BAEMIN_SESSION_LOCAL_PORT || 3939);

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

getJson(`http://127.0.0.1:${port}/health`)
  .then(data => {
    const running = String(data.version || '').trim();
    console.log(`[INFO] Server already running - version ${running}`);
    if (localVersion && running && running !== localVersion) {
      console.log(`[WARN] Folder version ${localVersion} != running ${running}`);
      console.log('[WARN] Run scripts\\restart-baemin-session-server.bat to apply updates.');
    } else {
      console.log('[INFO] Restart: scripts\\restart-baemin-session-server.bat');
    }
    process.exit(0);
  })
  .catch(() => {
    process.exit(1);
  });
