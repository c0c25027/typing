/**
 * app.js
 * 各クラス（モデル・ビュー・レイアウト・関連語サービス・音声入出力・保存）をつなぐコントローラです。
 * 画面の DOM 要素とのやり取りはこのクラスに集約しています。
 */
class WordMindMapApp {
  /**
   * @param {object} deps 依存オブジェクトです（テスト時に差し替えられるよう外から渡します）。
   * @param {MindMapModel} deps.model
   * @param {RelatedWordService} deps.service
   * @param {MapStorage} deps.storage
   * @param {Speaker} deps.speaker
   */
  constructor({ model, service, storage, speaker }) {
    this.model = model;
    this.service = service;
    this.storage = storage;
    this.speaker = speaker;
    /** 選択中のノード ID です。 */
    this.selectedId = null;
    /** 候補として表示する関連種別です。 */
    this.relation = 'trg';
    /**
     * 選択中ノードについて読み込み済みの候補です（関連種別 → 単語配列）。
     * 音声・文字入力された単語がどの関連にあたるかの判定に使います。
     */
    this.loadedSuggestions = {};
    /** 古い通信結果で表示を上書きしないための連番です。 */
    this.requestSeq = 0;

    this.el = WordMindMapApp.queryElements();
    this.layout = new ForceLayout(model, () => this.view.updatePositions());
    this.view = new MindMapView(this.el.svg, model, {
      onSelect: (id) => this.select(id),
      onActivate: (id) => this.pronounce(id),
      onDragMove: () => {
        this.layout.start(0.3);
        this.storage.saveSoon(this.model);
      },
    });
    this.speech = new SpeechInput({
      lang: 'en-US',
      onFinal: (alts) => this.handleVoice(alts),
      onInterim: (text) => this.showInterim(text),
      onStateChange: (on) => this.updateMicState(on),
      onError: (msg) => this.toast(msg, 'error'),
    });

    model.subscribe(() => {
      this.view.renderStructure();
      this.layout.start(0.8);
      this.storage.saveSoon(this.model);
      this.updateEmptyState();
    });
  }

  /**
   * 画面で使う DOM 要素をまとめて取得します。
   * @returns {object} 要素名 → 要素 のオブジェクトです。
   */
  static queryElements() {
    const $ = (id) => document.getElementById(id);
    return {
      svg: $('map'),
      form: $('word-form'),
      input: $('word-input'),
      mic: $('mic-btn'),
      interim: $('interim'),
      follow: $('follow-new'),
      panel: $('panel'),
      selWord: $('sel-word'),
      defs: $('sel-defs'),
      speak: $('speak-btn'),
      center: $('center-btn'),
      remove: $('delete-btn'),
      tabs: $('relation-tabs'),
      suggestions: $('suggestions'),
      sourceNote: $('source-note'),
      addAll: $('add-all-btn'),
      neighbors: $('neighbors'),
      zoomIn: $('zoom-in'),
      zoomOut: $('zoom-out'),
      resetView: $('reset-view'),
      exportBtn: $('export-btn'),
      importInput: $('import-input'),
      clear: $('clear-btn'),
      empty: $('empty-state'),
      toast: $('toast'),
      legend: $('legend'),
    };
  }

  /** 初期化処理です。保存データの復元とイベント登録を行います。 */
  init() {
    this.renderTabs();
    this.renderLegend();
    this.bindEvents();

    if (!this.speech.isSupported()) {
      this.el.mic.disabled = true;
      this.el.mic.title = 'このブラウザは音声入力（Web Speech API）に対応していません。Chrome / Edge / Safari をお使いください。';
    }
    if (!this.speaker.isSupported()) this.el.speak.disabled = true;

    const saved = this.storage.load();
    if (saved) {
      try {
        this.model.loadJSON(saved);
      } catch (err) {
        this.toast('保存データを読み込めなかったため、新しいマップで始めます。', 'error');
      }
    }
    this.view.renderStructure();
    this.view.fitAll();
    this.updateEmptyState();
    this.renderPanel();
  }

