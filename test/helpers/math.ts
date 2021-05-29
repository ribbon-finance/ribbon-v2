import { BigNumber } from "ethers";
import { parseEther } from "@ethersproject/units";

export const wdiv = (x: BigNumber, y: BigNumber) => {
  return x
    .mul(parseEther("1"))
    .add(y.div(BigNumber.from("2")))
    .div(y);
};

export const wmul = (x: BigNumber, y: BigNumber) => {
  return x
    .mul(y)
    .add(parseEther("1").div(BigNumber.from("2")))
    .div(parseEther("1"));
};
