// Storybook — where frames become states (REACT-PLAN R-11, §8). One story per frame, named after it.
export default {
  framework: { name: "@storybook/react-vite", options: {} },
  stories: ["../src/**/*.stories.@(js|jsx)"],
  addons: ["@storybook/addon-vitest", "msw-storybook-addon"],
  core: { disableTelemetry: true },
  staticDirs: ["../public"],
};
