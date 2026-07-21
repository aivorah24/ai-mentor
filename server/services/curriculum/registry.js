const { normalizeCurriculum } = require('../../utils/curriculum');

/** @type {Map<string, import('./types').CurriculumProvider>} */
const providers = new Map();

function registerProvider(provider) {
  providers.set(provider.meta.id, provider);
}

/**
 * Resolve a CurriculumProvider from a raw curriculum string (e.g. from a
 * route's ?curriculum= query param). Never throws — an unregistered
 * curriculum falls back to the NOT_AVAILABLE_STUB provider, which honestly
 * reports every resource as COMING_SOON rather than erroring.
 * @param {string} curriculumInput
 * @returns {import('./types').CurriculumProvider}
 */
function getProvider(curriculumInput) {
  const id = normalizeCurriculum(curriculumInput);
  return providers.get(id) || providers.get('NOT_AVAILABLE_STUB');
}

function listRegisteredProviderIds() {
  return Array.from(providers.keys());
}

module.exports = { registerProvider, getProvider, listRegisteredProviderIds };
