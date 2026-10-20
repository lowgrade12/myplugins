// esbuild injects this module wherever JSX or a bare `React` appears, so the
// bundle uses the React instance Stash exposes to plugins.
export const React = window.PluginApi.React
