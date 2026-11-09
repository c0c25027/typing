/**
 * storage.js
 * マップをブラウザの localStorage に保存・復元し、JSON ファイルとして書き出し・読み込みするクラスです。
 * localStorage はプライベートブラウズ等で使えない場合があるため、すべて例外を握りつぶして続行します。
 */
class MapStorage {
  /**
   * @param {string} [key] localStorage のキーです。
   */
  constructor(key = 'word-mindmap:v1') {
    this.key = key;
    this.timer = null;
  }

  /**
   * 保存済みのマップデータを読み込みます。
   * @returns {object|null} 保存データです。無い・読めない場合は null です。
   */
  load() {
    try {
      const raw = window.localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  /**
   * マップデータを即時に保存します。
   * @param {MindMapModel} model 保存するモデルです。
   * @returns {boolean} 保存できたら true です。
   */
  save(model) {
    try {
      window.localStorage.setItem(this.key, JSON.stringify(model.toJSON()));
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * 連続した変更をまとめて、少し待ってから保存します。
   * @param {MindMapModel} model 保存するモデルです。
   * @param {number} [delayMs] 待ち時間（ミリ秒）です。
   */
  saveSoon(model, delayMs = 600) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(model), delayMs);
  }

  /**
   * マップを JSON ファイルとしてダウンロードさせます。
   * @param {MindMapModel} model 書き出すモデルです。
   */
  exportFile(model) {
    const blob = new Blob([JSON.stringify(model.toJSON(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `word-mindmap-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * 選択された JSON ファイルを読み込み、オブジェクトとして返します。
   * @param {File} file 読み込むファイルです。
   * @returns {Promise<object>} 解析済みのデータです。
   * @throws {Error} JSON として読めない場合です。
   */
  async importFile(file) {
    const text = await file.text();
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error('JSON ファイルとして読み込めませんでした。');
    }
  }
}
