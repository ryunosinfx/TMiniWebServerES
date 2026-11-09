// ImageRoom エントリポイント（仕様 §2: 最小静的構成 + module entry 読込）
// 処理はすべて modules/imgroom/room_app.js 側にある。
/** @module img_room.js @version 0.1.0 @see docs/img_room_spec.md */
import { RoomApp } from './modules/imgroom/room_app.js';

window.addEventListener('load', () => new RoomApp().boot());
