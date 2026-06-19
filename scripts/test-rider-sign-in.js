require('dotenv').config();

const riderAuth = require('../server/rider-auth');

async function main() {
  const login = process.argv[2] || '김형진0704';
  const password = process.argv[3] || '1234';
  const result = await riderAuth.signInRider(login, password);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
