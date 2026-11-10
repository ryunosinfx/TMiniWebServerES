# 10 万画像スケーリング実装設計(v1.5 提案 3 点)

> 2026-11-10: **実装済み**(spec §19。テスト img-scale.mjs「SCALE OK」+ 既存 6 テスト緑。実測は spec §19 の表参照)。設計からの追加実装: sheet 起動高速パス(sheetidx 群指紋)/空シート生成廃止/_bodySet、OPFS.w truncate 修正、共有時 manifest 保存(潜在バグ修正)。

目的: §18 試算で破綻と判明した「スマホ 1 タブ × 10 万画像」を
①セル表示上限+「他 N 件」 ②per-day meta まとめ読み ③manifest 差分ログ で定常 ~35〜60MB・起動秒レベルへ。

## ① CalView cell 表示上限(dom 定数化)
- cal_view.js: ctor opt.cellCap(0=無制限・後方互換)/opt.moreText(n=>文字列)/opt.onExpand()。
  `this._exp = Map(bucketKey→表示数)`。cell()/dayBlk() で `shown = cap ? min(v.length, _exp.get(k)||cap) : v.length`。
  items ラップ用箱 `bx = Vw.div(cell)` + `fillItems(bx,b,k)`; 残り>0 なら button.cal-more(`moreText(残り)`) click → `_exp.set(k, shown + cap*4)` → `Vw.rc(bx); fillItems(...)` → `onExpand()`(room_calendar 側で schedulePass)。
  ※旧 el は isConnected=false になる → RoomCalendar.winPass が mounts 掃除、次 pass で新 el pickup(既存機構)。
- ir_const CFG: `CELL_CAP: 12`。room_calendar: CalView 生成に cellCap/moreText(t('lbl.cal.more',{n}))/onExpand を配線。
- locale: lbl.cal.more = '+{n} 件'/'{n} more'。

## ② HashStore meta → per-day jsonl(1 日 1 ファイル + 追記)
- 新フォーマット: `meta/d<dayKey>.jsonl`、dayKey=floor(ts/86400000)。1 行 = meta JSON 1 個(last-wins)。tombstone 行 {h, del:1}。
- `metaPut`: 対応 day file に行 append(OPFS.ap)+`_mmap.set`。
- `metaAll`: day files 読込→Map reduce(del で delete)→`_mmap` 再構築→values。**legacy `meta/<h>.json` が残っていれば读取→day file へ群append→legacy 削除(マイグレーション、初回のみ)**。
- `metaGet`: `_mmap` hit → miss なら metaAll 後再 hit。
- `sweep`: metaAll 後、期限切れ d を **day file 書換(compact、期限切れ行除去)+bodies rm** で物理削除。
- `sizesOf`: meta per 件は day files 平均サイズ(総 bytes/件数)で概算(表示用途、粗さ許容)。
- `usage`: meta dir sum のまま(day files)✓。
- OPFS.js 追加: `static ap = async (p, u8)` — mkFile→getFile? — **createWritable({keepExistingData:true}) + seek(ファイルサイズ) + write + close**(標準 FileSystemWritableFileStream)。新規追加のみ、既存 ws_chat 影響なし。

## ③ Collection manifest → jsonl 差分ログ(呼び出し側不変)
- パス: 新 `rooms/<rid>/manifest.<uid>.jsonl`(行=entry object / 削除行 {x:1,h})。legacy `manifest.<uid>.json` は loadManifest で読替→jsonl 全書き→legacy rmf。
- loadManifest: jsonl 読込→h で Map merge(x で delete)→this.manifest/mset、`this._mLines`=行数。
- **saveManifest() は署名・呼び出し箇所そのまま**: 追加なら dirty 追跡(`_dirty = {add:[], del:[]}` を _manifestAdd/_manifestRemove が記録)→ 行数 <= 1.6×manifest.length なら **append のみ**(O(追加))、超過で compact 全書(jsonl 1 行/entry)。
- share 毎の全 stringify(O(N²))消滅。boot: 1 ファイル読込(10 万で ~16MB・数秒)+parse。

## テスト
- 新規 browserTest/tests/img-scale.mjs:
  1. cap: 30 枚短時間共有 → 当日セル `.cal-cell .ir-thumb` ≤12、button.cal-more('+18 件')→ click → 全 30 マウント、pass 再走。
  2. 10 万合成: in-page で OPFS に meta day jsonl(10 万行・ts を 400 日分散)+manifest jsonl 直接書込み → reload+login → refreshMetas 時間実測(目標 <5s)・heap 実測・DOM cap 検証(.ir-thumb ≤ 12×当月日数)。
  3. 1 枚 share 時の saveManifest 時間(10 万 manifest 状態、<100ms)。
- 既存 4 レグ(img-room/spec/demo/hiber)+ img-perf/img-perf1024 が全て緑(meta jsonl 透過・cap 既定 12 で 41 枚=当日 41→**cap 検証に注意: 41 枚同日 → `.ir-thumb` 12+… 既存 test が thumb 数を full で assert していないか要確認**(perf1024 monthMounted=mounts は renderItem 実行数だが **cap で renderItem は shown 分のみ** → mounts 12×! → **perf1024/perf のアサート修正必要**: mounts>=N → mounts>0 + items 数は inner で確認へ)。
- spec: §18 に「v1.5 実装後は…」注記 + §19 実装記録。

## 既知の副作用・注意
- CalView cell の renderItem 呼び出し数が shown に減る → RoomCalendar.mounts/wanted/`document.querySelectorAll('.ir-thumb')` 件数が cap 内のみ(perf 系アサート調整)。
- hiber 復帰は同一パス(read)なので変更不要。server モードも collection 同一。
- metaGet scan は metaAll 後 miss 時のみ(実質ほぼ発生せず)。
- マイグレーションは legacy ファイル存在時 1 回だけ(10 万 legacy = 1 回だけ 35 分、以後秒)。
