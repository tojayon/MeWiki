import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export default function DeviceInspectorModal({
  open,
  title,
  headerCenter,
  hideHeader = false,
  className = "",
  onClose,
  children,
  testId,
}: {
  open: boolean;
  title: string;
  headerCenter?: ReactNode;
  hideHeader?: boolean;
  className?: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const titleId = `device-modal-title-${testId ?? title}`;

  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={`device-record-modal ${className}`.trim()}
      aria-labelledby={hideHeader ? undefined : titleId}
      aria-label={hideHeader ? title : undefined}
      data-testid={testId}
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
      onClose={() => closeRef.current()}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      {!hideHeader && (
        <header className="device-record-modal-header">
          <strong id={titleId}>{title}</strong>
          {headerCenter && (
            <span className="device-modal-header-center">{headerCenter}</span>
          )}
          <button data-ui="icon-action"
            className="icon-button"
            aria-label={`关闭${title}`}
            title={`关闭${title}`}
            onClick={() => closeRef.current()}
          >
            <X size={15} />
          </button>
        </header>
      )}
      <div className="device-record-modal-content">{children}</div>
    </dialog>
  );
}
