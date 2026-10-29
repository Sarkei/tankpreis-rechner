import { Button, Modal } from "./ui.tsx";

export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  state,
  busy,
  onClose,
}: {
  state: ConfirmState | null;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={state !== null}
      onClose={onClose}
      title={state?.title ?? ""}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            variant={state?.danger ? "danger" : "success"}
            onClick={state?.onConfirm}
            disabled={busy}
          >
            {busy ? "…" : state?.confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-zinc-300">{state?.message}</p>
    </Modal>
  );
}
