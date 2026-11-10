/** @module wwwroot/modules/locales/ja.js @version 0.1.0 @see docs/img_room_spec.md */
// i18n 日本語パック。契約附表 A 全キー + §12 エラー文言（追加キーは実装報告に記載）。
export default {
	'app.title': 'ImageRoom',
	'hdr.usage': '保存使用量',
	'hdr.mode.normal': '通常',
	'hdr.mode.sync': '同期',
	'hdr.mode.server': 'サーバー',
	'hdr.lang': '言語',
	'btn.trash': 'ゴミ箱',
	'btn.bulkdl': '一括 DL',
	'btn.logout': 'ログアウト',
	'btn.login': 'ログイン',
	'btn.create': '部屋作成',
	'btn.qr': 'QR',
	'btn.pw.issue': 'パスワード発行',
	'btn.oa.manage': '許可オリジン管理',
	'btn.srv.toggle': 'サーバーモード切替',
	'lbl.username': 'ユーザー名',
	'lbl.password': 'パスワード',
	'lbl.mode': 'モード',
	'btn.cal.day': '日', // §5.5 カレンダーモード切替（room_calendar）
	'btn.cal.week': '週',
	'btn.cal.month': '月',
	'msg.auth.waitMembers': 'メンバーの採決を待っています',
	'msg.auth.fail': 'パスワードまたはオリジンが違います', // §12 認証失敗
	'msg.auth.noMember': '認証できません（採決応答なし）', // §12 採決応答なし（再試行ボタン併記）
	'msg.auth.srvDisabled': 'サーバーモードが無効のためログインできません', // §6.8
	'msg.creator.otherAdmin': '別の管理者が部屋を立ち上げているようです', // §12 部屋再作成後の旧参加者
	'msg.room.recreated': '部屋設定が再作成されました。再認証が必要です', // §12 セッション中の cr 不一致
	'msg.conflict.blocked': '部屋が再作成済みのため自動再参加できません', // §12 room.json conflict
	'msg.month.expire': 'UTC 月境界に達しました。パスワード再入力で再ログインしてください', // §12 / §6.7
	'msg.offline': 'オフラインモードです', // §9.7 WS 切断
	'msg.fetch.progress': '取得中 {n}/{m}',
	'msg.fetch.fail': '保持者が見つかりません', // §12 A{st:nf}/Q 応答なし 全滅
		'lbl.cal.more': '+{n} 件',
	'lbl.thumb.size': 'サムネサイズ',
'msg.share.tooBig': '画像が大きすぎます（上限 {limit} MB）',
	'msg.share.unsupported': '「{name}」はこのブラウザがサポートする画像形式ではないため、お断りしました',
	'msg.share.tooBig': '大きすぎる画像です（ブラウザの安全なメモリ上限 256MB を明らかに超えるためお断りしました）',
	'msg.share.over': '「{name}」({mb}MB) は上限 ({lim}MB) を超えています。\n長辺 4096px 以内への縮小と JPEG 再圧縮による変換共有をおこないませんか？\n（デコードできない形式や、メモリ上限を超える大きさは変換前にお断りします）',
	'msg.hiber.ok': '長時間動作のためページを再読み込みしました。自動再参加しました',
	'msg.hiber.fail': '自動再参加に失敗しました。ログインし直してください',
	'msg.share.ok': '共有しました',
	'lbl.trash.empty': 'ゴミ箱は空です',
	'btn.trash.purge': '完全に削除',
	'btn.trash.empty': 'ゴミ箱を空にする',
	'msg.trash.sweep': '期限切れのゴミを削除しました', // §9.8 物理削除
	'lbl.sync.footer': '全 {total} 件中 {fetched} 件取得済み', // §5.7
	'btn.autodl': '自動 DL 台帳',
	'btn.autodl.clear': '台帳をクリア',
	'msg.autodl.cleared': '自動 DL 台帳をクリアしました',
	'lbl.participants': '参加者',
	'lbl.pastParticipants': '過去の参加者',
	'lbl.opfs.total': '合計',
	'lbl.opfs.room': 'この部屋',
	'msg.offline.gray': '保持者が全員不参加のため取得できません', // §5.5 グレースケール
	'msg.zip.part': 'ZIP パート {n}', // §9.10
	'msg.qr.verify.fail': 'QR の検証に失敗しました',
	'msg.scan.cameraUnavail': 'カメラを利用できません', // §6.4
	'msg.scan.paste': 'QR 画像またはテキストを貼り付けてください', // §6.4 代替入力
	'msg.settings.saved': '設定を保存しました', // §11
	// --- §12 由来の追加キー（ja/en 両方） ---
	'msg.opfs.unavail': 'OPFS 未対応のため共有・保存・認証の永続化は無効です', // §12 OPFS 不存在環境
	'msg.origin.denied': '許可されていないオリジンのため参加できません', // §12 許可外オリジン / §6.6
	'msg.xorig.mismatch': '許可オリジンが異なる部屋設定の更新を無視しました', // §12 xorig 不一致の C
	'msg.h10.mismatch': 'ハッシュ検証に失敗しました（再試行不可）', // §12 h10 検証不一致 toast
	'msg.transfer.chunkFail': 'チャンク転送に失敗しました', // §12 上限超過で転送失敗
	'msg.ts.corrected': '不正な受信時刻（未来 ts）を補正しました', // §12 不正時刻
	'msg.uid.renamed': 'ユーザー ID が衝突したため {uid} に変更しました', // §12 同一 userId 衝突
	'msg.sync.vanished': '同期対象が消滅したため取得を取り消しました', // §12 同期対象の消滅
	'msg.session.mirror': 'この部屋には既に参加しています（ミラータブとして表示）', // §9.12 重複ログイン
	'msg.srv.kicked': 'サーバーモードが無効になったためログアウトしました', // §12 サーバー参加中に srvOn=false
	// ---- room_app.js 追加キー（§5 UI 用・実装報告に記載）----
	'lbl.room.list': '登録済み部屋', // §5.1 ホーム
	'lbl.room.name': '部屋名',
	'btn.join': '参加',
	'btn.retry': '再試行', // §12 採決応答なし
	'btn.leave': '退室', // §5.2
	'btn.close': '閉じる', // §5.4
	'btn.save': '保存',
	'btn.dl': 'DL',
	'btn.copy': 'コピー',
	'btn.scan': 'QR スキャン', // §5.4
	'btn.qr.png': 'PNG 保存',
	'btn.pw.auto': 'パスワード再作成', // §6.3（v2.2 §26: 既定で自動生成済み→再作成）
	'tab.view.imgs': '画像', // 追加仕様: 部屋ビュー内サブタブ
	'tab.view.qrurl': 'URL QR',
	'tab.view.qrpw': 'パスワード QR',
	'lbl.qr.url': '部屋 URL',
	'lbl.part.join': '参加時刻',
	'lbl.maxmb': 'アップロード上限 (MB)', // 追加仕様: 部屋作成時の単一画像上限
	'btn.view.fit': '表示幅', // 追加仕様: ビューアサイズ切替
	'btn.view.native': 'ネイティブ',
	'btn.view.z4': '1/4',
	'btn.view.h2': '1/2',
	'btn.view.x2': '2倍',
	'btn.view.x4': '4倍',
	'lbl.view.size': 'サイズ',
	'lbl.meta.sha': 'SHA256',
	'lbl.qr.scan.url': 'スキャンするとブラウザで ImageRoom が開き、部屋名が入力済みの参加画面になります。参加には部屋パスワードの入力が必要です。',
	'lbl.qr.scan.pw': 'スキャンすると ImageRoom のパスワード参加（パスワード入力済み）に使用できます。',
	'lbl.qr.secret': 'この QR には部屋パスワードが平文で埋め込まれています。秘密鍵として取り扱い、信頼できる人に見せる・保存後に表示端末から削除するよう注意してください。',
	'btn.xorig': 'クロスオリジン許可', // §6.6 作成オプション
	'btn.room.menu': '部屋設定', // §5.2 ルームキーメニュー
	'btn.fs': '全画面表示',
	'btn.slide': 'スライドショー',
	'msg.fs.exit': '全画面表示を終了しますか？',
	'msg.slide.exit': 'スライドショーを終了しますか？',
	'btn.confirm.keep': '続ける',
	'btn.confirm.stop': '終了',
	'btn.ws': '接続設定',
	'ws.title': '接続設定（WebSocket URL）',
	'ws.note': '空欄ならこのサイト（既定）に接続します。設定は保存され、次回再接続から有効です',
	'ws.btn.qr': 'QR 表示',
	'ws.btn.scan': 'QR 読取',
	'ws.btn.apply': '適用',
	'ws.btn.default': 'サイト既定',
	'msg.ws.set': 'WebSocket URL を設定しました:',
	'msg.ws.got': 'QR から WebSocket URL を読み込みました',
	'msg.ws.bad': 'WebSocket URL が正しくありません',
	'msg.ws.multi': 'WebSocket URL は 1 つだけ指定できます',
	'btn.trash.ico': '🗑️',
	'msg.dl.ok': 'ダウンロードしました', // v2.2 §26
	'mode.sync': '同期',
	'mode.normal': '通常',
	'btn.trash.restore': '復元', // §5.6
	'lbl.qr.text': 'QR テキスト',
	'lbl.autodl.count': '自動 DL 済み', // §5.7 台帳件数
	'lbl.meta.n': 'ファイル名', // §5.4 メタ
	'lbl.meta.u': '投稿者',
	'lbl.meta.ts': '投稿時刻',
	'lbl.meta.r': '所属部屋',
	'lbl.meta.t': 'MIME',
	'lbl.meta.h': 'ハッシュ',
	'msg.room.created': '部屋を作成しました',
	'msg.room.exists': '同名の部屋が既にあります（ログインしてください）', // §5.3
	'msg.form.nm': '部屋名を入力してください',
	'msg.form.uid': 'ユーザー名を入力してください',
	'msg.share.fail': '共有に失敗しました',
	'msg.trash.purged': '完全削除しました',
	'msg.qr.needpw': 'パスワード平文はこのセッションでの再発行/作成時のみ表示できます', // §6.4
	'msg.pw.issued': '新しいパスワードを発行しました',
	'msg.srv.on': 'サーバーモードを許可しました',
	'msg.srv.off': 'サーバーモード許可を解除しました',
	'msg.oa.updated': '許可オリジンリストを更新しました',
};
