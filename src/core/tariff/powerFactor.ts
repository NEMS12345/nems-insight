// Power-factor correction business case. Only meaningful where demand is billed on kVA
// (e.g. Energex 7400) or there's an explicit low-PF penalty — on a kW demand tariff,
// correcting PF does nothing to the billed demand.

export interface PowerFactorCase {
  applicable: boolean;
  reason?: string;
  peakKw: number;
  peakKva: number;
  currentPf: number;
  targetPf: number;
  correctedKva: number;
  kvaSaved: number;
  annualSavingAud: number;
  /** Indicative capacitor sizing, kVAr. */
  capacitorKvar: number;
}

/**
 * Cost the benefit of correcting power factor to a target at the demand-setting interval.
 * @param demandRatePerKvaMonth the $/kVA/month demand rate (0 / undefined if the tariff is
 *   kW-billed, in which case there is no PF saving).
 */
export function powerFactorCorrectionCase(params: {
  peakKw: number;
  peakKva: number;
  currentPf: number;
  targetPf: number;
  demandRatePerKvaMonth: number;
  kvaBilled: boolean;
}): PowerFactorCase {
  const { peakKw, peakKva, currentPf, targetPf, demandRatePerKvaMonth, kvaBilled } = params;

  const correctedKva = targetPf > 0 ? peakKw / targetPf : peakKva;
  const kvaSaved = Math.max(0, peakKva - correctedKva);
  const tan = (pf: number) => Math.tan(Math.acos(Math.min(1, Math.max(0.0001, pf))));
  const capacitorKvar = Math.max(0, peakKw * (tan(currentPf) - tan(targetPf)));

  if (!kvaBilled) {
    return {
      applicable: false,
      reason: "Demand is billed on kW — correcting power factor does not change the demand charge.",
      peakKw,
      peakKva,
      currentPf,
      targetPf,
      correctedKva,
      kvaSaved: 0,
      annualSavingAud: 0,
      capacitorKvar,
    };
  }

  return {
    applicable: currentPf < targetPf && kvaSaved > 0,
    peakKw,
    peakKva,
    currentPf,
    targetPf,
    correctedKva,
    kvaSaved,
    annualSavingAud: kvaSaved * demandRatePerKvaMonth * 12,
    capacitorKvar,
  };
}
