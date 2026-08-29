export interface CollapsiblePanelController {
  isCollapsed: () => boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
}

export function setupCollapsiblePanel(
  toggleButton: HTMLButtonElement,
  content: HTMLElement,
  initiallyCollapsed = false,
): CollapsiblePanelController {
  let collapsed = initiallyCollapsed;
  const sync = () => {
    content.hidden = collapsed;
    toggleButton.setAttribute('aria-expanded', String(!collapsed));
    toggleButton.textContent = collapsed ? '+' : '−';
    toggleButton.title = collapsed ? '展开' : '折叠';
  };
  toggleButton.type = 'button';
  toggleButton.setAttribute('aria-controls', content.id);
  toggleButton.onclick = () => {
    collapsed = !collapsed;
    sync();
  };
  sync();
  return {
    isCollapsed: () => collapsed,
    setCollapsed: (value) => {
      collapsed = value;
      sync();
    },
    toggle: () => {
      collapsed = !collapsed;
      sync();
    },
  };
}

export function createCollapseButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'panel-collapse-toggle';
  button.setAttribute('aria-label', `${label}面板折叠`);
  return button;
}

export function setupCollapsiblePanelWithButton(
  host: HTMLElement,
  content: HTMLElement,
  label: string,
  initiallyCollapsed = false,
): CollapsiblePanelController {
  const button = createCollapseButton(label);
  host.appendChild(button);
  return setupCollapsiblePanel(button, content, initiallyCollapsed);
}
