/**
 * model.js
 * マインドマップのデータ（単語ノードと関連エッジ）を保持するモデル層です。
 * 描画やネットワークには一切依存しません。
 */

/**
 * 関連の種類の定義です。
 * key は内部識別子、label は画面表示名、color はエッジとチップの色です。
 * apiParam は Datamuse API に渡すクエリパラメータ名です（manual は API を使いません）。
 */
const RELATIONS = Object.freeze({
  trg: { label: '連想', color: '#3b82f6', apiParam: 'rel_trg' },
  syn: { label: '類義語', color: '#10b981', apiParam: 'rel_syn' },
  ant: { label: '対義語', color: '#ef4444', apiParam: 'rel_ant' },
  ml: { label: '意味が近い', color: '#a855f7', apiParam: 'ml' },
  manual: { label: '手動', color: '#94a3b8', apiParam: null },
});

/**
 * 1つの単語を表すノードです。
 * 位置(x, y)と速度(vx, vy)はレイアウト計算で使います。
 */
class WordNode {
  /**
   * @param {number} id     ノードの一意な ID です。
   * @param {string} word   正規化済みの単語です。
   * @param {number} x      初期 X 座標です。
   * @param {number} y      初期 Y 座標です。
   */
  constructor(id, word, x, y) {
    this.id = id;
    this.word = word;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    /** ドラッグ中など、レイアウト計算で動かさないときに true にします。 */
    this.pinned = false;
  }
}

/**
 * 単語ノードとエッジを管理し、変更を購読者へ通知するモデルです。
 */
class MindMapModel {
  constructor() {
    /** @type {Map<number, WordNode>} */
    this.nodes = new Map();
    /** @type {{source:number, target:number, relation:string}[]} */
    this.edges = [];
    this.nextId = 1;
    /** @type {Set<Function>} */
    this.listeners = new Set();
  }

