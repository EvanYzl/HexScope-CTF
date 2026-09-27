'use strict';
// Assets are composed by the application's build, never by patching an old HTML.
const workerFiles = [
  'src/core.js', 'vendor/fflate.js', 'src/ctf.js',
  'crypto/vendor/crypto-js.js', 'crypto/vendor/noble-bundle.js',
  ...['classical','number-theory','advanced','legacy-formats','modern',
    'analysis-tools','heuristic','worker'].map(name => 'crypto/src/' + name + '.js')
];
function cryptoAssets(read) {
  return {
    CRYPTO_CSS:read('crypto/src/style.css'),
    CRYPTO_WORKER:workerFiles.map(file=>read(file)).join('\n;\n'),
    CRYPTO_EXAMPLES:read('crypto/src/examples.js'),
    CRYPTO_CATALOG:read('crypto/src/catalog.js'),
    CRYPTO_UI:read('crypto/src/ui.js')
  };
}
module.exports = {cryptoAssets, workerFiles};
