export class Crosshair {
  private el: HTMLDivElement;

  constructor(elementId = 'crosshair') {
    this.el = document.getElementById(elementId) as HTMLDivElement;
  }

  show() {
    this.el.style.display = 'block';
  }

  hide() {
    this.el.style.display = 'none';
  }
}