  /**
   * 入力文字列を単語として正規化します。
   * 前後の空白と記号を取り除き、小文字に揃えます。
   * @param {string} text 入力文字列です。
   * @returns {string} 正規化後の単語です。無効な場合は空文字を返します。
   */
  static normalize(text) {
    if (typeof text !== 'string') return '';
    return text
      .toLowerCase()
      .replace(/[^a-z0-9'\- ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^['\-]+|['\-]+$/g, '');
  }

  /**
   * 変更通知を受け取る関数を登録します。
   * @param {Function} fn 引数に変更種別(string)を受け取る関数です。
   * @returns {Function} 登録解除用の関数です。
   */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * 購読者に変更を通知します。
   * @param {string} type 変更種別です（'structure' など）。
   */
  emit(type) {
    this.listeners.forEach((fn) => fn(type));
  }

  /**
   * 単語からノードを検索します。
   * @param {string} word 検索する単語です（正規化前でも構いません）。
   * @returns {WordNode|undefined} 見つかったノードです。
   */
  findByWord(word) {
    const w = MindMapModel.normalize(word);
    for (const node of this.nodes.values()) {
      if (node.word === w) return node;
    }
    return undefined;
  }

  /**
   * 2つのノード間のエッジを検索します（向きは問いません）。
   * @param {number} a ノード ID です。
   * @param {number} b ノード ID です。
   * @returns {object|undefined} 見つかったエッジです。
   */
  findEdge(a, b) {
    return this.edges.find(
      (e) => (e.source === a && e.target === b) || (e.source === b && e.target === a)
    );
  }

  /**
   * 単語を追加し、必要なら親ノードと接続します。
   * 同じ単語が既にある場合はノードを増やさず、エッジだけを追加します。
   * @param {string} text 追加する単語です。
   * @param {number|null} parentId 接続先ノードの ID です。null なら接続しません。
   * @param {string} relation 関連の種類（RELATIONS のキー）です。
   * @returns {{node: WordNode|null, created: boolean, linked: boolean}}
   *   node: 対象ノード（無効な単語なら null）, created: 新規作成したか, linked: エッジを追加したか
   */
  addWord(text, parentId = null, relation = 'manual') {
    const word = MindMapModel.normalize(text);
    if (!word) return { node: null, created: false, linked: false };

    let node = this.findByWord(word);
    let created = false;
    if (!node) {
      const parent = parentId != null ? this.nodes.get(parentId) : null;
      // 親の近くにランダムに配置し、レイアウト計算で自然な位置に収束させます。
      const angle = Math.random() * Math.PI * 2;
      const baseX = parent ? parent.x : 0;
      const baseY = parent ? parent.y : 0;
      const r = parent ? 80 : 0;
      node = new WordNode(this.nextId++, word, baseX + Math.cos(angle) * r, baseY + Math.sin(angle) * r);
      this.nodes.set(node.id, node);
      created = true;
    }

    let linked = false;
    if (parentId != null && parentId !== node.id && this.nodes.has(parentId) && !this.findEdge(parentId, node.id)) {
      this.edges.push({ source: parentId, target: node.id, relation: RELATIONS[relation] ? relation : 'manual' });
      linked = true;
    }

    if (created || linked) this.emit('structure');
    return { node, created, linked };
  }

  /**
   * ノードと、それに接続するエッジを削除します。
   * @param {number} id 削除するノードの ID です。
   * @returns {boolean} 削除できたら true です。
   */
  removeNode(id) {
    if (!this.nodes.delete(id)) return false;
    this.edges = this.edges.filter((e) => e.source !== id && e.target !== id);
    this.emit('structure');
    return true;
  }

  /**
   * 指定ノードに接続している単語の一覧を返します。
   * @param {number} id ノード ID です。
   * @returns {{node: WordNode, relation: string}[]} 隣接ノードと関連種別です。
   */
  neighbors(id) {
    const result = [];
    for (const e of this.edges) {
      const otherId = e.source === id ? e.target : e.target === id ? e.source : null;
      if (otherId != null && this.nodes.has(otherId)) {
        result.push({ node: this.nodes.get(otherId), relation: e.relation });
      }
    }
    return result;
  }

  /** すべてのノードとエッジを削除します。 */
  clear() {
    this.nodes.clear();
    this.edges = [];
    this.nextId = 1;
    this.emit('structure');
  }

  /**
   * 保存用のプレーンなオブジェクトに変換します。
   * @returns {{version:number, nodes:object[], edges:object[]}}
   */
  toJSON() {
    return {
      version: 1,
      nodes: [...this.nodes.values()].map((n) => ({ id: n.id, word: n.word, x: Math.round(n.x), y: Math.round(n.y) })),
      edges: this.edges.map((e) => ({ ...e })),
    };
  }

  /**
   * toJSON() 形式のデータを読み込みます。不正なデータは例外を投げ、現在の状態は変更しません。
   * @param {object} data 読み込むデータです。
   * @throws {Error} 形式が不正な場合です。
   */
  loadJSON(data) {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      throw new Error('マップデータの形式が正しくありません。');
    }
    const nodes = new Map();
    let maxId = 0;
    for (const n of data.nodes) {
      const word = MindMapModel.normalize(n.word);
      const id = Number(n.id);
      if (!word || !Number.isInteger(id) || nodes.has(id)) continue;
      nodes.set(id, new WordNode(id, word, Number(n.x) || 0, Number(n.y) || 0));
      maxId = Math.max(maxId, id);
    }
    const edges = [];
    for (const e of data.edges) {
      const s = Number(e.source);
      const t = Number(e.target);
      if (!nodes.has(s) || !nodes.has(t) || s === t) continue;
      if (edges.some((x) => (x.source === s && x.target === t) || (x.source === t && x.target === s))) continue;
      edges.push({ source: s, target: t, relation: RELATIONS[e.relation] ? e.relation : 'manual' });
    }
    this.nodes = nodes;
    this.edges = edges;
    this.nextId = maxId + 1;
    this.emit('structure');
  }
}
