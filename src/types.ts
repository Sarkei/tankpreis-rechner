export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  avatarUrl?: string | null;
  emailVerified: boolean;
  iban?: string | null;
  fuelPricePlz?: string | null;
  createdAt?: string;
  isAdmin?: boolean;
}

export interface Vehicle {
  id: number;
  name: string;
  fuelType: "BENZIN" | "DIESEL" | "ELEKTRO" | "HYBRID";
  consumptionPer100km: number;
  tankCapacity?: number | null;
  licensePlate?: string | null;
  notes?: string | null;
  isDefault: boolean;
  currentFuelPrice?: number | null;
  fuelPriceUpdatedAt?: string | null;
  autoFuelPrice?: boolean;
  fuelPricePlz?: string | null;
  createdAt: string;
}

export interface CarpoolGroup {
  id: number;
  name: string;
  description?: string | null;
  inviteCode: string;
  costSplitMode: "WITH_DRIVER" | "WITHOUT_DRIVER";
  isArchived: boolean;
  ownerId: number;
  ownerName?: string;
  memberCount?: number;
  joinedAt?: string;
  createdAt: string;
  defaultOutboundKm?: number | null;
  defaultReturnKm?: number | null;
  defaultFuelPrice?: number | null;
  members?: GroupMember[];
}

export interface GroupMember {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl?: string | null;
  roles: string[];
  joinedAt: string;
  isActive: boolean;
  debtAmount: number;
  isOwner?: boolean;
}

export interface GroupDriver {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  isOwner: boolean;
}

export interface GroupMemberOverview {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  roles: string[];
  isOwner: boolean;
  isGroupDriver: boolean;
  tripsAsPassenger: number;
  outboundRides: number;
  returnRides: number;
  tripsAsDriver: number;
  totalCharged: number;
  openDebt: number;
  paidAmount: number;
  entries: GroupDebtEntry[];
}

export interface GroupDebtEntry {
  id: number;
  amount: number;
  entryType: string;
  description?: string | null;
  createdAt: string;
  tripDate?: string | null;
}

export interface GroupOverview {
  group: CarpoolGroup;
  summary: {
    tripCount: number;
    totalKm: number;
    totalOpenDebt: number;
    totalCharged: number;
  };
  members: GroupMemberOverview[];
}

export interface Trip {
  id: number;
  groupId?: number;
  groupName?: string;
  tripDate: string;
  outboundKm?: number | null;
  returnKm?: number | null;
  fuelPriceUsed: number;
  comment?: string | null;
  createdAt: string;
  vehicleId?: number | null;
  driver: { id: number; firstName: string; lastName: string };
  vehicle?: { name: string; fuelType: string } | null;
  consumptionPer100km?: number;
  totalFuelCost?: number;
  participations: TripParticipation[];
}

export interface TripParticipation {
  userId: number;
  firstName: string;
  lastName: string;
  direction: "OUTBOUND" | "RETURN";
  amountOwed: number;
}

export interface Debt {
  id: number;
  groupId: number;
  groupName: string;
  totalAmount: number;
  paidAmount: number;
  openAmount: number;
  lastUpdated: string;
  debtor: { id: number; firstName: string; lastName: string };
  creditor: { id: number; firstName: string; lastName: string; iban?: string | null };
  isMyDebt: boolean;
}

export interface Payment {
  id: number;
  amount: number;
  status: "OFFEN" | "GEMELDET" | "BESTAETIGT";
  note?: string | null;
  reportedAt?: string | null;
  confirmedAt?: string | null;
  createdAt: string;
  payer: { id: number; firstName: string; lastName: string };
  receiver: { id: number; firstName: string; lastName: string };
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  referenceId?: number | null;
  referenceType?: string | null;
  createdAt: string;
}

export interface FuelLog {
  id: number;
  date: string;
  liters: number;
  pricePerLiter: number;
  totalCost: number;
  odometerKm?: number | null;
  notes?: string | null;
}

export type FuelPriceStatus = "green" | "yellow" | "red" | "none";

export function getFuelPriceStatus(updatedAt?: string | null): FuelPriceStatus {
  if (!updatedAt) return "none";
  const days = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 3) return "green";
  if (days <= 7) return "yellow";
  return "red";
}
