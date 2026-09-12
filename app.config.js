// Extends app.json. EXPO_WEB_BASE_URL sets the path prefix for a static web host that serves the
// app under a sub-path (GitHub Pages serves it at /<repo>/). Empty for native and local web.
module.exports = ({ config }) => {
  const baseUrl = (process.env.EXPO_WEB_BASE_URL ?? '').replace(/\/+$/, '');
  return {
    ...config,
    experiments: { ...(config.experiments ?? {}), baseUrl },
  };
};
