import { App } from './App';

const canvas = document.getElementById('gl') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas element #gl not found');
}

const app = new App(canvas);
void app.start();
