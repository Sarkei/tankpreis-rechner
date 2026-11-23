const DEFAULT_CONSUMPTION = 8;

export function computeDirectionFuelCost(
  km: number | null | undefined,
  consumptionPer100km: number,
  fuelPrice: number
): number {
  if (!km || km <= 0) return 0;
  return Math.round(((km * consumptionPer100km) / 100) * fuelPrice * 100) / 100;
}

export function computeTripFuelCost(trip: {
  outboundKm?: number | null;
  returnKm?: number | null;
  fuelPriceUsed: number;
  consumptionPer100km?: number | null;
}): number {
  const consumption = trip.consumptionPer100km ?? DEFAULT_CONSUMPTION;
  const outbound = computeDirectionFuelCost(trip.outboundKm, consumption, trip.fuelPriceUsed);
  const ret = computeDirectionFuelCost(trip.returnKm, consumption, trip.fuelPriceUsed);
  return Math.round((outbound + ret) * 100) / 100;
}

export function sumPassengerCosts(
  participations: { amountOwed: number }[]
): number {
  return Math.round(
    participations.reduce((sum, p) => sum + p.amountOwed, 0) * 100
  ) / 100;
}
