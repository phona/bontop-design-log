import { App } from './App.js';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const app = new App(canvas);
void app.start();
