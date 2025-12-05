export const awaitF = (n = 100) => new Promise(resolve => setTimeout(() => resolve(), n));
export const STATE = { d: true };
const L_H = '[log]';
export const L = (m, o, f) => (console.log(`${L_H} ${m}`, o) || (f && typeof f === 'function') ? f(m) : f);
const D_H = '[log]';
export const D = (m, o, f) =>
	STATE.d ? (console.log(`${D_H} ${m}`, o) || (f && typeof f === 'function') ? f(m) : f) : null;
