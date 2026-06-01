/** Format energy for display: kWh, switching to MWh once it's large. */
export function energyLabel(kwh: number): string {
  if (kwh >= 1000) {
    return `${(kwh / 1000).toLocaleString("en-AU", { maximumFractionDigits: 1 })} MWh`;
  }
  return `${Math.round(kwh).toLocaleString("en-AU")} kWh`;
}
