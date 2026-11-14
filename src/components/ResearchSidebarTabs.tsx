import type { ReactNode } from 'react';

export interface ResearchSidebarTab<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
  controls?: string;
  elementId?: string;
}

export default function ResearchSidebarTabs<T extends string>({ tabs, selected, label, className, vertical = false, expanded, leading, trailing, focusGroup, onSelect }: {
  tabs: readonly ResearchSidebarTab<T>[];
  selected: T;
  label: string;
  className: string;
  vertical?: boolean;
  expanded?: T;
  leading?: ReactNode;
  trailing?: ReactNode;
  focusGroup?: string;
  onSelect: (id: T, trigger: HTMLButtonElement) => void;
}) {
  return <nav className={className} role="tablist" aria-label={label} data-sidebar-focus-group={focusGroup} aria-orientation={vertical ? 'vertical' : 'horizontal'} onKeyDown={event => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === (vertical ? 'ArrowDown' : 'ArrowRight') ? (index + 1) % buttons.length
        : event.key === (vertical ? 'ArrowUp' : 'ArrowLeft') ? (index + buttons.length - 1) % buttons.length : -1;
    if (next < 0) return;
    event.preventDefault();
    if (next === index) return;
    const button = buttons[next], root = event.currentTarget.closest('.research-notebook-layout');
    button.focus({ preventScroll: true }); button.click();
    // Docked AI and the outline own separate headers; keep keyboard focus across them.
    if (focusGroup && root) requestAnimationFrame(() => {
      const replacement = [...root.querySelectorAll<HTMLButtonElement>('[data-sidebar-focus-group] [role="tab"]')]
        .find(tab => tab.closest<HTMLElement>('[data-sidebar-focus-group]')?.dataset.sidebarFocusGroup === focusGroup && tab.getAttribute('aria-label') === button.getAttribute('aria-label') && tab.getClientRects().length);
      replacement?.focus({ preventScroll: true });
    });
  }}>
    {leading}
    {tabs.map(tab => <button key={tab.id} id={tab.elementId} type="button" role="tab" aria-label={tab.label} title={tab.label}
      aria-selected={selected === tab.id} aria-expanded={vertical ? expanded === tab.id : undefined}
      aria-controls={tab.controls} tabIndex={selected === tab.id ? 0 : -1}
      onClick={event => onSelect(tab.id, event.currentTarget)}>{tab.icon}</button>)}
    {trailing}
  </nav>;
}
