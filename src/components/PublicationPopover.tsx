import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useFormulaPopover } from './useFormulaPopover.ts';

export default function PublicationPopover({ trigger, label, toolbar = false, onClose, children }: {
  trigger: HTMLButtonElement; label: string; toolbar?: boolean;
  onClose: (restoreFocus?: boolean) => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(trigger);
  useFormulaPopover({ ref, triggerRef, getAnchor: () => trigger.getBoundingClientRect(), onCancel: onClose });
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, button:not(:disabled)')?.focus({ preventScroll: true });
  }, []);
  return <div ref={ref} popover="manual" role={toolbar ? 'toolbar' : 'dialog'} aria-label={label} aria-orientation={toolbar ? 'vertical' : undefined}
    className={`mewiki-publication-popover${toolbar ? ' is-actions' : ''}`}
    onKeyDown={event => {
      if (!toolbar || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>{children}</div>;
}
