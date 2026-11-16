import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => ({
    name: 'Spaceport — Move from Arc',
    description: 'Bring your Arc spaces, folders and pinned tabs (with their names) to Chrome, plus an Arc-style sidebar.',
    action: { default_title: 'Open Spaceport' },
    // Site access is not requested at install; title renaming (v1.1) asks via optional permissions.
    permissions: ['tabs', 'tabGroups', 'bookmarks', 'storage', ...(browser === 'firefox' ? [] : ['sidePanel'])],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'spaceport@nika-gamkrelidze.github.io',
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
