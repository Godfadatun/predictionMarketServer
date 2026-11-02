import 'reflect-metadata';
import { config } from '@/config';
import { createApp } from '@/app.factory';

createApp().then((app) => app.listen(config.port)).then(() => console.log(`API listening on :${config.port}`));
