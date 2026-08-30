/** Test-only analytic references. No file under client/src may import this module. */

export const DIVIDER_VIN = 9;
export const DIVIDER_R_HIGH = 1_000;
export const DIVIDER_R_LOW = 2_000;

export function dividerVoltage(vin = DIVIDER_VIN, rHigh = DIVIDER_R_HIGH, rLow = DIVIDER_R_LOW) {
  return (vin * rLow) / (rHigh + rLow);
}

export function dividerCurrent(vin = DIVIDER_VIN, rHigh = DIVIDER_R_HIGH, rLow = DIVIDER_R_LOW) {
  return vin / (rHigh + rLow);
}

export const RC_VIN = 5;
export const RC_R = 10_000;
export const RC_C = 100e-6;

export function rcTimeConstant(resistance = RC_R, capacitance = RC_C) {
  return resistance * capacitance;
}

export function rcChargeVoltage(timeS: number, vin = RC_VIN, resistance = RC_R, capacitance = RC_C) {
  return vin * (1 - Math.exp(-timeS / rcTimeConstant(resistance, capacitance)));
}