  /** ボタン・フォーム・キーボードショートカットのイベントを登録します。 */
  bindEvents() {
    const el = this.el;
    el.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleTyped(el.input.value);
      el.input.value = '';
    });
    el.mic.addEventListener('click', () => this.speech.toggle());
    el.speak.addEventListener('click', () => this.pronounce(this.selectedId));
    el.center.addEventListener('click', () => this.view.centerOn(this.selectedId));
    el.remove.addEventListener('click', () => this.removeSelected());
    el.addAll.addEventListener('click', () => this.addAllSuggestions());
    el.zoomIn.addEventListener('click', () => this.view.zoomBy(1.25));
    el.zoomOut.addEventListener('click', () => this.view.zoomBy(0.8));
    el.resetView.addEventListener('click', () => this.view.fitAll());
    el.exportBtn.addEventListener('click', () => this.storage.exportFile(this.model));
    el.importInput.addEventListener('change', () => this.importSelectedFile());
    el.clear.addEventListener('click', () => {
      if (this.model.nodes.size === 0 || window.confirm('マップをすべて消去します。よろしいですか？')) {
        this.model.clear();
        this.select(null);
      }
    });
    el.tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-rel]');
      if (btn) this.setRelation(btn.dataset.rel);
    });
    el.suggestions.addEventListener('click', (e) => {
      const chip = e.target.closest('button[data-word]');
      if (chip && this.selectedId != null) this.addWord(chip.dataset.word, this.selectedId, this.relation);
    });
    el.neighbors.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (btn) this.select(Number(btn.dataset.id), true);
    });
    window.addEventListener('pagehide', () => this.storage.save(this.model));
    // モバイルでは pagehide が呼ばれない場合があるため、タブが隠れた時点でも保存します。
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.storage.save(this.model);
    });
    // スペースキー長押しの代わりに、入力欄の外で「M」キーを押すとマイクを切り替えます。
    document.addEventListener('keydown', (e) => {
      const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement && document.activeElement.tagName);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        this.speech.toggle();
      } else if (e.key === 'Delete' && this.selectedId != null) {
        // Backspace はブラウザの「戻る」操作と紛らわしく誤削除を招くため、Delete キーのみにしています。
        e.preventDefault();
        this.removeSelected();
      } else if (e.key === 'Escape') {
        this.select(null);
      }
    });
  }

  /**
   * 単語をマップに追加する共通処理です。
   * 選択中のノードがあれば、そのノードに接続します。
   * @param {string} word 追加する単語です。
   * @param {number|null} parentId 接続先ノードの ID です。
   * @param {string} relation 関連種別です。
   * @returns {WordNode|null} 追加（または既存）のノードです。
   */
  addWord(word, parentId, relation) {
    const { node, created, linked } = this.model.addWord(word, parentId, relation);
    if (!node) return null;
    if (!created && !linked) {
      this.toast(`「${node.word}」は既にマップにあります。`);
    }
    if (this.selectedId == null || this.el.follow.checked) {
      this.select(node.id);
    } else {
      this.renderSuggestions();
      this.renderNeighbors();
    }
    return node;
  }

  /**
   * 入力された単語が、読み込み済み候補のどの関連にあたるかを調べます。
   * @param {string} word 正規化済みの単語です。
   * @returns {string} 関連種別です。どれにも無ければ 'manual' です。
   */
  detectRelation(word) {
    const order = [this.relation, ...Object.keys(this.loadedSuggestions).filter((r) => r !== this.relation)];
    for (const rel of order) {
      if ((this.loadedSuggestions[rel] || []).includes(word)) return rel;
    }
    return 'manual';
  }

  /**
   * 文字入力を処理します。カンマ・読点区切りで複数語をまとめて追加できます。
   * @param {string} text 入力欄の文字列です。
   */
  handleTyped(text) {
    const parts = String(text).split(/[,、，\n]/).map((t) => MindMapModel.normalize(t)).filter(Boolean);
    if (parts.length === 0) {
      if (String(text).trim()) this.toast('英単語を入力してください（英字のみ対応しています）。', 'error');
      return;
    }
    this.addWords(parts);
  }

  /**
   * 音声認識の確定結果を処理します。
   * 候補（信頼度順）のうち、表示中の関連語と一致するものがあればそれを優先します。
   * 一致しなければ最も信頼度の高い候補を単語ごとに分けて追加します。
   * @param {string[]} alternatives 認識候補の配列です。
   */
  handleVoice(alternatives) {
    this.showInterim('');
    const normalized = alternatives.map((a) => MindMapModel.normalize(a)).filter(Boolean);
    if (normalized.length === 0) {
      this.toast('英単語として認識できませんでした。', 'error');
      return;
    }
    // 「ice cream」のような2語の関連語も拾えるよう、まずは句全体で照合します。
    const matched = normalized.find((w) => this.detectRelation(w) !== 'manual');
    const words = matched ? [matched] : normalized[0].split(' ');
    this.toast(`🎤 「${words.join(' ')}」を追加しました。`);
    this.addWords(words);
  }

  /**
   * 複数の単語を、選択中のノードにまとめて接続します。
   * 何も選択していない場合は、1語目を中心の単語とし、2語目以降をそれにつなげます。
   * @param {string[]} words 正規化済みの単語の配列です。
   */
  addWords(words) {
    let parentId = this.selectedId;
    for (const w of words) {
      const node = this.addWord(w, parentId, parentId != null ? this.detectRelation(w) : 'manual');
      if (parentId == null && node) parentId = node.id;
    }
  }

  /**
   * 認識途中の文字列を表示します。
   * @param {string} text 表示する文字列です（空文字で非表示）。
   */
  showInterim(text) {
    this.el.interim.textContent = text;
    this.el.interim.hidden = !text;
  }

  /**
   * マイクボタンの表示を認識状態に合わせて更新します。
   * @param {boolean} on 認識中なら true です。
   */
  updateMicState(on) {
    this.el.mic.classList.toggle('listening', on);
    this.el.mic.setAttribute('aria-pressed', String(on));
    this.el.mic.querySelector('.label').textContent = on ? '聞き取り中…' : '音声入力';
    if (!on) this.showInterim('');
  }

  /**
   * ノードを選択し、サイドパネルの表示を更新します。
   * @param {number|null} id 選択するノード ID（解除なら null）です。
   * @param {boolean} [center] true なら選択ノードを画面中央に移動します。
   */
  select(id, center = false) {
    const valid = id != null && this.model.nodes.has(id) ? id : null;
    const changed = valid !== this.selectedId;
    this.selectedId = valid;
    this.view.setSelected(valid);
    if (changed) this.loadedSuggestions = {};
    if (center && valid != null) this.view.centerOn(valid);
    this.renderPanel();
  }

  /**
   * 候補の関連種別を切り替えます。
   * @param {string} rel 関連種別です。
   */
  setRelation(rel) {
    if (!RELATIONS[rel] || rel === 'manual') return;
    this.relation = rel;
    this.renderTabs();
    this.renderSuggestions();
  }

  /** 選択ノードの情報パネル（単語・定義・候補・隣接語）を描画します。 */
  renderPanel() {
    const node = this.selectedId != null ? this.model.nodes.get(this.selectedId) : null;
    this.el.panel.classList.toggle('has-selection', !!node);
    this.el.selWord.textContent = node ? node.word : '単語を選択してください';
    [this.el.speak, this.el.center, this.el.remove, this.el.addAll].forEach((b) => {
      b.disabled = !node || (b === this.el.speak && !this.speaker.isSupported());
    });
    this.el.input.placeholder = node ? `「${node.word}」につなげる英単語を入力` : '最初の英単語を入力（例: ocean）';
    this.renderDefinitions();
    this.renderSuggestions();
    this.renderNeighbors();
  }

  /** 選択ノードの英英定義を非同期に取得して表示します。 */
  async renderDefinitions() {
    const node = this.selectedId != null ? this.model.nodes.get(this.selectedId) : null;
    this.el.defs.replaceChildren();
    if (!node) return;
    const seq = ++this.requestSeq;
    const loading = document.createElement('li');
    loading.className = 'muted';
    loading.textContent = '定義を取得中…';
    this.el.defs.append(loading);
    const defs = await this.service.getDefinitions(node.word);
    if (seq !== this.requestSeq) return;
    this.el.defs.replaceChildren();
    if (defs.length === 0) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = '定義を取得できませんでした（オフライン、または辞書に未収録）。';
      this.el.defs.append(li);
      return;
    }
    for (const d of defs) {
      const li = document.createElement('li');
      li.textContent = d;
      this.el.defs.append(li);
    }
  }

  /** 選択ノードの関連語候補を取得し、チップとして表示します。 */
  async renderSuggestions() {
    const node = this.selectedId != null ? this.model.nodes.get(this.selectedId) : null;
    const box = this.el.suggestions;
    if (!node) {
      box.replaceChildren();
      this.el.sourceNote.textContent = '';
      return;
    }
    const rel = this.relation;
    const nodeId = node.id;
    if (!this.loadedSuggestions[rel]) {
      box.replaceChildren(Object.assign(document.createElement('span'), { className: 'muted', textContent: '候補を取得中…' }));
    }
    const { words, source } = await this.service.getRelated(node.word, rel);
    // 取得中に選択や関連種別が変わっていたら描画しません。
    if (this.selectedId !== nodeId || this.relation !== rel) return;
    this.loadedSuggestions[rel] = words;

    const linked = new Set(this.model.neighbors(nodeId).map((n) => n.node.word));
    box.replaceChildren();
    if (words.length === 0) {
      box.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: '候補が見つかりませんでした。別の関連タブを試してください。' }));
    }
    for (const w of words) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.word = w;
      chip.style.setProperty('--chip-color', RELATIONS[rel].color);
      chip.textContent = w;
      if (linked.has(w)) {
        chip.disabled = true;
        chip.title = '既に接続済みです';
      }
      box.append(chip);
    }
    this.el.sourceNote.textContent = source === 'offline' ? '※ API に接続できないため、内蔵の小さな辞書から表示しています。' : '候補提供: Datamuse API';
  }

  /** 選択ノードに接続済みの単語一覧を描画します。 */
  renderNeighbors() {
    const list = this.el.neighbors;
    list.replaceChildren();
    if (this.selectedId == null) return;
    const items = this.model.neighbors(this.selectedId);
    if (items.length === 0) {
      list.append(Object.assign(document.createElement('li'), { className: 'muted', textContent: 'まだ接続された単語はありません。' }));
      return;
    }
    for (const { node, relation } of items) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = String(node.id);
      btn.textContent = node.word;
      const tag = document.createElement('span');
      tag.className = 'rel-tag';
      tag.style.setProperty('--chip-color', RELATIONS[relation].color);
      tag.textContent = RELATIONS[relation].label;
      li.append(btn, tag);
      list.append(li);
    }
  }

  /** 関連種別タブを描画します。 */
  renderTabs() {
    this.el.tabs.replaceChildren();
    for (const [key, def] of Object.entries(RELATIONS)) {
      if (key === 'manual') continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.rel = key;
      btn.textContent = def.label;
      btn.style.setProperty('--chip-color', def.color);
      btn.setAttribute('aria-pressed', String(key === this.relation));
      this.el.tabs.append(btn);
    }
  }

  /** エッジ色の凡例を描画します。 */
  renderLegend() {
    this.el.legend.replaceChildren();
    for (const def of Object.values(RELATIONS)) {
      const span = document.createElement('span');
      span.style.setProperty('--chip-color', def.color);
      span.textContent = def.label;
      this.el.legend.append(span);
    }
  }

  /** 表示中の候補のうち未接続のものをすべて追加します。 */
  addAllSuggestions() {
    const parentId = this.selectedId;
    const words = this.loadedSuggestions[this.relation] || [];
    if (parentId == null || words.length === 0) return;
    const before = this.model.edges.length;
    for (const w of words) this.model.addWord(w, parentId, this.relation);
    this.toast(`${this.model.edges.length - before} 語を追加しました。`);
    this.renderSuggestions();
    this.renderNeighbors();
  }

  /** 選択中のノードを削除します。 */
  removeSelected() {
    if (this.selectedId == null) return;
    const node = this.model.nodes.get(this.selectedId);
    this.model.removeNode(this.selectedId);
    this.select(null);
    if (node) this.toast(`「${node.word}」を削除しました。`);
  }

  /**
   * ノードの単語を読み上げます。
   * @param {number|null} id ノード ID です。
   */
  pronounce(id) {
    const node = id != null ? this.model.nodes.get(id) : null;
    if (node) this.speaker.speak(node.word);
  }

  /** ファイル選択欄で選ばれた JSON を読み込みます。 */
  async importSelectedFile() {
    const file = this.el.importInput.files && this.el.importInput.files[0];
    this.el.importInput.value = '';
    if (!file) return;
    try {
      const data = await this.storage.importFile(file);
      this.model.loadJSON(data);
      this.select(null);
      this.view.fitAll();
      this.toast(`${this.model.nodes.size} 語のマップを読み込みました。`);
    } catch (err) {
      this.toast(err.message, 'error');
    }
  }

  /** マップが空のときに使い方の案内を表示します。 */
  updateEmptyState() {
    this.el.empty.hidden = this.model.nodes.size > 0;
  }

  /**
   * 画面下部に短いメッセージを表示します。
   * @param {string} message 表示する文言です。
   * @param {'info'|'error'} [kind] 種類です。
   */
  toast(message, kind = 'info') {
    const t = this.el.toast;
    t.textContent = message;
    t.dataset.kind = kind;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      t.hidden = true;
    }, 3200);
  }
}

// ページ読み込み後にアプリを起動します。
document.addEventListener('DOMContentLoaded', () => {
  const app = new WordMindMapApp({
    model: new MindMapModel(),
    service: new RelatedWordService(),
    storage: new MapStorage(),
    speaker: new Speaker('en-US'),
  });
  app.init();
  // デバッグ・動作確認用に参照を公開します。
  window.wordMindMap = app;
});
