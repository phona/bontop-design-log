export class InfoPanel {
  private element: HTMLElement;

  constructor(elementId: string) {
    this.element = document.getElementById(elementId)!;
  }

  showObjectInfo(objectId: string): void {
    const [type, subtype, ...rest] = objectId.split(':');

    let info = `
      <h3>物体信息</h3>
      <p><strong>对象ID:</strong> ${objectId}</p>
      <p><strong>类型:</strong> ${type}</p>
    `;

    if (subtype) {
      info += `<p><strong>子类型:</strong> ${subtype}</p>`;
    }

    if (rest.length > 0) {
      info += `<p><strong>详情:</strong> ${rest.join(':')}</p>`;
    }

    this.element.innerHTML = info;
    this.element.style.display = 'block';
  }

  hide(): void {
    this.element.style.display = 'none';
  }
}
