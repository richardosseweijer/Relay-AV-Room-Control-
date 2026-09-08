export type GatewaySlot = {
  id: string;
  label: string;
  mapPort?: number;
  baudDefault?: number;
};

export type GatewayProfile = {
  id: string;
  label: string;
  controlPort: number;
  slots: GatewaySlot[];
};

export const GATEWAY_PROFILES: Record<string, GatewayProfile> = {
  "extron-ipl-t-sfi244": {
    id: "extron-ipl-t-sfi244",
    label: "Extron IPL T SFI244",
    controlPort: 23,
    slots: [
      { id: "com1", label: "COM1", mapPort: 2001, baudDefault: 9600 },
      { id: "com2", label: "COM2", mapPort: 2002, baudDefault: 9600 },
      { id: "ir1", label: "IR 1" },
      { id: "ir2", label: "IR 2" },
      { id: "ir3", label: "IR 3" },
      { id: "ir4", label: "IR 4" },
      { id: "io1", label: "I/O 1" },
      { id: "io2", label: "I/O 2" },
      { id: "io3", label: "I/O 3" },
      { id: "io4", label: "I/O 4" },
    ],
  },
};

export function gatewayProfile(vendor?: string) {
  return vendor ? GATEWAY_PROFILES[vendor] : undefined;
}

export function gatewaySlot(vendor?: string, slot?: string) {
  return gatewayProfile(vendor)?.slots.find((item) => item.id === slot);
}

export function isGatewayKind(kind?: string) {
  return kind === "gateway";
}
