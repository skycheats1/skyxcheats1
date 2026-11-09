// src by SKY CHEATS. Copy right SKY CHEATS
import { db } from './firebase.js';
import { makeStore } from './supportStore.js';

export * from './supportStore.js';
export const store = makeStore(db);
