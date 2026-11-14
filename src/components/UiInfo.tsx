import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Info, X } from 'lucide-react';
import { t } from '../i18n/locale.ts';
import { useFormulaPopover } from './useFormulaPopover.ts';
import './UiInfo.css';

function InfoPanel({ label, id, triggerRef, onClose, children }: {
  label: string; id: string; triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: (restoreFocus?: boolean) => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const getAnchor = useCallback(() => triggerRef.current!.getBoundingClientRect(), [triggerRef]);
  useFormulaPopover({ ref, triggerRef, getAnchor, onCancel: onClose });
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  return <div ref={ref} id={id} popover="manual" role="dialog" aria-label={label} tabIndex={-1} className="mewiki-ui-info-panel">
    <header><strong>{label}</strong><button type="button" data-ui="icon-action" aria-label={t('关闭说明')} title={t('关闭说明')} onClick={() => onClose(true)}><X size={14} /></button></header>
    <div className="mewiki-ui-info-content">{children}</div>
  </div>;
}

export default function UiInfo({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);
  return <div className="mewiki-ui-info" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}>
    <button ref={triggerRef} type="button" data-ui="icon-action" aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}><Info size={15} aria-hidden="true" /></button>
    {open && <InfoPanel label={label} id={id} triggerRef={triggerRef} onClose={close}>{children}</InfoPanel>}
  </div>;
}
