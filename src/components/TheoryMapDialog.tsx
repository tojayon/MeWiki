import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export default function TheoryMapDialog({
  title,
  children,
  onClose,
  alert = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  alert?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, button, select")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="theory-document-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        className="theory-document-dialog"
        role={alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
          if (event.key === "Tab") {
            const controls = ref.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled),select,textarea",
            );
            const first = controls?.[0];
            const last = controls?.[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <strong>{title}</strong>
          <button
            type="button"
            data-ui="icon-action"
            aria-label="关闭地图配置"
            title="关闭"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
