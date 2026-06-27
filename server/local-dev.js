const {
  isLocalDevBackend,
  isWriteBlocked,
  WRITE_BLOCK_MESSAGE,
  createWriteBlockedResponse
} = require('./write-guard');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isLocalMutatingRequestBlocked(req) {
  if (!isWriteBlocked()) return false;
  return MUTATING_METHODS.has(String(req.method || '').toUpperCase());
}

module.exports = {
  isLocalDevBackend,
  isWriteBlocked,
  WRITE_BLOCK_MESSAGE,
  isLocalMutatingRequestBlocked,
  createWriteBlockedResponse
};
