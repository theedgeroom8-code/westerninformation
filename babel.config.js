// NOTE: keep this file minimal — no reanimated/worklets plugins (Expo Go).
// unstable_transformImportMeta fixes "Cannot use 'import.meta' outside a
// module" on web, caused by @supabase/supabase-js shipping import.meta.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
  };
};
