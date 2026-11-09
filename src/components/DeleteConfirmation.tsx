import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import {
  DeleteConfirmationContext,
  type DeleteContext,
  type DeleteRequest,
} from "./useDeleteConfirmation.ts";
import "./DeleteConfirmation.css";

export function DeleteConfirmationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [pending, setPending] = useState<DeleteRequest | null>(null);
  const current = useRef<DeleteRequest | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const finish = useCallback((confirmed: boolean) => {
    const request = current.current;
    if (!request) return;
    current.current = null;
    dialog.current?.close();
    setPending(null);
    if (confirmed) request.onConfirm();
    else {
      const target = request.focusOnCancel?.isConnected
        ? request.focusOnCancel
        : request.trigger;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }
  }, []);
  const [context] = useState<DeleteContext>(() => ({
    request: (request) => {
      if (current.current) return;
      current.current = request;
      setPending(request);
    },
    cancel: (owner) => {
      if (current.current?.owner === owner) finish(false);
    },
  }));

  useLayoutEffect(() => {
    if (!pending) return;
    dialog.current?.showModal();
    cancelButton.current?.focus({ preventScroll: true });
  }, [pending]);
  useLayoutEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (!current.current || !dialog.current?.open || event.key !== "Escape")
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(false);
    };
    // Keep modal presses out of the underlying popovers' outside-click handlers.
    const pointer = (event: PointerEvent) => {
      if (current.current && dialog.current?.open)
        event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("pointerdown", pointer, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("pointerdown", pointer, true);
    };
  }, [finish]);

  return (
    <DeleteConfirmationContext.Provider value={context}>
      {children}
      {pending && (
        <dialog
          ref={dialog}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-confirmation-title"
          aria-describedby="delete-confirmation-description"
          className="delete-confirmation"
          data-testid="delete-confirmation"
          onCancel={(event) => {
            event.preventDefault();
            finish(false);
          }}
          onClose={() => finish(false)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key !== "Tab") return;
            const buttons =
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              );
            const first = buttons[0],
              last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom
            )
              finish(false);
          }}
        >
          <header>
            <h2 id="delete-confirmation-title">{pending.title}</h2>
            <button
              type="button"
              data-ui="icon-action"
              aria-label="关闭删除确认"
              title="取消"
              onClick={() => finish(false)}
            >
              <X size={16} />
            </button>
          </header>
          <p id="delete-confirmation-description">{pending.description}</p>
          <footer>
            <button
              ref={cancelButton}
              type="button"
              autoFocus
              onClick={() => finish(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="delete-confirmation-submit"
              onClick={() => finish(true)}
            >
              确认删除
            </button>
          </footer>
        </dialog>
      )}
    </DeleteConfirmationContext.Provider>
  );
}
