export class OfflineIndicator {
  private element: HTMLElement;

  constructor(elementId: string) {
    this.element = document.getElementById(elementId)!;
  }

  setOffline(offline: boolean): void {
    this.element.style.display = offline ? 'block' : 'none';
  }
}
