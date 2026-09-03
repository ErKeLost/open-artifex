import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import png2icons from 'png2icons';

const projectRoot = resolve(import.meta.dirname, '..');
const sourcePath = resolve(projectRoot, 'src/renderer/assets/open-artifex-mark.png');
const outputDirectory = resolve(projectRoot, 'assets/icons');
const outputBasePath = resolve(outputDirectory, 'open-artifex');

await mkdir(outputDirectory, { recursive: true });

const source = await readFile(sourcePath);
const icns = png2icons.createICNS(source, png2icons.BICUBIC2, 0);
const ico = png2icons.createICO(source, png2icons.BICUBIC2, 0, false, true);

if (!icns || !ico) {
  throw new Error('Failed to generate desktop icons from the Open Artifex mark');
}

await Promise.all([
  writeFile(`${outputBasePath}.icns`, icns),
  writeFile(`${outputBasePath}.ico`, ico),
  copyFile(sourcePath, `${outputBasePath}.png`),
]);

console.log(`Generated macOS, Windows, and Linux icons in ${outputDirectory}`);
