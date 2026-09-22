import { Button } from "@/components/ui/button";

async function rpc() {
  return import("@/lib/control/actions");
}

/** Full-screen chrome when the room host reports `host.locked`. */
export function PanelLockedOverlay({
  session,
  hostDeviceId,
  onUnlocked,
}: {
  session: string;
  hostDeviceId?: string;
  /** Optimistic local unlock (snap + panel lock state). */
  onUnlocked: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[68] flex flex-col items-center justify-center gap-5 bg-bg px-8 text-center">
      <p className="text-4xl font-medium">Room locked</p>
      <Button
        type="button"
        className="h-14 w-full max-w-sm text-base"
        onClick={async () => {
          if (hostDeviceId) {
            const { fireCommand } = await rpc();
            await fireCommand({ data: { deviceId: hostDeviceId, commandId: "panel.unlock", token: session } }).catch(() => undefined);
          }
          onUnlocked();
        }}
      >
        Unlock
      </Button>
    </div>
  );
}
