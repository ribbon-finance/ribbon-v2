module.exports = {
  skipFiles: ["vendor", "interfaces", "tests"],
  mocha: {
    grep: "@skip-on-coverage", // Find everything with this tag
    invert: true, // Run the grep's inverse set.
  },
};
