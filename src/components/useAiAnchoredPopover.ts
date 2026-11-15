import { useLayoutEffect, type RefObject } from 'react';
import './AiChatPopovers.css';

export type AiChatPopover = 'history' | 'usage' | 'model' | 'quick' | 'memory' | 'references' | 'skills' | 'help';

const panels: Record<AiChatPopover, { control: string; panel: string; width: number; height: number }> = {
  history: { control: '.mewiki-ai-conversation-control', panel: '.mewiki-ai-conversation-panel', width: 360, height: 380 },
  usage: { control: '.mewiki-ai-usage-control', panel: '.mewiki-ai-usage-panel', width: 360, height: 350 },
  model: { control: '.mewiki-ai-model-menu', panel: '.mewiki-ai-model-options', width: 320, height: 260 },
  quick: { control: '.mewiki-ai-quick-menu', panel: '.mewiki-ai-quick-options', width: 250, height: 320 },
  memory: { control: '.mewiki-ai-memory-control', panel: '.mewiki-ai-memory-panel', width: 360, height: 400 },
  references: { control: '.mewiki-ai-reference-control', panel: '.mewiki-ai-reference-picker', width: 360, height: 440 },
  skills: { control: '.mewiki-ai-skills-control', panel: '.mewiki-ai-skills-panel', width: 400, height: 520 },
  help: { control: '.mewiki-ai-product-help-control', panel: '.mewiki-ai-product-help-panel', width: 380, height: 480 },
};

/** Existing controls retain their DOM, drafts and event handling; only their surface and geometry change. */
export function useAiAnchoredPopover(root: RefObject<HTMLElement | null>, active: AiChatPopover | null, contentKey = '') {
  useLayoutEffect(() => {
    const workspace = root.current, config = active && panels[active];
    if (!workspace || !config) return;
    const host = workspace.closest<HTMLElement>('.mewiki-ai-floating-panel');
    const panel = workspace.querySelector<HTMLElement>(config.panel);
    const trigger = workspace.querySelector<HTMLElement>(`${config.control} > :is(button, summary)`);
    if (!host || !panel || !trigger) return;
    const previousStyle = panel.getAttribute('style');
    panel.dataset.aiPopover = active === 'memory' || active === 'skills' ? 'editor' : 'action';
    trigger.dataset.aiPopoverAnchor = '';
    let frame = 0;
    const place = () => {
      if (!workspace.getClientRects().length || !trigger.getClientRects().length) return;
      const area = workspace.getBoundingClientRect(), origin = host.getBoundingClientRect(), anchor = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = Math.max(area.left, viewport?.offsetLeft ?? 0) + 6;
      const top = Math.max(area.top, viewport?.offsetTop ?? 0) + 6;
      const right = Math.min(area.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth)) - 6;
      const bottom = Math.min(area.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight)) - 6;
      const above = Math.max(0, anchor.top - 6 - top), below = Math.max(0, bottom - anchor.bottom - 6);
      const limit = Math.min(config.height, Math.max(above, below));
      panel.style.position = 'fixed';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.width = `${Math.max(0, Math.min(config.width, right - left))}px`;
      panel.style.maxHeight = `${limit}px`;
      const height = panel.getBoundingClientRect().height;
      const side = height <= above || above >= below ? 'top' : 'bottom';
      const available = Math.min(config.height, side === 'top' ? above : below);
      panel.style.maxHeight = `${available}px`;
      const headerHeight = panel.querySelector(':scope > header')?.getBoundingClientRect().height ?? 0;
      for (const name of ['--ai-conversations-max-height', '--ai-usage-max-height', '--ai-memory-height', '--ai-skills-height', '--ai-references-max-height', '--ai-product-help-height']) {
        panel.style.setProperty(name, `${Math.max(0, available - headerHeight - 2)}px`);
      }
      const rect = panel.getBoundingClientRect();
      const x = Math.max(left, Math.min(anchor.left, right - rect.width));
      const y = side === 'top' ? anchor.top - 6 - rect.height : anchor.bottom + 6;
      panel.style.left = `${x - origin.left - host.clientLeft}px`;
      panel.style.top = `${y - origin.top - host.clientTop}px`;
      panel.dataset.aiPopoverSide = side;
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    place();
    const observer = new ResizeObserver(schedule);
    for (const element of [workspace, host, trigger, panel, workspace.querySelector('form')]) if (element) observer.observe(element);
    const mutations = new MutationObserver(schedule);
    mutations.observe(host, { attributes: true, attributeFilter: ['style', 'hidden', 'data-placement', 'data-compact'] });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); mutations.disconnect();
      window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule);
      delete panel.dataset.aiPopover; delete panel.dataset.aiPopoverSide; delete trigger.dataset.aiPopoverAnchor;
      if (previousStyle === null) panel.removeAttribute('style'); else panel.setAttribute('style', previousStyle);
    };
  }, [root, active, contentKey]);
}
