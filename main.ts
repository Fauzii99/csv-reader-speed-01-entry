import { setFlagsFromString } from 'node:v8';
setFlagsFromString('--no-incremental-marking --no-opt --no-compilation-cache --single-threaded --max-semi-space-size=16 --max-old-space-size=512');
await import(new URL('./driver.js', import.meta.url).href);
