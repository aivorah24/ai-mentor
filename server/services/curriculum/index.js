/**
 * Bootstraps the curriculum provider registry. Require this module once
 * (routes/curriculumV2.js does so at load time) before calling getProvider().
 */
const { registerProvider, getProvider, listRegisteredProviderIds } = require('./registry');

registerProvider(require('./providers/cbseProvider'));
registerProvider(require('./providers/icseProvider'));
registerProvider(require('./providers/cambridgeProvider'));
registerProvider(require('./providers/notAvailableStubProvider'));

module.exports = { getProvider, listRegisteredProviderIds };
