module.exports = {
  skipFiles: ["vendor", "interfaces", "tests"],
  mocha: {
    grep: "@skip-on-coverage|E2E-", // Find everything with this tag
    invert: true, // Run the grep's inverse set.
  },
};
