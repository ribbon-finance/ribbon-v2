const Web3 = require("web3");
const { ether } = require("@openzeppelin/test-helpers");
module.exports = { sleep, wdiv, wmul };

async function sleep(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

function wdiv(x, y) {
  return x
    .mul(ether("1"))
    .add(y.div(ether("2")))
    .div(y);
}

function wmul(x, y) {
  return x
    .mul(y)
    .add(ether("1").div(ether("2")))
    .div(ether("1"));
}
