export const awaitF = (n = 100) => new Promise(resolve => setTimeout(() => resolve(), n));
export const CB = () => {};
export const STATE = { d: true };
const L_H = '[log]';
export const L = (m, o, f = CB) => console.log(`${L_H} ${m}`, o) || f(m);
const D_H = '[log]';
export const D = (m, o, f = CB) => (STATE.d ? console.log(`${D_H} ${m}`, o) || f(m) : null);
